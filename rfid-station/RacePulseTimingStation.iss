; Open this file in Inno Setup on Windows, then click Build > Compile.
; It packages the staged files produced by package-station.ps1.

#define AppName "RacePulse Timing Station"
#define AppVersion "1.0.0"
#define AppPublisher "RacePulse PH"
#define AppExeName "RacePulseTimingStation.exe"
#define StageDir "..\release\RacePulseTimingStation"

[Setup]
AppId={{BA5DC12E-895B-49EC-A1EA-00C09DAA351E}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={autopf}\RacePulse Timing Station
DefaultGroupName={#AppName}
OutputDir=..\release\installer
OutputBaseFilename=RacePulseTimingStation-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=admin

[Files]
Source: "{#StageDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Run]
Filename: "{app}\{#AppExeName}"; Description: "Open RacePulse Timing Station"; Flags: nowait postinstall skipifsilent
