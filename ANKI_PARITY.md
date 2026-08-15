# Anki compatibility matrix

This document records the compatibility target for `work_1` after the 2026-08-15 rewrite. The product now follows the **Anki desktop workflow and collection semantics wherever they can be reproduced in a static, offline-first browser/PWA**. This is not a claim that a browser can execute the Qt/Python desktop runtime or the private AnkiWeb service byte-for-byte.

## Implemented standard workflow

### Desktop workflow, collection, profiles, decks, and presets
- Desktop-style Decks / Add / Browse / Stats / Sync navigation.
- Anki-style Note → Card collection model; old direct-card data is migrated for backward compatibility.
- Multiple local profiles with profile-specific collection state.
- Decks and hierarchical decks using the user-facing `Parent::Child` representation. Current Anki normalized database names using the unit-separator hierarchy representation are converted on package import.
- Deck create/rename/delete, card moves, deck option presets, per-deck preset assignment, daily new/review limits, maximum interval, answer timer, audio autoplay, auto advance, sibling burying, new-card gathering order, review order, new/review mixing, Easy Days, leech policy, learning/relearning steps, desired retention, and editable FSRS parameters.
- Filtered Deck / Custom Study with rescheduling and non-rescheduling behavior.

### Notes, fields, templates, and card generation
- Built-in Basic, Basic (and reversed card), Basic (optional reversed card), Basic (type in the answer), Cloze, and Image Occlusion note types.
- Custom note types, custom fields, multiple card templates, front/back templates, CSS, cloning, and removal of unused custom note types.
- Conditional/inverse field replacement, `FrontSide`, text filtering, hints, furigana/kana/kanji filters, TTS directives, typed answers, HTML templates, MathJax, and LaTeX compatibility rendering.
- Cloze sibling generation by cloze number.
- Rich editor controls for bold/italic/underline, Cloze, MathJax/LaTeX, image/audio/video attachment, and microphone recording where browser permission allows it.

### Native-style Image Occlusion
- Current Anki image-occlusion cloze syntax is parsed and emitted.
- Rectangle, ellipse, polygon, and text masks.
- Hide All, Guess One and Hide One, Guess One modes, including inactive-mask handling.
- Pointer Events editor for mouse/touch/Apple Pencil-class pointer input.
- Select, move, resize, duplicate, delete, undo/redo, paste/drop/file image loading, Header, Back Extra, and Comments fields.
- Legacy `Masks` JSON data remains readable for migration.

### Scheduler and review
- FSRS-6 scheduling model with 21 parameters, desired retention, learning/relearning steps, maximum interval, Easy Days adjustment, and interval previews.
- Again / Hard / Good / Easy ratings.
- New, learning, review, relearning, suspended, and buried states.
- Review/new sibling burying, manual bury/unbury, suspend/unsuspend, reset/forget, Set Due Date, reposition, leech tagging/suspension, filtered-deck handling, and failed-card retry behavior.
- Normal deck study combines new and due cards and respects deck new/review ordering and limits.
- Keyboard review shortcuts, flags, marked/favorite state, answer timer, replay, TTS/media playback, typed answers, choice mode, and scratch pad.
- Active session persistence and same-device resume.

### Browser, search, and bulk editing
- Card Browser/search interface.
- Plain/accent-insensitive text, quoted terms, wildcard and regular-expression matching.
- `deck:`, `tag:`, field, `note:`, `card:`, `flag:`, `cid:`, `nid:`, `is:`, `prop:`, and date/rating-style searches with negation.
- Hierarchical tag/deck matching.
- Bulk suspend/unsuspend, bury/unbury, mark/unmark, flags 0–7, due-date changes, reset, reposition, deck moves, delete, tag changes, find/replace, note editing/regeneration, and card info.
- Saved searches and undo snapshots for supported operations.

### Statistics and FSRS tools
- Today / 7-day / 30-day review counts and time.
- Accuracy, tag accuracy, card-state counts, rating counts, true-retention estimate, learning streak, 30-day forecast, and interval histogram.
- FSRS review-history evaluation (log loss/RMSE), lightweight in-browser parameter optimization, minimum-recommended-retention helper, and retention-based rescheduling.

