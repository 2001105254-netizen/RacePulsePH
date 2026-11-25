using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Vup.reader;
using Vup.utils;

namespace RacePulseRfidBridge
{
    /// <summary>
    /// Read-only VF-787P inventory bridge. This is shared by the command-line
    /// utility and Timing Station so both use the same EPC and duplicate rules.
    /// </summary>
    public sealed class RfidBridgeService : IDisposable
    {
        private const int MaxSpoolQueuedEvents = 25000;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();
        private readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(4) };
        private readonly object _queueLock = new object();
        private readonly Queue<BridgeEvent> _pendingEvents = new Queue<BridgeEvent>();
        private readonly object _spoolFileLock = new object();
        private readonly AutoResetEvent _queueSignal = new AutoResetEvent(false);
        private readonly object _dedupeLock = new object();
        private readonly Dictionary<string, long> _lastSeen = new Dictionary<string, long>();
        private readonly Random _jitter = new Random();

        private long _readSequence;
        private BridgeConfig _config;
        private string _spoolPath;
        private string _deadLetterPath;
        private VupReader _reader;
        private CancellationTokenSource _stopSource;
        private Task _senderTask;
        private bool _isRunning;

        public event EventHandler<BridgeLogEventArgs> LogReceived;
        public event EventHandler<TagReadEventArgs> TagRead;

        public bool IsRunning { get { return _isRunning; } }

        public ReaderConnectionTestResult TestConnection(BridgeConfig config)
        {
            BridgeConfig.Validate(config);
            if (_isRunning)
                return new ReaderConnectionTestResult { Success = true, Message = "Reader is already connected and listening." };

            VupReader testReader = null;
            try
            {
                testReader = new NetVupReader(config.ReaderIp, config.ReaderPort, transport_protocol.tcp);
                var result = testReader.Connect();
                if (!result.Success)
                    return new ReaderConnectionTestResult { Success = false, Message = result.Message };

                return new ReaderConnectionTestResult
                {
                    Success = true,
                    Message = "Connected to VF-787P at " + config.ReaderIp + ":" + config.ReaderPort + "."
                };
            }
            catch (Exception ex)
            {
                return new ReaderConnectionTestResult { Success = false, Message = ex.Message };
            }
            finally
            {
                if (testReader != null)
                {
                    try { testReader.Disconnect(); }
                    catch (Exception ex) { WriteLog("Reader test disconnect warning: " + ex.Message, true); }
                }
            }
        }

        public void Start(BridgeConfig config)
        {
            if (_isRunning)
                throw new InvalidOperationException("Bridge is already listening.");

            BridgeConfig.ValidateForDelivery(config);
            _config = config;
            InitializeSpoolPaths(config);
            LoadPendingSpoolEvents();
            _stopSource = new CancellationTokenSource();
            try
            {
                _reader = new NetVupReader(_config.ReaderIp, _config.ReaderPort, transport_protocol.tcp);
                var connectionResult = _reader.Connect();
                if (!connectionResult.Success)
                    throw new InvalidOperationException("Could not connect to VF-787P: " + connectionResult.Message);

                var commandModeResult = _reader.SetWorkMode(work_mode.command_mode);
                if (!commandModeResult.Success)
                    throw new InvalidOperationException("Could not enter command mode: " + commandModeResult.Message);

                var antennaResult = _reader.SetInventoryAnts(_config.Antennas);
                if (!antennaResult.Success)
                    throw new InvalidOperationException("Could not select antennas: " + antennaResult.Message);

                var modeResult = _reader.SetWorkMode(work_mode.auto_mode);
                if (!modeResult.Success)
                    throw new InvalidOperationException("Could not enter inventory mode: " + modeResult.Message);

                var listenerResult = _reader.ListenAutoOutput(item => OnTagRead(item.Epc, item.Ant));
                if (!listenerResult.Success)
                    throw new InvalidOperationException("Could not listen for reader output: " + listenerResult.Message);

                _isRunning = true;
                _senderTask = Task.Run(() => SendLoop(_stopSource.Token));
                _queueSignal.Set();
                WriteLog("Listening on " + _config.ReaderIp + ":" + _config.ReaderPort + " | ANT " + string.Join(", ", _config.Antennas));
            }
            catch
            {
                Stop();
                throw;
            }
        }

        public void Stop()
        {
            var wasRunning = _isRunning;
            _isRunning = false;
            if (_stopSource != null) _stopSource.Cancel();
            _queueSignal.Set();

            if (_reader != null)
            {
                try { _reader.StopListenAutoOutput(); }
                catch (Exception ex) { WriteLog("Reader stop warning: " + ex.Message, true); }
                try { _reader.SetWorkMode(work_mode.command_mode); }
                catch (Exception ex) { WriteLog("Reader mode reset warning: " + ex.Message, true); }
                try { _reader.Disconnect(); }
                catch (Exception ex) { WriteLog("Reader disconnect warning: " + ex.Message, true); }
                _reader = null;
            }
            if (_senderTask != null)
            {
                try { _senderTask.Wait(TimeSpan.FromSeconds(3)); }
                catch (AggregateException ex) { WriteLog("Sender drain warning: " + ex.Flatten().InnerException?.Message, true); }
                catch (Exception ex) { WriteLog("Sender drain warning: " + ex.Message, true); }
                _senderTask = null;
            }
            if (_stopSource != null)
            {
                _stopSource.Dispose();
                _stopSource = null;
            }
            if (wasRunning) WriteLog("Bridge stopped.");
        }

