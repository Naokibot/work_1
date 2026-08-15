# Release review record

## Anki workflow rewrite review — 2026-08-15

### 1. Architecture review
The primary application flow was rewritten around Anki's collection model and desktop workflow rather than extending the old flat-card page. The normal path is now **Decks → Add Note → Card generation → Review → Browse/Stats**. Existing IndexedDB data is migrated/preserved instead of being discarded.

The collection keeps separate notes, note types, fields, card templates, decks, profiles, presets, generated cards, and review history. Direct legacy cards remain readable only as backward compatibility.

### 2. Deck and study-queue review
Normal deck study was reviewed separately from Custom Study. New cards and due learning/review cards are combined according to deck limits and ordering. Hierarchical decks, per-deck presets, new/review order, gathering order, review order, sibling burying, learning/relearning, suspend/bury, leech handling, and filtered-deck behavior remain part of the collection state.

A regression discovered by the new browser E2E — a new-only deck returning an empty normal study queue — was fixed in the selection layer and covered by a dedicated unit test.

### 3. Scheduling review
FSRS-6 remains the review scheduler with 21 parameters, desired retention, learning/relearning steps, same-day behavior, maximum interval, and Easy Days adjustment. Review records updated card state and append-only history before optional remote synchronization.

The scheduler targets the FSRS-6 model. The local parameter optimizer is deliberately described as lightweight and is not labelled as numerically identical to every official Anki desktop optimizer build.

### 4. Note/template review
Reviewed Basic, reversed, optional reversed, typed-answer, Cloze, and Image Occlusion note/card generation; custom fields/templates/CSS; conditional fields; `FrontSide`; text/hint/Japanese filters; HTML; TTS; MathJax/LaTeX; media; and note regeneration.

The Add workflow now creates notes and lets templates generate cards instead of treating a card as the primary authoring object.

### 5. Image Occlusion review
Image Occlusion was rewritten around current Anki-style cloze data rather than the previous rectangle-only JSON representation. The compatibility layer parses/emits rectangle, ellipse, polygon, and text shapes; handles inactive masks for Hide All/Guess One; supports Hide One/Guess One; and retains the old JSON format only for migration.

The editor uses Pointer Events and supports selection, move/resize, rectangle/ellipse/polygon/text creation, duplicate/delete, undo/redo, image file/paste/drop, Header, Back Extra, and Comments. Chromium/WebKit browser acceptance tests create a real mask by pointer drag and verify that a review card is generated.

### 6. Anki package interoperability review
The package layer was implemented independently from the study logic and reviewed against the official Anki source/package behavior.

Import supports current `collection.anki21b` packages and legacy `collection.anki21`/`collection.anki2`. It handles Zstandard decompression, normalized current notetype/field/template/deck tables, protobuf config/metadata, SQLite cards/notes/revlog, current and legacy media maps, flags/queues/reps/lapses, FSRS memory state where present, and current normalized hierarchical-deck naming.

During interoperability testing, the following real differences were found and fixed rather than hidden by test fixtures:
- corrected the latest collection filename to `collection.anki21b`;
- extended protobuf varint parsing to full-width uint64 values;
- retained the strict CSP by using the sql.js asm.js build instead of adding `unsafe-eval` for WebAssembly compilation;
- handled Anki's SQLite `unicase` schema collation in the read-only browser compatibility path;
- converted the current normalized deck hierarchy unit separator to user-facing `::`.

Export emits a legacy-compatible `.apkg` with SQLite collection data, notes/cards/models/decks, review log, scheduling metadata, tags, and media. It is not mislabelled as byte-identical current `collection.anki21b` output.

### 7. Official Anki interoperability evidence
A permanent CI workflow installs the **official `anki==26.5` Python package**, creates a real collection and hierarchical deck, calls the official current collection-package exporter, and then imports the generated latest-format `.colpkg` in Chromium. The test asserts that the official note, generated card, and hierarchical deck survive the import. This specifically prevents a false-positive where only packages produced by this project are accepted.

### 8. Browser/iPad review
The application retains a content-versioned Service Worker, dialog fallbacks, persistent-storage request, safe-area handling, non-hover controls, Pencil-compatible scratchpad Pointer Events, and now a Pointer Events Image Occlusion editor. The main end-to-end flow is run in both Chromium and Playwright WebKit.

### 9. Security review
- Rich card/template markup continues through the existing allow-list sanitizer before DOM insertion.
- Arbitrary JavaScript/Python add-on execution is not enabled.
- Media URL handling is constrained to supported browser/package forms.
- Existing HMAC synchronization and Apps Script-side protections remain in place.
- The strict Content-Security-Policy was preserved while adding SQLite package support; the implementation did not add `unsafe-eval` to make sql.js work.
- CI includes the repository security scan, high-severity dependency audit, and CodeQL.

### 10. Compatibility boundary review
`ANKI_PARITY.md` is the authoritative compatibility matrix. The implementation does not falsely label browser-impossible platform features as identical: arbitrary Python/Qt desktop add-ons, official AnkiWeb account/service identity, native desktop media-folder semantics, byte-identical latest-format export, and every Qt/OS integration remain explicit boundaries.

### Final release gates
The exact release tree must pass all of the following before this review is complete:
- lint;
- TypeScript strict typecheck;
- complete unit suite;
- security scan;
- `npm audit --audit-level=high`;
- Chromium and WebKit E2E, including `.apkg` round-trip and Image Occlusion pointer editing;
- official Anki 26.5 latest `.colpkg` interoperability;
- CodeQL;
- GitHub Pages deployment.
