using System;
using System.Linq;

namespace RacePulseRfidBridge
{
    /// <summary>
    /// On-disk settings shared by the console bridge and Timing Station.
    /// It contains reader and delivery settings only; it never stores chip data.
    /// </summary>
    public sealed class BridgeConfig
    {
        public string ReaderIp { get; set; } = "192.168.0.128";
        public int ReaderPort { get; set; } = 1969;
        public int[] Antennas { get; set; } = new[] { 1 };
        public string RacePulseEndpoint { get; set; } = "http://localhost:3000/api/rfid-events";
        public int DedupeMilliseconds { get; set; } = 4000;
        public string BridgeKey { get; set; } = "";

        public static void Validate(BridgeConfig config)
        {
            if (config == null || string.IsNullOrWhiteSpace(config.ReaderIp) || string.IsNullOrWhiteSpace(config.RacePulseEndpoint))
                throw new InvalidOperationException("Reader IP and RacePulse endpoint are required.");
            if (config.ReaderPort < 1 || config.ReaderPort > 65535)
                throw new InvalidOperationException("Reader port must be between 1 and 65535.");
            if (config.Antennas == null || config.Antennas.Length == 0 || config.Antennas.Any(antenna => antenna < 1 || antenna > 8))
                throw new InvalidOperationException("Select at least one antenna from ANT1 through ANT8.");
            if (config.DedupeMilliseconds < 500)
                throw new InvalidOperationException("Duplicate guard must be at least 500 milliseconds.");
        }
    }

    public sealed class BridgeEvent
    {
        public string Id { get; set; }
        public string Epc { get; set; }
        public int Antenna { get; set; }
        public string Timestamp { get; set; }
        public long ReaderSequence { get; set; }
        public string MonotonicTicks { get; set; }
        public string MonotonicFrequency { get; set; }
        public string ClockSource { get; set; } = "bridge-receipt";
    }

    public sealed class BridgeLogEventArgs : EventArgs
    {
        public BridgeLogEventArgs(string message, bool isError = false)
        {
            Message = message;
            IsError = isError;
        }

        public string Message { get; private set; }
        public bool IsError { get; private set; }
    }

    public sealed class TagReadEventArgs : EventArgs
    {
        public TagReadEventArgs(BridgeEvent read)
        {
            Read = read;
        }

        public BridgeEvent Read { get; private set; }
    }

    public sealed class ReaderConnectionTestResult
    {
        public bool Success { get; set; }
        public string Message { get; set; }
    }
}