## Anki package interoperability

### Import
- `.apkg` and `.colpkg` ZIP containers.
- Current latest-format collection payload: `collection.anki21b` with Zstandard decompression.
- Legacy `collection.anki21` and `collection.anki2` SQLite payloads.
- Current normalized `notetypes`, `fields`, `templates`, and `decks` tables.
- Current protobuf metadata used by note types, fields, templates, decks, and media metadata.
- SQLite notes, cards, review log, queues, flags, reps/lapses, deck IDs, and FSRS memory state data where present.
- Legacy JSON models/decks.
- Current/legacy package media mappings and embedded image/audio/video reconstruction.
- Current Anki custom `unicase` schema collation is handled in the read-only browser SQLite compatibility layer without weakening the page CSP.
- Current normalized deck hierarchy separator is converted to the user-facing `::` form.

### Export
- Legacy-compatible `.apkg` package containing `collection.anki21` SQLite, note/card models, decks, tags, review history, scheduling data, and numbered media files plus legacy media map.
- Full local collection JSON export/import remains available for lossless browser-native backup.
- CSV export and Basic CSV/TSV import remain available.

### Interoperability test
The permanent `Anki Interoperability` GitHub Actions workflow installs the official `anki==26.5` Python library, creates a real collection and hierarchical deck, exports a current latest-format `.colpkg`, then imports that official package in Chromium and asserts that note text, generated cards, and the hierarchical deck survive the import. This avoids validating package compatibility only against files generated by `work_1` itself.

## Backup, maintenance, offline, and sync
- Automatic local snapshots, restore/delete, manual complete JSON backup.
- Database integrity checks, empty-card cleanup, duplicate-note checks, and media-reference checks.
- IndexedDB persistence for cards, history, notes, decks, profiles, presets, note types, filtered decks, saved searches, undo state, sessions, settings, sync queue/conflicts, and snapshots.
- Persistent-storage request where supported.
- Content-derived Service Worker offline cache.
- Existing HMAC-signed Google Apps Script / Google Sheets synchronization retained for its supported card/history schema.

## Deliberate non-identical platform boundaries

The following are **not** described as implemented because they depend on Anki's desktop/service runtime rather than normal study semantics:

1. **Arbitrary desktop Python add-ons** — Anki desktop add-ons execute Python and can modify Qt/native internals. A sandboxed static PWA does not execute arbitrary desktop Python code.
2. **Official AnkiWeb account/sync service identity** — the app does not impersonate AnkiWeb credentials or its private service. It keeps its existing optional Google Apps Script / Sheets sync plus local-first collection state.
3. **Qt/native desktop chrome and OS integration** — the browser reproduces the Anki workflow but is not the Qt desktop process, and therefore cannot reproduce every platform-native menu/window/file-system behavior byte-for-byte.
4. **Desktop media-folder filesystem semantics** — media is managed through browser storage/package data rather than Anki's native collection.media filesystem/trash semantics.
5. **Latest-format package export identity** — current latest-format Anki `.colpkg` import is supported and tested with official Anki 26.5; package export currently emits a legacy-compatible `.apkg` rather than claiming byte-identical `collection.anki21b` output.
6. **Official optimizer numerical identity** — the review scheduler follows the FSRS-6 model, but the browser's lightweight parameter optimizer is not claimed to reproduce every official desktop optimizer build numerically.

## Release verification gates

A release is not considered reviewed until the exact release tree passes:
- repository lint;
- TypeScript strict typecheck;
- unit tests for scheduler, note/card generation, templates, Cloze, native Image Occlusion shapes/modes, search, and package metadata decoding;
- security pattern scan and `npm audit --audit-level=high`;
- Chromium end-to-end: boot → Add Note → generated card → deck study → review/history → Browse → `.apkg` export/import round-trip → Image Occlusion pointer edit → reload persistence;
- WebKit end-to-end with the same primary browser/PWA workflow;
- official Anki 26.5 latest `.colpkg` interoperability test;
- CodeQL;
- GitHub Pages build/deployment.
