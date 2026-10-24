using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using RacePulseRfidBridge;

namespace RacePulseTimingStation
{
    internal sealed class MainForm : Form
    {
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer();
        private readonly RfidBridgeService _bridge = new RfidBridgeService();
        private readonly Dictionary<int, Label> _antennaStatus = new Dictionary<int, Label>();
        private readonly Dictionary<int, int> _antennaReadCounts = new Dictionary<int, int>();

        private readonly TextBox _readerIp = new TextBox();
        private readonly NumericUpDown _readerPort = new NumericUpDown();
        private readonly TextBox _endpoint = new TextBox();
        private readonly NumericUpDown _dedupe = new NumericUpDown();
        private readonly CheckedListBox _antennas = new CheckedListBox();
        private readonly Label _bridgeStatus = new Label();
        private readonly ListBox _logs = new ListBox();
        private readonly Button _testButton = new Button();
        private readonly Button _startBridgeButton = new Button();
        private readonly Button _stopBridgeButton = new Button();
        private readonly Button _startConsoleButton = new Button();
        private readonly Button _openConsoleButton = new Button();
        private Process _localConsoleProcess;

        private string SettingsPath
        {
            get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "timing-station.config.json"); }
        }

        public MainForm()
        {
            Text = "RacePulse Timing Station";
            MinimumSize = new Size(920, 680);
            Size = new Size(1080, 780);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(20, 20, 23);
            ForeColor = Color.White;
            Font = new Font("Segoe UI", 10F);

            BuildInterface();
            LoadSettings();
            _bridge.LogReceived += BridgeOnLogReceived;
            _bridge.TagRead += BridgeOnTagRead;
            UpdateBridgeState(false);
            AddLog("Ready. Test the reader first, then start the local console and bridge.", false);
        }

        private void BuildInterface()
        {
            var header = new Panel { Dock = DockStyle.Top, Height = 92, Padding = new Padding(24, 18, 24, 12), BackColor = Color.FromArgb(43, 20, 22) };
            var title = new Label { Text = "RACEPULSE  TIMING STATION", Font = new Font("Segoe UI", 18F, FontStyle.Bold), Dock = DockStyle.Top, Height = 36, ForeColor = Color.White };
            var subtitle = new Label { Text = "VF-787P reader setup, live antenna diagnostics, and RacePulse RFID bridge", Dock = DockStyle.Bottom, Height = 24, ForeColor = Color.FromArgb(205, 190, 191) };
            header.Controls.Add(title);
            header.Controls.Add(subtitle);
            Controls.Add(header);

            var content = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 2, RowCount = 1 };
            content.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 48));
            content.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 52));
            content.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            Controls.Add(content);

            var settingsPanel = BuildSettingsPanel();
            var monitorPanel = BuildMonitorPanel();
            content.Controls.Add(settingsPanel, 0, 0);
            content.Controls.Add(monitorPanel, 1, 0);
        }

        private Control BuildSettingsPanel()
        {
            var panel = NewPanel();
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 2, RowCount = 8 };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 140));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            panel.Controls.Add(layout);

            AddHeading(layout, "READER CONNECTION", 0);
            AddField(layout, "Reader IP", _readerIp, 1);
            _readerPort.Minimum = 1;
            _readerPort.Maximum = 65535;
            _readerPort.Value = 1969;
            AddField(layout, "TCP port", _readerPort, 2);
            AddField(layout, "RacePulse API", _endpoint, 3);
            _dedupe.Minimum = 500;
            _dedupe.Maximum = 60000;
            _dedupe.Increment = 500;
            _dedupe.Value = 4000;
            AddField(layout, "Duplicate guard", _dedupe, 4, "milliseconds");

            var antennaBox = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, FlowDirection = FlowDirection.LeftToRight };
            for (var antenna = 1; antenna <= 8; antenna++) _antennas.Items.Add(antenna, antenna <= 2);
            _antennas.Height = 76;
            _antennas.CheckOnClick = true;
            _antennas.BackColor = Color.FromArgb(27, 27, 31);
            _antennas.ForeColor = Color.White;
            _antennas.BorderStyle = BorderStyle.FixedSingle;
            antennaBox.Controls.Add(_antennas);
            AddField(layout, "Active antennas", antennaBox, 5);

            var helper = new Label
            {
                Text = "Normal race-day setup: ANT1 and ANT2 only. The status cards at right show real tag activity after the bridge starts.",
                AutoSize = true,
                MaximumSize = new Size(380, 0),
                ForeColor = Color.FromArgb(182, 182, 191),
                Padding = new Padding(0, 5, 0, 8)
            };
            layout.Controls.Add(helper, 1, 6);

            var actionFlow = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, FlowDirection = FlowDirection.LeftToRight, Padding = new Padding(0, 8, 0, 0) };
            ConfigureButton(_testButton, "Test reader", Color.FromArgb(62, 88, 154));
            ConfigureButton(_startBridgeButton, "Start bridge", Color.FromArgb(212, 62, 50));
            ConfigureButton(_stopBridgeButton, "Stop bridge", Color.FromArgb(80, 80, 88));
            _testButton.Click += async (sender, args) => await TestReaderAsync();
            _startBridgeButton.Click += (sender, args) => StartBridge();
            _stopBridgeButton.Click += (sender, args) => StopBridge();
            actionFlow.Controls.Add(_testButton);
            actionFlow.Controls.Add(_startBridgeButton);
            actionFlow.Controls.Add(_stopBridgeButton);
            layout.Controls.Add(actionFlow, 1, 7);
            return panel;
        }

        private Control BuildMonitorPanel()
        {
            var panel = NewPanel();
            var layout = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 1, RowCount = 5 };
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            panel.Controls.Add(layout);

            AddHeading(layout, "RACE DAY CONTROLS", 0);
            _bridgeStatus.AutoSize = true;
            _bridgeStatus.Padding = new Padding(12, 8, 12, 8);
            _bridgeStatus.Margin = new Padding(0, 0, 0, 12);
            layout.Controls.Add(_bridgeStatus, 0, 1);

            var consoleActions = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, Padding = new Padding(0, 0, 0, 14) };
            ConfigureButton(_startConsoleButton, "Start local RacePulse", Color.FromArgb(62, 88, 154));
            ConfigureButton(_openConsoleButton, "Open Timing Console", Color.FromArgb(212, 62, 50));
            _startConsoleButton.Click += (sender, args) => StartLocalConsole();
            _openConsoleButton.Click += (sender, args) => OpenTimingConsole();
            consoleActions.Controls.Add(_startConsoleButton);
            consoleActions.Controls.Add(_openConsoleButton);
            layout.Controls.Add(consoleActions, 0, 2);

            var antennaGrid = new FlowLayoutPanel { AutoSize = true, Dock = DockStyle.Fill, Padding = new Padding(0, 0, 0, 14) };
            for (var antenna = 1; antenna <= 8; antenna++)
            {
                var card = new Label
                {
                    AutoSize = false,
                    Width = 92,
                    Height = 50,
                    Margin = new Padding(0, 0, 8, 8),
                    Padding = new Padding(8),
                    BorderStyle = BorderStyle.FixedSingle,
                    BackColor = Color.FromArgb(28, 28, 33),
                    ForeColor = Color.FromArgb(160, 160, 168),
                    Text = "ANT" + antenna + "\r\nWaiting"
                };
                _antennaStatus[antenna] = card;
                antennaGrid.Controls.Add(card);
            }
            layout.Controls.Add(antennaGrid, 0, 3);

            _logs.Dock = DockStyle.Fill;
            _logs.BackColor = Color.FromArgb(12, 12, 14);
            _logs.ForeColor = Color.FromArgb(224, 224, 228);
            _logs.BorderStyle = BorderStyle.FixedSingle;
            _logs.HorizontalScrollbar = true;
            layout.Controls.Add(_logs, 0, 4);
            return panel;
        }

        private static Panel NewPanel()
        {
            return new Panel { Dock = DockStyle.Fill, Margin = new Padding(0, 0, 16, 0), BackColor = Color.FromArgb(29, 29, 33), BorderStyle = BorderStyle.FixedSingle };
        }

        private static void AddHeading(TableLayoutPanel layout, string title, int row)
        {
            var heading = new Label { Text = title, AutoSize = true, Font = new Font("Segoe UI", 11F, FontStyle.Bold), ForeColor = Color.FromArgb(255, 91, 75), Margin = new Padding(0, 0, 0, 15) };
            layout.Controls.Add(heading, 0, row);
            layout.SetColumnSpan(heading, layout.ColumnCount);
        }

        private static void AddField(TableLayoutPanel layout, string label, Control field, int row, string suffix = null)
        {
            var caption = new Label { Text = label, AutoSize = true, Anchor = AnchorStyles.Left, ForeColor = Color.FromArgb(205, 205, 212) };
            field.Dock = DockStyle.Fill;
            field.Margin = new Padding(0, 0, 0, 8);
            if (field is TextBox) { field.BackColor = Color.FromArgb(18, 18, 21); field.ForeColor = Color.White; }
            if (suffix != null)
            {
                var wrap = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true };
                field.Width = 145;
                field.Dock = DockStyle.None;
                wrap.Controls.Add(field);
                wrap.Controls.Add(new Label { Text = suffix, AutoSize = true, Padding = new Padding(8, 6, 0, 0), ForeColor = Color.FromArgb(170, 170, 180) });
                layout.Controls.Add(wrap, 1, row);
            }
            else layout.Controls.Add(field, 1, row);
            layout.Controls.Add(caption, 0, row);
        }

        private static void ConfigureButton(Button button, string text, Color color)
        {
            button.Text = text;
            button.AutoSize = true;
            button.Height = 38;
            button.Padding = new Padding(12, 2, 12, 2);
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderSize = 0;
            button.BackColor = color;
            button.ForeColor = Color.White;
            button.Font = new Font("Segoe UI", 9.5F, FontStyle.Bold);
        }

        private void LoadSettings()
        {
            var config = new BridgeConfig();
            try
            {
                if (File.Exists(SettingsPath)) config = _json.Deserialize<BridgeConfig>(File.ReadAllText(SettingsPath));
            }
            catch (Exception ex)
            {
                AddLog("Could not read saved settings: " + ex.Message, true);
            }
            ApplyConfig(config ?? new BridgeConfig());
        }

        private void ApplyConfig(BridgeConfig config)
        {
            _readerIp.Text = config.ReaderIp ?? "192.168.0.128";
            _readerPort.Value = Math.Max(_readerPort.Minimum, Math.Min(_readerPort.Maximum, config.ReaderPort));
            _endpoint.Text = config.RacePulseEndpoint ?? "http://localhost:3000/api/rfid-events";
            _dedupe.Value = Math.Max(_dedupe.Minimum, Math.Min(_dedupe.Maximum, config.DedupeMilliseconds));
            for (var index = 0; index < _antennas.Items.Count; index++)
                _antennas.SetItemChecked(index, (config.Antennas ?? new int[0]).Contains((int)_antennas.Items[index]));
        }

        private BridgeConfig ReadConfig()
        {
            return new BridgeConfig
            {
                ReaderIp = _readerIp.Text.Trim(),
                ReaderPort = Decimal.ToInt32(_readerPort.Value),
                RacePulseEndpoint = _endpoint.Text.Trim(),
                DedupeMilliseconds = Decimal.ToInt32(_dedupe.Value),
                Antennas = _antennas.CheckedItems.Cast<int>().OrderBy(antenna => antenna).ToArray()
            };
        }

        private void SaveSettings(BridgeConfig config)
        {
            BridgeConfig.Validate(config);
            File.WriteAllText(SettingsPath, _json.Serialize(config));
            AddLog("Settings saved to timing-station.config.json.", false);
        }

        private async Task TestReaderAsync()
        {
            try
            {
                var config = ReadConfig();
                SaveSettings(config);
                _testButton.Enabled = false;
                AddLog("Testing reader connection…", false);
                var result = await Task.Run(() => _bridge.TestConnection(config));
                AddLog(result.Message, !result.Success);
            }
            catch (Exception ex)
            {
                AddLog(ex.Message, true);
            }
            finally { _testButton.Enabled = true; }
        }

        private void StartBridge()
        {
            try
            {
                var config = ReadConfig();
                SaveSettings(config);
                _bridge.Start(config);
                UpdateBridgeState(true);
            }
            catch (Exception ex)
            {
                AddLog(ex.Message, true);
                UpdateBridgeState(false);
            }
        }

        private void StopBridge()
        {
            _bridge.Stop();
            UpdateBridgeState(false);
        }

        private void UpdateBridgeState(bool isRunning)
        {
            _bridgeStatus.Text = isRunning ? "● BRIDGE LIVE — reads will be sent to RacePulse" : "● BRIDGE STOPPED — no RFID reads are being sent";
            _bridgeStatus.BackColor = isRunning ? Color.FromArgb(18, 76, 55) : Color.FromArgb(70, 35, 37);
            _bridgeStatus.ForeColor = isRunning ? Color.FromArgb(74, 238, 171) : Color.FromArgb(255, 160, 153);
            _startBridgeButton.Enabled = !isRunning;
            _stopBridgeButton.Enabled = isRunning;
            _testButton.Enabled = !isRunning;
        }

        private void StartLocalConsole()
        {
            if (_localConsoleProcess != null && !_localConsoleProcess.HasExited)
            {
                AddLog("Local RacePulse is already running.", false);
                return;
            }

            var baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
            var nodePath = Path.Combine(baseDirectory, "runtime", "node.exe");
            var serverPath = Path.Combine(baseDirectory, "app", "server.cjs");
            if (!File.Exists(nodePath) || !File.Exists(serverPath))
            {
                AddLog("Local RacePulse package is missing. Re-run the Timing Station installer/package build.", true);
                return;
            }

            try
            {
                var info = new ProcessStartInfo
                {
                    FileName = nodePath,
                    Arguments = "\"" + serverPath + "\"",
                    WorkingDirectory = Path.GetDirectoryName(serverPath),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                info.EnvironmentVariables["NODE_ENV"] = "production";
                var dataDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RacePulseTimingStation", "data");
                Directory.CreateDirectory(dataDirectory);
                info.EnvironmentVariables["RACEPULSE_DATA_DIR"] = dataDirectory;
                _localConsoleProcess = new Process { StartInfo = info, EnableRaisingEvents = true };
                _localConsoleProcess.OutputDataReceived += (sender, args) => { if (!string.IsNullOrWhiteSpace(args.Data)) AddLog("RacePulse: " + args.Data, false); };
                _localConsoleProcess.ErrorDataReceived += (sender, args) => { if (!string.IsNullOrWhiteSpace(args.Data)) AddLog("RacePulse: " + args.Data, true); };
                _localConsoleProcess.Exited += (sender, args) => AddLog("Local RacePulse stopped.", true);
                _localConsoleProcess.Start();
                _localConsoleProcess.BeginOutputReadLine();
                _localConsoleProcess.BeginErrorReadLine();
                AddLog("Starting local RacePulse at http://127.0.0.1:3000…", false);
            }
            catch (Exception ex) { AddLog("Could not start local RacePulse: " + ex.Message, true); }
        }

        private void OpenTimingConsole()
        {
            StartLocalConsole();
            try
            {
                Process.Start(new ProcessStartInfo { FileName = "http://127.0.0.1:3000", UseShellExecute = true });
            }
            catch (Exception ex) { AddLog("Could not open browser: " + ex.Message, true); }
        }

        private void BridgeOnLogReceived(object sender, BridgeLogEventArgs args)
        {
            AddLog(args.Message, args.IsError);
        }

        private void BridgeOnTagRead(object sender, TagReadEventArgs args)
        {
            SafeUi(() =>
            {
                var antenna = args.Read.Antenna;
                _antennaReadCounts[antenna] = _antennaReadCounts.ContainsKey(antenna) ? _antennaReadCounts[antenna] + 1 : 1;
                Label card;
                if (_antennaStatus.TryGetValue(antenna, out card))
                {
                    card.Text = "ANT" + antenna + "\r\n" + _antennaReadCounts[antenna] + " read(s)";
                    card.BackColor = Color.FromArgb(17, 78, 56);
                    card.ForeColor = Color.FromArgb(92, 240, 178);
                }
            });
        }

        private void AddLog(string message, bool isError)
        {
            SafeUi(() =>
            {
                _logs.Items.Add("[" + DateTime.Now.ToString("HH:mm:ss") + "] " + (isError ? "ERROR  " : "") + message);
                while (_logs.Items.Count > 400) _logs.Items.RemoveAt(0);
                _logs.TopIndex = _logs.Items.Count - 1;
            });
        }

        private void SafeUi(Action action)
        {
            if (IsDisposed || Disposing) return;
            try
            {
                if (InvokeRequired) BeginInvoke(action);
                else action();
            }
            catch (InvalidOperationException) { }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            _bridge.Dispose();
            if (_localConsoleProcess != null && !_localConsoleProcess.HasExited)
            {
                try { _localConsoleProcess.Kill(); } catch { }
            }
            base.OnFormClosing(e);
        }
    }
}
