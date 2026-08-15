# Study Cards

Study Cards is an offline-first browser/PWA implementation of the Anki desktop study workflow. The primary flow is now Anki-style **Decks → Add Note → automatic Card generation → Review → Browse/Stats**, rather than a flat-card web app.

## Anki-compatible workflow

- Desktop-style Decks / Add / Browse / Stats / Sync navigation and hierarchical decks.
- Anki Note → Card data model with Basic, reversed, optional reversed, typed-answer, Cloze, and Image Occlusion note types.
- Custom fields, card templates, CSS, conditional fields, `FrontSide`, filters, TTS, HTML, MathJax/LaTeX, and media.
- FSRS-6 review scheduling, learning/relearning steps, desired retention, per-deck presets, new/review limits and ordering, sibling burying, leeches, flags, marked cards, filtered decks, and Custom Study.
- Browser/search operations, bulk edits, saved searches, undo snapshots, statistics, retention/forecast tools, backups, integrity checks, and media checks.
- Native Anki Image Occlusion cloze syntax with rectangles, ellipses, polygons, text masks, Hide All/Guess One, Hide One/Guess One, Pointer Events editing, move/resize, undo/redo, paste/drop, and iPad-friendly controls.
- `.apkg` / `.colpkg` import, including the current normalized Anki collection layout (`collection.anki21b`, Zstandard, protobuf metadata, SQLite, media metadata) and legacy `collection.anki21` / `collection.anki2` packages.
- Legacy-compatible `.apkg` export with notes, cards, decks, note types/templates, review history, scheduling data, tags, and embedded media.
- Official interoperability CI generates a latest-format collection package with the **official Anki 26.5 Python library** and imports it in Chromium as a release gate.
- IndexedDB persistence, Service Worker offline shell, complete JSON backup, and the existing optional HMAC-signed Google Apps Script / Google Sheets synchronization.

## Verification

The repository release gates include strict TypeScript checking, repository lint, unit tests, security scanning, high-severity dependency audit, Chromium and WebKit end-to-end review flows, `.apkg` round-trip, Image Occlusion pointer editing, official Anki 26.5 package interoperability, CodeQL, and GitHub Pages deployment.

See [`ANKI_PARITY.md`](./ANKI_PARITY.md) for the detailed compatibility matrix and [`REVIEW.md`](./REVIEW.md) for the release review record.

## Platform boundary

A static PWA cannot truthfully be byte-for-byte identical to the Qt/Python/Rust desktop application in areas that require the desktop runtime. In particular, Study Cards does not execute arbitrary Anki Python add-ons, impersonate the private AnkiWeb account/sync service, or reproduce desktop OS/media-folder semantics. Those boundaries are documented rather than labelled as implemented.
