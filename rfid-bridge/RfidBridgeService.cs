using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
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
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();
        private readonly HttpClient _http = new HttpClient { Timeout = TimeSpan.FromSeconds(4) };
        private readonly ConcurrentQueue<BridgeEvent> _pendingEvents = new ConcurrentQueue<BridgeEvent>();
        private readonly AutoResetEvent _queueSignal = new AutoResetEvent(false);
        private readonly object _dedupeLock = new object();
        private readonly Dictionary<string, DateTime> _lastSeen = new Dictionary<string, DateTime>();

        private BridgeConfig _config;
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
                    try { testReader.Disconnect(); } catch { }
            }
        }

        public void Start(BridgeConfig config)
        {
            if (_isRunning)
                throw new InvalidOperationException("Bridge is already listening.");

            BridgeConfig.Validate(config);
            _config = config;
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
                try { _reader.StopListenAutoOutput(); } catch { }
                try { _reader.SetWorkMode(work_mode.command_mode); } catch { }
                try { _reader.Disconnect(); } catch { }
                _reader = null;
            }
            if (_senderTask != null)
            {
                try { _senderTask.Wait(TimeSpan.FromSeconds(3)); } catch { }
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

            var now = DateTime.UtcNow;
            var key = epc + "|" + antenna;
            lock (_dedupeLock)
            {
                DateTime last;
                if (_lastSeen.TryGetValue(key, out last) && (now - last).TotalMilliseconds < _config.DedupeMilliseconds)
                    return;
                _lastSeen[key] = now;
                foreach (var stale in _lastSeen.Where(entry => (now - entry.Value).TotalMinutes > 10).Select(entry => entry.Key).ToArray())
                    _lastSeen.Remove(stale);
            }

            var read = new BridgeEvent
            {
                Id = Guid.NewGuid().ToString("N"),
                Epc = epc,
                Antenna = antenna,
                Timestamp = now.ToString("O")
            };
            _pendingEvents.Enqueue(read);
            _queueSignal.Set();
            WriteLog("ANT" + antenna + "  " + epc);
            RaiseTagRead(read);
        }

        private void SendLoop(CancellationToken stopToken)
        {
            while (!stopToken.IsCancellationRequested)
            {
                BridgeEvent read;
                if (!_pendingEvents.TryDequeue(out read))
                {
                    _queueSignal.WaitOne(500);
                    continue;
                }
                try
                {
                    var content = new StringContent(_json.Serialize(read), Encoding.UTF8, "application/json");
                    var response = _http.PostAsync(_config.RacePulseEndpoint, content).GetAwaiter().GetResult();
                    if (!response.IsSuccessStatusCode)
                        throw new InvalidOperationException("RacePulse returned HTTP " + (int)response.StatusCode);
                    WriteLog("  ↳ delivered to RacePulse");
                }
                catch (Exception ex)
                {
                    _pendingEvents.Enqueue(read);
                    WriteLog("  ↳ waiting to deliver: " + ex.Message, true);
                    stopToken.WaitHandle.WaitOne(1500);
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
