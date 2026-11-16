# Live rankings and consecutive entries

Open **Rankings → Present on Screen** to launch the broadcast display. To keep large venue TVs and spectator displays uncluttered, on-screen buttons, dropdowns, and search inputs stay hidden during presentation. Switch views exclusively with keyboard shortcuts (the exact hotkeys for your race distances also appear inside the Rankings dock before you launch):

| Key | Action |
| --- | --- |
| `0` or `A` | Show **All distances** podiums and unified finish chute feed |
| `1` to `9` | Jump directly to the matching race distance (ordered shortest to longest) |
| `Left` / `Right` or `[` / `]` | Step to the previous or next distance view |
| `Up` / `Down` or `C` | Cycle divisions and age categories within the active distance |
| `Space` or `P` | Pause or resume auto-pagination for Ranks #5 and below |
| `F` | Toggle browser fullscreen |
| `H` or `?` | Show or hide the keyboard shortcut guide overlay |
| `Esc` | Close the shortcut guide, or exit Live Rankings broadcast (Android Back also exits) |

Each distance displays a **4-card podium spotlight** (Champion, 1st Runner-Up, 2nd Runner-Up, and 3rd Runner-Up) with official finish times, pace (`min/km`), and within-category gap-to-leader badges (`LEADER` / `+MM:SS`), separated from the **Live finish chute feed** (`SCAN #N` arrival order and `Approaching` / `Running` checkpoint alerts). Before the first finisher crosses, the screen shows verified `Registered`, `Started`, `On course`, and `Approaching splits` counters alongside live wave clocks.

On **Consecutive entries**:

## Consecutive entries with separate bibs/chips

1. Register/import each entry separately with its own bib and chip.
2. In **Roster → Consecutive entries**, choose the next entry's bib
   and the previous entry's bib, then save the sequence before timing the next entry.
3. Scan each entry's own chip at the appropriate checkpoints.

For Michiron's 5K Solo → 5K Duo example, link the Duo bib to the Solo bib.
The Solo finish timestamp becomes the Duo start automatically. If Solo finishes
at 07:30 and Duo finishes at 08:10, the Duo official result is 00:40:00.
A later Duo Start scan does not reset that clock. Normal, unlinked entries
retain their existing chip-time/gun-fallback behavior.

The live screen highlights a running next entry in amber and a finished next
entry in green. Each bib retains its own result and division placing.
An entry waits for a valid previous finish; missing finishes and loops cannot
produce official consecutive-entry results. Removing/correcting a previous
finish recalculates the linked results.

The updated Firestore rules restrict sequence links to race organizers/staff.
Include `firestore.rules` when deploying this feature.

Run timing and screen-render checks with:

```sh
node --test tests/timing-sequence.test.cjs
```
