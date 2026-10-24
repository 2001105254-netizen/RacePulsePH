using System;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;

namespace RacePulseRfidBridge
{
    /// <summary>
    /// Backwards-compatible command-line host. Timing Station.exe uses this
    /// same RfidBridgeService behind its graphical operator interface.
    /// </summary>
    internal static class Program
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();
        private static readonly ManualResetEvent StopSignal = new ManualResetEvent(false);

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

                var config = Json.Deserialize<BridgeConfig>(File.ReadAllText(configPath));
                BridgeConfig.Validate(config);
                Console.CancelKeyPress += (sender, eventArgs) =>
                {
                    eventArgs.Cancel = true;
                    StopSignal.Set();
                };

                Console.WriteLine("RacePulse RFID Bridge (read-only)");
                Console.WriteLine("Reader: " + config.ReaderIp + ":" + config.ReaderPort + " | ANT " + string.Join(", ", config.Antennas));
                Console.WriteLine("RacePulse: " + config.RacePulseEndpoint);
                Console.WriteLine("Connect the reader directly by Ethernet, keep Wi-Fi on for RacePulse, and close the vendor demo app.");

                using (var bridge = new RfidBridgeService())
                {
                    bridge.LogReceived += (sender, eventArgs) =>
                    {
                        if (eventArgs.IsError) Console.Error.WriteLine(eventArgs.Message);
                        else Console.WriteLine(eventArgs.Message);
                    };
                    bridge.Start(config);
                    Console.WriteLine("Listening. Press Ctrl+C to stop safely.");
                    StopSignal.WaitOne();
                    bridge.Stop();
                }
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("Bridge failed: " + ex.Message);
                return 10;
            }
        }
    }
}
