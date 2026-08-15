
## Anki-core feature set

The current application uses an Anki-style Note -> Card collection model with decks/subdecks, note types and card templates, Cloze, Image Occlusion, typed answers, rich media, hierarchical tags, advanced search/browser operations, filtered decks, profiles, backups, statistics, and FSRS-6 scheduling. The original card-number, choice-question, scratch-pad, same-device IndexedDB persistence, and Google Sheets card/history synchronization remain available.

See [`ANKI_PARITY.md`](./ANKI_PARITY.md) for the exact feature matrix and the small set of platform-specific behaviors that cannot truthfully be described as byte-for-byte desktop Anki compatibility (AnkiWeb protocol identity, arbitrary Python add-ons, native `.apkg/.colpkg` package containers, and native media-folder filesystem semantics).
