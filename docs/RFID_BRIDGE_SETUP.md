# VF-787P automatic RFID timing setup

RacePulse now includes a local Windows bridge for the VF-787P reader. It sends every accepted EPC reading into the currently open **Record Splits** station, where RacePulse validates the assigned chip and records Check-in, Start, Intermediate, or Finish using the existing offline-safe timing flow.

Use the complete setup and build instructions in [`rfid-bridge/README.md`](../rfid-bridge/README.md).

For the current reader, use:

- Reader network address: `192.168.0.128:1969`
- Ethernet adapter address: `192.168.0.10`
- Mask: `255.255.255.0`
- First active reader antenna: `ANT1`
- Sample EPCs confirmed in the vendor app: `E28011B0A503007BC7F714CB` and `3034045FB817D710C3910FAD`

The bridge is read-only and does not change RFID chips or reader power/settings.
