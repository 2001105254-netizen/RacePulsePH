using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
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
    internal sealed class BridgeConfig
    {
        public string ReaderIp { get; set; } = "192.168.0.128";
        public int ReaderPort { get; set; } = 1969;
        public int[] Antennas { get; set; } = new[] { 1 };
        public string RacePulseEndpoint { get; set; } = "http://localhost:3000/api/rfid-events";
        public int DedupeMilliseconds { get; set; } = 4000;
    }

    internal sealed class BridgeEvent
    {
        public string Id { get; set; }
        public string Epc { get; set; }
        public int Antenna { get; set; }
        public string Timestamp { get; set; }
    }

    internal static class Program
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(4) };
        private static readonly ConcurrentQueue<BridgeEvent> PendingEvents = new ConcurrentQueue<BridgeEvent>();
        private static readonly AutoResetEvent QueueSignal = new AutoResetEvent(false);
        private static readonly ManualResetEvent StopSignal = new ManualResetEvent(false);
        private static readonly object DedupeLock = new object();
        private static readonly Dictionary<string, DateTime> LastSeen = new Dictionary<string, DateTime>();

        private static BridgeConfig _config;
        private static VupReader _reader;

        private static int Main(string[] args)
        {
            try
            {
                var applicationDirectory = AppDomain.CurrentDomain.BaseDirectory;
                var configPath = args.Length > 0 ? args[0] : Path.Combine(applicationDirectory, "bridge.config.json");
                if (!File.Exists(configPath))
                {
                    var examplePath = Path.Combine(applicationDirectory, "bridge.config.example.json");
                    File.Copy(examplePath, configPath);
                    Console.WriteLine("Created " + configPath + ". Review it, then run this bridge again.");
                    return 1;
                }

                _config = Json.Deserialize<BridgeConfig>(File.ReadAllText(configPath));
                ValidateConfig(_config);
                Console.CancelKeyPress += (sender, eventArgs) =>
                {
                    eventArgs.Cancel = true;
                    StopSignal.Set();
                };

                Console.WriteLine("RacePulse RFID Bridge (read-only)");
                Console.WriteLine("Reader: " + _config.ReaderIp + ":" + _config.ReaderPort + " | ANT " + string.Join(", ", _config.Antennas));
                Console.WriteLine("RacePulse: " + _config.RacePulseEndpoint);
                Console.WriteLine("Connect the reader directly by Ethernet, keep Wi-Fi on for RacePulse, and close the vendor demo app.");

                _reader = new NetVupReader(_config.ReaderIp, _config.ReaderPort, transport_protocol.tcp);
                var connectionResult = _reader.Connect();
                if (connectionResult != 0)
                {
                    Console.Error.WriteLine("Could not connect to the VF-787P. SDK error code: " + connectionResult);
                    return 2;
                }

                _reader.SetWorkMode(work_mode.command_mode);
                var antennaResult = _reader.SetInventoryAnts(_config.Antennas);
                if (antennaResult != 0)
                {
                    Console.Error.WriteLine("Could not select antennas. SDK error code: " + antennaResult);
                    return 3;
                }

                var modeResult = _reader.SetWorkMode(work_mode.auto_mode);
                if (modeResult != 0)
                {
                    Console.Error.WriteLine("Could not enter inventory mode. SDK error code: " + modeResult);
                    return 4;
                }

                _reader.ListenAutoOutput(item => OnTagRead(item.Epc, item.Ant));
                var senderTask = Task.Run(() => SendLoop());
                Console.WriteLine("Listening. EPC reads will appear below. Press Ctrl+C to stop safely.");

                StopSignal.WaitOne();
                Console.WriteLine("Stopping bridge…");
                _reader.StopListenAutoOutput();
                _reader.SetWorkMode(work_mode.command_mode);
                _reader.Disconnect();
                QueueSignal.Set();
                senderTask.Wait(TimeSpan.FromSeconds(3));
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Bridge failed: " + ex.Message);
                return 10;
            }
        }

        private static void OnTagRead(string rawEpc, int antenna)
        {
            var epc = (rawEpc ?? string.Empty).Trim().ToUpperInvariant();
            if (!Regex.IsMatch(epc, "^[0-9A-F]{8,128}$")) return;

            var now = DateTime.UtcNow;
            var key = epc + "|" + antenna;
            lock (DedupeLock)
            {
                DateTime last;
                if (LastSeen.TryGetValue(key, out last) && (now - last).TotalMilliseconds < _config.DedupeMilliseconds)
                {
                    return;
                }
                LastSeen[key] = now;
                foreach (var stale in LastSeen.Where(entry => (now - entry.Value).TotalMinutes > 10).Select(entry => entry.Key).ToArray())
                {
                    LastSeen.Remove(stale);
                }
            }

            var read = new BridgeEvent
            {
                Id = Guid.NewGuid().ToString("N"),
                Epc = epc,
                Antenna = antenna,
                Timestamp = now.ToString("O")
            };
            PendingEvents.Enqueue(read);
            QueueSignal.Set();
            Console.WriteLine("[" + DateTime.Now.ToString("HH:mm:ss.fff") + "] ANT" + antenna + "  " + epc);
        }

        private static void SendLoop()
        {
            while (!StopSignal.WaitOne(0))
            {
                BridgeEvent read;
                if (!PendingEvents.TryDequeue(out read))
                {
                    QueueSignal.WaitOne(500);
                    continue;
                }

                try
                {
                    var body = Json.Serialize(read);
                    var content = new StringContent(body, Encoding.UTF8, "application/json");
                    var response = Http.PostAsync(_config.RacePulseEndpoint, content).GetAwaiter().GetResult();
                    if (!response.IsSuccessStatusCode)
                    {
                        throw new InvalidOperationException("RacePulse returned HTTP " + (int)response.StatusCode);
                    }
                    Console.WriteLine("  ↳ delivered to RacePulse");
                }
                catch (Exception ex)
                {
                    // Never discard a read because the dashboard/server was momentarily
                    // unavailable. Put it back and retry after a short pause.
                    PendingEvents.Enqueue(read);
                    Console.Error.WriteLine("  ↳ waiting to deliver: " + ex.Message);
                    StopSignal.WaitOne(1500);
                }
            }
        }

        private static void ValidateConfig(BridgeConfig config)
        {
            if (config == null || string.IsNullOrWhiteSpace(config.ReaderIp) || string.IsNullOrWhiteSpace(config.RacePulseEndpoint))
                throw new InvalidOperationException("readerIp and racePulseEndpoint are required.");
            if (config.ReaderPort < 1 || config.ReaderPort > 65535)
                throw new InvalidOperationException("readerPort must be between 1 and 65535.");
            if (config.Antennas == null || config.Antennas.Length == 0 || config.Antennas.Any(antenna => antenna < 1 || antenna > 8))
                throw new InvalidOperationException("antennas must contain values from 1 through 8.");
            if (config.DedupeMilliseconds < 500)
                throw new InvalidOperationException("dedupeMilliseconds must be at least 500.");
        }
    }
}
