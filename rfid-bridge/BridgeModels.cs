using System;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text.RegularExpressions;

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
        public string RaceId { get; set; } = "";
        public string SpoolDirectory { get; set; } = "";

        public static void Validate(BridgeConfig config)
        {
            if (config == null || string.IsNullOrWhiteSpace(config.ReaderIp) || string.IsNullOrWhiteSpace(config.RacePulseEndpoint))
                throw new InvalidOperationException("Reader IP and RacePulse endpoint are required.");
            Uri endpointUri;
            if (!Uri.TryCreate(config.RacePulseEndpoint.Trim(), UriKind.Absolute, out endpointUri) ||
                (endpointUri.Scheme != Uri.UriSchemeHttp && endpointUri.Scheme != Uri.UriSchemeHttps))
                throw new InvalidOperationException("RacePulse endpoint must be a valid http:// or https:// URL.");
            if (!string.IsNullOrWhiteSpace(config.BridgeKey) && config.BridgeKey.Trim().Length < 32)
                throw new InvalidOperationException("Bridge key must be at least 32 characters when configured.");
            if (!string.IsNullOrWhiteSpace(config.RaceId) && !Regex.IsMatch(config.RaceId.Trim(), "^[a-zA-Z0-9_-]{1,128}$"))
                throw new InvalidOperationException("Race ID may contain only letters, digits, underscores, and hyphens (max 128 chars).");
            if (config.ReaderPort < 1 || config.ReaderPort > 65535)
                throw new InvalidOperationException("Reader port must be between 1 and 65535.");
            if (config.Antennas == null || config.Antennas.Length == 0 || config.Antennas.Any(antenna => antenna < 1 || antenna > 8))
                throw new InvalidOperationException("Select at least one antenna from ANT1 through ANT8.");
            if (config.DedupeMilliseconds < 500)
                throw new InvalidOperationException("Duplicate guard must be at least 500 milliseconds.");
        }

        public static void ValidateForDelivery(BridgeConfig config)
        {
            Validate(config);
            if (string.IsNullOrWhiteSpace(config.BridgeKey) || config.BridgeKey.Trim().Length < 32)
                throw new InvalidOperationException("Bridge key (32+ characters) is required before starting RFID delivery.");
            var endpointUri = new Uri(config.RacePulseEndpoint.Trim(), UriKind.Absolute);
            if (endpointUri.Scheme == Uri.UriSchemeHttp && !endpointUri.IsLoopback && !IsPrivateLanHost(endpointUri.Host))
                throw new InvalidOperationException("Plain HTTP endpoints are allowed only on localhost or private LAN addresses; use HTTPS for remote hosts.");
        }

        private static bool IsPrivateLanHost(string host)
        {
            IPAddress address;
            if (!IPAddress.TryParse(host, out address) || address.AddressFamily != AddressFamily.InterNetwork)
                return false;
            var bytes = address.GetAddressBytes();
            return bytes[0] == 10 ||
                   (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) ||
                   (bytes[0] == 192 && bytes[1] == 168);
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
