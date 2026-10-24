# RacePulse Timing Station for Windows

`RacePulseTimingStation.exe` is the operator app for the VF-787P. It combines the reader bridge and race-day controls in one place:

- reader IP/port setup and reader connection test;
- ANT1–ANT8 selection, with live tag activity per selected antenna;
- duplicate guard configuration (default: four seconds);
- starts the local RacePulse server, opens the Timing Console, and starts/stops the RFID bridge;
- stores the local server's temporary hand-off files under the signed-in Windows user's `AppData\\Local\\RacePulseTimingStation\\data` directory, not inside `Program Files`.

It remains **read-only** for RFID tags. It only inventories EPCs and posts them to the local RacePulse endpoint.

## Build the installer on the Windows timing laptop

1. Install **Node.js LTS**, **Visual Studio 2022 Build Tools** with **.NET desktop build tools** and **.NET Framework 4.8 Developer Pack**, and **Inno Setup 6**.
2. Copy the three SDK files to `rfid-bridge\\vendor\\`:
   - `Vup.dll`
   - `rfid.dll`
   - `rfid_core.dll`
3. Open PowerShell in the repository root and run:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\rfid-station\package-station.ps1
   ```

4. Open `rfid-station\\RacePulseTimingStation.iss` with **Inno Setup Compiler** and click **Build → Compile**.
5. The installer will be created at `release\\installer\\RacePulseTimingStation-Setup.exe`. Copy that one file to any Windows timing laptop, install it, then open **RacePulse Timing Station** from the Start Menu.

## First race-day use

1. Connect Ethernet to the reader and set Windows Ethernet to `192.168.0.10`, mask `255.255.255.0`; leave gateway/DNS empty. Keep Wi-Fi on.
2. Start Timing Station. Reader defaults are already `192.168.0.128:1969`.
3. Keep only **ANT1** and **ANT2** checked for the two-stand-antenna setup.
4. Click **Test reader**. Close the vendor reader demo first because it may hold the reader connection.
5. Click **Start local RacePulse**, then **Open Timing Console** and sign in as Organizer.
6. Select the race and the timing station (Check-in, Start, or Finish), then click **Start bridge**.
7. Pass one assigned tag over each antenna. The antenna card turns green and the log must say `delivered to RacePulse`.

Do not close Timing Station while the race is active. The bridge has its own four-second duplicate guard and RacePulse applies its own checkpoint rules, so a tag remaining near an antenna does not keep making finish records.
