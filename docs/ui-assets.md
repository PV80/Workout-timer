# Artwork and release verification

Five additional images were generated on 1 October 2026, then resized to 960 × 640 JPEGs for offline use. No image downloads occur during a workout.

| File in assets/artwork | Placement | Purpose |
| --- | --- | --- |
| training-focus.jpg | Training home | Preparation: dumbbells and mat |
| session-complete.jpg | Saved session summary | Quiet celebration |
| history-progress.jpg | History | Accumulated progress |
| tracker-journal.jpg | Tracker | Recording reps and weights |
| backup-vault.jpg | Settings, above Data | Backup and restore context |

The five images total 238,695 bytes. Hero copy uses a dark overlay; artwork is decorative and excluded from accessibility focus. Hero containers expand with text size and live inside scroll views. The active workout remains free of photographic artwork.

Three original vector designs are supplied as real SVG files in `assets/buttons`: start.svg, capture.svg and export.svg. `ActionGlyph.tsx` renders the same paths natively, including a dark variant for green action buttons. Existing text labels and accessibility labels remain the action names.

## Verification

- 40 regression tests cover workout recovery, all exercise rigs, prone face direction, hanging leg raises, backup validation, export completeness, ambiguous exercise matching, sharing failures and serialized tracker writes.
- TypeScript type checking and the screen-preview bundle pass locally.
- All 24 movement illustrations (23 exercises and rest) were rendered from the current rig and visually reviewed. Hanging legs retain their original ID for historical data compatibility.
- Five generated image compositions and three vector button designs are reviewed separately and in the preview.
- The GitHub Android build must pass for the exact PR head before the scheduled merge. Previous successful builds are not substitutes.
- Physical Android process eviction, long lock-screen sessions, platform share sheets, TalkBack and large system text still require device validation. Geometry and JavaScript tests do not prove native rendering or every manufacturer’s background behavior.

## Bug fixes in this revision

Timer-only and unmatched session records now appear in CSV. Exact exercise names outrank fuzzy matches, and ambiguous matches remain separate. Prior-week exports and failed sharing no longer mark the current week exported. A cache-only export does not authorize clearing old tracker data. Tracker saves are serialized and state changes only after successful writes; failed hydration cannot silently open an empty tracker. Clearing previous weeks preserves future-dated entries. Incomplete or malformed backups are rejected before any writes, and restore is blocked while a workout is active.

Backup restoration still uses AsyncStorage.multiSet, which is not a cross-key transaction. The app also cannot detect whether a recipient saved a file after Android closes its share sheet. These are known platform limits, not claims of complete failure-proof storage.
