# Anki parity audit — 2026-08-15

This audit compares `work_1` with the current Anki desktop manual and the verified behavior of this repository. It deliberately distinguishes full/usable implementation from partial or platform-specific behavior.

## Result

`work_1` is a capable Anki-compatible offline-first PWA, but it is **not a byte-for-byte or feature-for-feature replacement for every Anki desktop capability**. Core study and collection workflows are implemented. Some desktop/service-only features are partial or intentionally unavailable in a static GitHub Pages PWA.

## Implemented and release-tested core

- Decks, hierarchical subdecks and deck overview.
- Note → card collection model.
- Basic, Basic + Reverse, Optional Reverse, Type Answer, Cloze and Image Occlusion note types.
- Custom note types, fields, templates, CSS and card regeneration.
- Tags, marked state and card flags.
- FSRS-6 scheduling, desired retention, learning/relearning, Again/Hard/Good/Easy and interval previews.
- Daily new/review limits, ordering, sibling burying, leech handling, Easy Days, timers and auto-advance controls.
- Filtered decks / custom study.
- Browse/search with common Anki operators and bulk card operations.
- Card info, suspend, bury, reset/forget, set due date and reposition.
- Local profiles.
- Local automatic snapshots and manual JSON backups.
- Media attachment and browser-supported recording.
- Current `.colpkg` / `.apkg` import paths plus legacy-compatible `.apkg` export.
- IndexedDB persistence, offline PWA cache and same-device session/history persistence.
- Optional Google Apps Script / Google Sheets sync for the app's supported schema.
- Chromium and WebKit acceptance testing.
- Official-Anki-generated current package interoperability testing.

## Partial compared with desktop Anki

### Statistics
Core counts, retention, forecast, intervals, ratings and some breakdowns exist, but the desktop statistics window contains additional first-class graphs and controls, including the full calendar/reviews/review-time/ease/stability/difficulty/retrievability/hourly/answer-button presentation, arbitrary statistics search scope, and Save PDF. The PWA does not reproduce every graph/control pixel-for-pixel.

### Browser
Search and bulk operations are substantial, but the desktop browser's complete configurable column system, exact sidebar behavior, every context-menu command, window layout persistence and every keyboard shortcut are not fully reproduced.

### Preferences and native UI
The PWA has relevant study/sync settings, but it does not reproduce every desktop preference such as native window/video-driver behavior, every editor/UI preference, native menu integration or OS window state.

### Import/export
Current Anki package import is tested, and legacy-compatible `.apkg` export exists. Modern byte-identical `collection.anki21b`/modern `.colpkg` export is not claimed. Mnemosyne 2.0 `.db` import is not implemented.

### Media management
Media can be used and package media is handled, but native `collection.media` folder/trash semantics and the complete desktop Check Media workflow are not identical.

### Profiles/backups
Local profiles and snapshots exist, but desktop profile-folder semantics, downgrade-collection workflow, `deleted.txt` behavior and the exact desktop backup UI/file layout are not identical.

## Not provided by this static PWA

- Official AnkiWeb account identity and official AnkiWeb synchronization service/protocol.
- Direct access to AnkiWeb shared-deck browsing/download as the native desktop workflow provides.
- Arbitrary Python/Qt Anki add-ons.
- Qt/native desktop window and operating-system integration.
- Byte-for-byte identical native desktop database/media-folder implementation.

## Card creation verification target

The release acceptance flow must create a Basic note from the Add dialog, persist a generated card in IndexedDB, open the deck, display the question, reveal the answer, rate the card, persist review history, and retain the card/history across a reload. The demo flow additionally records this interaction in Chromium.

## Release gates

A reviewed release must pass:

1. TypeScript strict typecheck.
2. Repository lint.
3. Unit tests.
4. Security pattern scan.
5. `npm audit --audit-level=high`.
6. Chromium acceptance flow.
7. WebKit acceptance flow.
8. Official Anki package interoperability workflow.
9. CodeQL.
10. GitHub Pages deployment.

A release must not be described as having “all Anki features” while any item in the Partial or Not provided sections remains.