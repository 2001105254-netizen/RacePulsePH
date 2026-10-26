# Live rankings and consecutive entries

Open **Rankings → Present on Screen**. Select a distance (for example,
18K), then a division or age category. The selection stays on screen until
you change it. The arrow buttons move between distances; the search finds
names, team members, or bib numbers.

**All categories / Scan order** lists official finishers by their recorded
finish timestamps across every distance. The scan number is arrival order;
each colored division/age badge shows that entry's actual official placing.

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
