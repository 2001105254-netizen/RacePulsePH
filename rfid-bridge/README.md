# RacePulse VF-787P RFID Bridge

This is a **Windows-only, read-only** bridge for the VANCH/Vup VF-787P. It receives EPC sightings from the reader and sends them to the local RacePulse Timing Console. It never writes, formats, locks, or changes an RFID tag.

## Before building

1. Install Visual Studio 2022 (or Build Tools) with the **.NET Framework 4.8 Developer Pack**.
2. From the supplied VF-S708 package, copy these vendor files into `rfid-bridge/vendor/`:
   - `Vup.dll`
   - `rfid.dll`
   - `rfid_core.dll`
3. Keep these DLLs local. They are vendor SDK files and are excluded from Git.

## Reader network

- Reader: `192.168.0.128:1969`
- Windows Ethernet adapter: static `192.168.0.10`, subnet mask `255.255.255.0`
- Gateway and DNS: blank for that Ethernet adapter
- Keep Windows Wi-Fi connected for the dashboard/internet.
- Connect the reader by Ethernet and close **RFID Reader Management System** before starting the bridge. The reader may allow only one active SDK connection.

## Build and run on the Windows timing laptop

1. In this repository, run `npm run dev` so RacePulse is at `http://localhost:3000`.
2. Open `RacePulseRfidBridge.csproj` in Visual Studio and build it, or run:

   ```powershell
   dotnet build .\rfid-bridge\RacePulseRfidBridge.csproj
   ```

3. Copy `bridge.config.example.json` to `bridge.config.json` beside the bridge executable. The default endpoint is already correct when RacePulse is running on the same Windows laptop.
4. Run the bridge executable. It should show `Listening` and then print an EPC plus `delivered to RacePulse` for each accepted tag read.
5. In RacePulse: sign in as Organizer, choose the race, open **Record Splits**, and select the station: Check-in, Start, Intermediate, or Finish.
6. Scan one **assigned** tag. The app will validate EPC → runner, save the timing read, show the success message, and sync it using its normal offline queue.

## Test checklist

1. Assign `E28011B0A503007BC7F714CB` to one test runner.
2. Select **Check-in** in RacePulse and pass that tag over ANT1. Confirm one check-in read.
3. Select **Start**, pass once, then select **Finish** and pass once. Confirm a result appears.
4. Leave a tag in antenna range: the bridge and RacePulse both apply a 4-second duplicate guard, so it must not keep recording results.

## If RacePulse runs on another laptop

Set `racePulseEndpoint` to the other laptop's reachable Wi-Fi LAN address, for example:

```json
"racePulseEndpoint": "http://192.168.1.59:3000/api/rfid-events"
```

Both laptops must be on the same trusted LAN. Allow port `3000` through the host Windows/macOS firewall. For the first live event, the simplest and most reliable setup is to run both RacePulse and this bridge on the Windows timing laptop.

## Important limits

- This first bridge connects to a **local RacePulse server**, not the public Firebase-hosted PWA by itself.
- The Timing Console must be open and on the intended checkpoint before the tag crosses the reader.
- Each runner must already have the exact EPC assigned. Unknown EPCs are rejected safely and shown to the operator.