        private void OnTagRead(string rawEpc, int antenna)
        {
            var epc = (rawEpc ?? string.Empty).Trim().ToUpperInvariant();
            if (!Regex.IsMatch(epc, "^[0-9A-F]{8,128}$")) return;

            var monotonic = Stopwatch.GetTimestamp();
            var now = DateTime.UtcNow;
            var sequence = Interlocked.Increment(ref _readSequence);
            var key = epc + "|" + antenna;
            lock (_dedupeLock)
            {
                long last;
                if (_lastSeen.TryGetValue(key, out last) && (monotonic - last) * 1000.0 / Stopwatch.Frequency < _config.DedupeMilliseconds)
                    return;
                _lastSeen[key] = monotonic;
                PruneDedupeCacheLocked(monotonic);
            }

            var read = new BridgeEvent
            {
                Id = Guid.NewGuid().ToString("N"),
                Epc = epc,
                Antenna = antenna,
                Timestamp = now.ToString("O"),
                ReaderSequence = sequence,
                MonotonicTicks = monotonic.ToString(CultureInfo.InvariantCulture),
                MonotonicFrequency = Stopwatch.Frequency.ToString(CultureInfo.InvariantCulture)
            };
            lock (_queueLock)
            {
                if (_pendingEvents.Count >= MaxSpoolQueuedEvents)
                {
                    var dropped = _pendingEvents.Dequeue();
                    AppendDeadLetterLine(dropped, "spool_capacity_overflow");
                }
                _pendingEvents.Enqueue(read);
            }
            AppendSpoolLine(read);
            _queueSignal.Set();
            WriteLog("ANT" + antenna + "  " + epc);
            RaiseTagRead(read);
        }

