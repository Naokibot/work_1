# Anki core feature parity review

This document records the compatibility target for `work_1`. The target is the **standard Anki application workflow** that can be reproduced safely in a static, offline-first browser/PWA. It is not a claim that a browser app can load arbitrary native/Python Anki add-ons or speak every private AnkiWeb/package-storage protocol byte-for-byte.

## Implemented core features

### Collection, profiles, decks, and presets
- Multiple local profiles with profile-specific collections.
- Decks, nested decks using `Parent::Child`, deck creation/rename/delete, and card moves.
- Deck option presets, per-deck preset assignment, daily new/review limits, maximum interval, answer timer, audio autoplay, auto advance, sibling burying, new-card gathering order, review order, new/review mixing, Easy Days weights, leech threshold/action, learning/relearning steps, desired retention, and editable FSRS parameters.
- Filtered decks / Custom Study built from search expressions, including the choice to reschedule or leave original scheduling untouched.

### Notes, fields, card generation, and templates
- Anki-style Note -> Card model, while preserving older direct cards for backward compatibility.
- Built-in Basic, Basic (and reversed card), Basic (optional reversed card), Basic (type in the answer), Cloze, and Image Occlusion note types.
- Custom note types, custom fields, multiple card templates, front/back templates, CSS, cloning, and deletion of unused custom note types.
- Conditional and inverse field replacement, `FrontSide`, text filtering, hints, furigana/kana/kanji filters, TTS directives, typed answers, HTML templates, MathJax, and `[latex]...[/latex]` compatibility rendering.
- Cloze sibling generation by cloze number and Image Occlusion mask-card generation.
- Rich editor controls for bold/italic/underline, cloze insertion, MathJax/LaTeX, image/audio/video attachment, and microphone recording when the browser grants permission.

### Scheduler and review
- FSRS-6 scheduling with 21 parameters, trainable forgetting-curve form, desired retention, learning/relearning steps, maximum interval, and Easy Days adjustment.
- Again / Hard / Good / Easy ratings with next-interval previews.
- New, learning, review, relearning, suspended, and buried states.
- Review and new sibling burying, manual bury/unbury, suspend/unsuspend, reset/forget, Set Due Date, reposition, leech tagging/suspension, retry of failed cards, and filtered-deck non-rescheduling mode.
- Keyboard shortcuts: Space, 1-4 ratings, and R replay.
- Flags, marked/favorite state, card number, answer timer, replay, TTS/media playback, choice mode, type-answer mode, and the existing scratch pad.
- Active session persistence and same-device resume.

### Browser, search, and bulk editing
- Browser-style card list and search.
- Plain/accent-insensitive text, quoted terms, wildcard and regular-expression matching.
- `deck:`, `tag:`, field search, `note:`, `card:`, `flag:`, `cid:`, `nid:`, `is:`, `prop:`, added/edited/rated/answered date-style search and negation.
- Hierarchical tag/deck matching.
- Bulk suspend/unsuspend, bury/unbury, mark/unmark, flags 0-7, due-date changes, reset, reposition, deck move, delete, add/remove tags, find/replace, note editing/regeneration, and card info.
- Saved searches and undo snapshots for supported bulk/review operations.

### Statistics and FSRS tools
- Today / 7-day / 30-day counts and time.
- Accuracy, tag accuracy, card-state counts, rating counts, true-retention estimate, learning streak, 30-day forecast, and interval histogram.
- FSRS review-history evaluation (log loss and RMSE), lightweight parameter optimization, minimum-recommended-retention helper, and retention-based rescheduling.

### Import, export, backup, maintenance, and media
- Complete collection JSON import/export including notes, decks, note types, profiles, presets, cards, and history.
- Card CSV export and Basic note CSV/TSV import.
- Automatic local collection snapshots, restore, delete, and manual backup.
- Database integrity checks and empty-card cleanup.
- Duplicate-note checks and embedded/external/empty media-reference checks.
- Embedded browser media (images/audio/video), microphone recordings, TTS, and MathJax/LaTeX rendering.

### Offline, sync, and safety
- IndexedDB-first persistence for cards, review history, Anki collection state, settings, active session, sync queue, conflicts, and snapshots.
- Persistent-storage request where supported by the browser.
- Service Worker offline shell with content-derived cache versions.
- Existing HMAC-signed Google Apps Script / Google Sheets card and history synchronization retained.
- Remote legacy card updates preserve Anki-specific local metadata that the old Sheets schema does not know about.
- JSON backup includes the complete local Anki-style collection state.

## Browser/PWA substitutions and non-identical platform features

These are deliberately **not described as byte-for-byte Anki equivalence**:

1. **AnkiWeb account/sync protocol** — `work_1` keeps its existing Google Sheets/Apps Script synchronization for cards and review history. Full collection state is local-first and included in complete JSON backup. It does not impersonate the AnkiWeb protocol.
2. **`.apkg` / `.colpkg` / Anki SQLite package interoperability** — complete JSON collection import/export plus CSV/TSV import is provided, but the proprietary/native package containers are not parsed or emitted byte-for-byte.
3. **Arbitrary desktop add-ons** — Anki desktop add-ons can execute Python and modify internal/native UI behavior. A sandboxed static PWA cannot safely or faithfully execute arbitrary desktop add-ons. Custom note types/templates/CSS and the built-in extension points above are supported instead.
4. **Desktop media-folder filesystem semantics** — browser media is embedded in the collection and checked by reference rather than stored in Anki's native media directory/trash layout.
5. **Official Anki FSRS optimizer internals** — the review scheduler itself implements the current FSRS-6 formulas and 21-parameter model. The in-browser optimizer is a lightweight compatible optimizer, not a claim of numerical identity with every Anki desktop optimizer build.

## Verification gates

A release should not be called reviewed until all of the following pass on the exact release tree:
- TypeScript strict typecheck.
- Repository lint.
- Unit test suite for FSRS-6, note/card generation, Cloze, Image Occlusion, typed answers, search, and FSRS tools.
- Security pattern scan and `npm audit --audit-level=high`.
- Chromium E2E: boot -> card save -> Anki center -> note/card generation -> review -> IndexedDB persistence -> reload.
- WebKit E2E with the same flow for Safari/iPad-oriented compatibility.
- CodeQL.
- GitHub Pages build and deployment.