        private void SendLoop(CancellationToken stopToken)
        {
            var consecutiveFailures = 0;
            var lastPruneTick = Stopwatch.GetTimestamp();
            while (!stopToken.IsCancellationRequested)
            {
                BridgeEvent read;
                lock (_queueLock)
                {
                    read = _pendingEvents.Count > 0 ? _pendingEvents.Peek() : null;
                }
                if (read == null)
                {
                    _queueSignal.WaitOne(500);
                    var nowTick = Stopwatch.GetTimestamp();
                    if ((nowTick - lastPruneTick) / (double)Stopwatch.Frequency >= 60)
                    {
                        lastPruneTick = nowTick;
                        lock (_dedupeLock) { PruneDedupeCacheLocked(nowTick); }
                    }
                    continue;
                }

                try
                {
                    var payload = _json.Serialize(new
                    {
                        id = read.Id,
                        epc = read.Epc,
                        antenna = read.Antenna,
                        timestamp = read.Timestamp,
                        readerSequence = read.ReaderSequence,
                        monotonicTicks = read.MonotonicTicks,
                        monotonicFrequency = read.MonotonicFrequency,
                        clockSource = read.ClockSource
                    });

                    int statusCode;
                    string responseBody;
                    var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(CultureInfo.InvariantCulture);
                    var nonce = Guid.NewGuid().ToString("N");
                    var sigInput = ts + "." + nonce + "." + payload;
                    string signature;
                    using (var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(_config.BridgeKey)))
                    {
                        var hashBytes = hmac.ComputeHash(Encoding.UTF8.GetBytes(sigInput));
                        signature = BitConverter.ToString(hashBytes).Replace("-", string.Empty).ToLowerInvariant();
                    }
                    using (var content = new StringContent(payload, Encoding.UTF8, "application/json"))
                    using (var message = new HttpRequestMessage(HttpMethod.Post, _config.RacePulseEndpoint) { Content = content })
                    {
                        message.Headers.Add("X-RacePulse-Bridge-Timestamp", ts);
                        message.Headers.Add("X-RacePulse-Bridge-Nonce", nonce);
                        message.Headers.Add("X-RacePulse-Bridge-Signature", signature);
                        using (var response = _http.SendAsync(message, stopToken).GetAwaiter().GetResult())
                        {
                            statusCode = (int)response.StatusCode;
                            responseBody = response.IsSuccessStatusCode ? string.Empty : response.Content.ReadAsStringAsync().GetAwaiter().GetResult();
                        }
                    }

                    if (statusCode >= 200 && statusCode < 300)
                    {
                        consecutiveFailures = 0;
                        DequeueHeadAndCompactSpool(read.Id);
                        WriteLog("  -> delivered to RacePulse");
                        continue;
                    }

                    // Non-transient client rejections (bad EPC/payload/auth) are quarantined in dead-letter so FIFO queue stays unblocked.
                    if (statusCode >= 400 && statusCode < 500 && statusCode != 408 && statusCode != 429)
                    {
                        consecutiveFailures = 0;
                        DequeueHeadAndCompactSpool(read.Id);
                        AppendDeadLetterLine(read, "HTTP_" + statusCode + (string.IsNullOrWhiteSpace(responseBody) ? "" : ": " + responseBody.Trim()));
                        WriteLog("  -> moved rejected scan to dead-letter (HTTP " + statusCode + ")", true);
                        continue;
                    }

                    throw new InvalidOperationException("RacePulse returned HTTP " + statusCode);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    consecutiveFailures += 1;
                    var baseDelayMs = Math.Min(30000, 1000 * (1 << Math.Min(5, consecutiveFailures - 1)));
                    int jitterMs;
                    lock (_jitter) { jitterMs = _jitter.Next(0, 350); }
                    WriteLog("  -> waiting to deliver: " + ex.Message, true);
                    stopToken.WaitHandle.WaitOne(baseDelayMs + jitterMs);
                }
            }
        }

        private void PruneDedupeCacheLocked(long monotonicNow)
        {
            foreach (var stale in _lastSeen.Where(entry => (monotonicNow - entry.Value) / (double)Stopwatch.Frequency > 600).Select(entry => entry.Key).ToArray())
                _lastSeen.Remove(stale);
        }

        private void InitializeSpoolPaths(BridgeConfig config)
        {
            var baseDir = !string.IsNullOrWhiteSpace(config.SpoolDirectory)
                ? config.SpoolDirectory.Trim()
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RacePulseRfidBridge", "spool");
            Directory.CreateDirectory(baseDir);
            _spoolPath = Path.Combine(baseDir, "spool.ndjson");
            _deadLetterPath = Path.Combine(baseDir, "dead-letter.ndjson");
        }

        private void LoadPendingSpoolEvents()
        {
            if (string.IsNullOrEmpty(_spoolPath) || !File.Exists(_spoolPath)) return;
            lock (_queueLock)
            {
                _pendingEvents.Clear();
                lock (_spoolFileLock)
                {
                    foreach (var line in File.ReadAllLines(_spoolPath, Encoding.UTF8))
                    {
                        if (string.IsNullOrWhiteSpace(line)) continue;
                        try
                        {
                            var ev = _json.Deserialize<BridgeEvent>(line);
                            if (ev != null && !string.IsNullOrWhiteSpace(ev.Epc))
                                _pendingEvents.Enqueue(ev);
                        }
                        catch (Exception ex)
                        {
                            WriteLog("Skipped corrupt spool record: " + ex.Message, true);
                        }
                    }
                }
                if (_pendingEvents.Count > 0)
                    WriteLog("Recovered " + _pendingEvents.Count + " pending RFID scan(s) from spool.");
            }
        }

        private void AppendSpoolLine(BridgeEvent read)
        {
            if (string.IsNullOrEmpty(_spoolPath)) return;
            lock (_spoolFileLock)
            {
                try
                {
                    File.AppendAllText(_spoolPath, _json.Serialize(read) + Environment.NewLine, Encoding.UTF8);
                }
                catch (Exception ex)
                {
                    WriteLog("Could not persist scan to spool: " + ex.Message, true);
                }
            }
        }

        private void AppendDeadLetterLine(BridgeEvent read, string reason)
        {
            if (string.IsNullOrEmpty(_deadLetterPath)) return;
            lock (_spoolFileLock)
            {
                try
                {
                    var line = _json.Serialize(new { failedAt = DateTime.UtcNow.ToString("O"), reason = reason, ev = read });
                    File.AppendAllText(_deadLetterPath, line + Environment.NewLine, Encoding.UTF8);
                }
                catch (Exception ex)
                {
                    WriteLog("Could not persist dead-letter scan: " + ex.Message, true);
                }
            }
        }

        private void DequeueHeadAndCompactSpool(string expectedId)
        {
            BridgeEvent[] snapshot;
            lock (_queueLock)
            {
                if (_pendingEvents.Count > 0 && string.Equals(_pendingEvents.Peek().Id, expectedId, StringComparison.Ordinal))
                    _pendingEvents.Dequeue();
                snapshot = _pendingEvents.ToArray();
            }
            if (string.IsNullOrEmpty(_spoolPath)) return;
            lock (_spoolFileLock)
            {
                try
                {
                    var tmpPath = _spoolPath + ".tmp";
                    var lines = snapshot.Select(ev => _json.Serialize(ev));
                    File.WriteAllLines(tmpPath, lines, Encoding.UTF8);
                    File.Copy(tmpPath, _spoolPath, true);
                    File.Delete(tmpPath);
                }
                catch (Exception ex)
                {
                    WriteLog("Could not compact spool file: " + ex.Message, true);
                }
            }
        }

        private void WriteLog(string message, bool isError = false)
        {
            var handler = LogReceived;
            if (handler != null) handler(this, new BridgeLogEventArgs(message, isError));
        }

        private void RaiseTagRead(BridgeEvent read)
        {
            var handler = TagRead;
            if (handler != null) handler(this, new TagReadEventArgs(read));
        }

        public void Dispose()
        {
            Stop();
            _http.Dispose();
            _queueSignal.Dispose();
        }
    }
}
