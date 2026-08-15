# Release review record

## Anki-core expansion review — 2026-08-15

### 1. Feature-model review
The collection model was changed from a single flat-card model to an Anki-style note/card model while retaining compatibility with pre-existing cards. Notes own fields, tags, a note type, and a deck; card templates generate one or more sibling cards. Built-in Basic, reversed, optional reversed, typed-answer, Cloze, and Image Occlusion note types are present. Custom note types, fields, templates, and CSS are stored in IndexedDB as collection state.

### 2. Scheduling review
The former small custom interval heuristic was replaced by an FSRS-6 implementation with 21 parameters, desired retention, learning/relearning steps, same-day behavior, maximum interval, and Easy Days adjustment. Review uses per-deck presets. Failed reviews update lapses, leech policy, and learning state; sibling burying and filtered-deck reschedule/no-reschedule behavior are applied before moving to the next card.

The scheduler is intended to follow FSRS-6. The local parameter optimizer is intentionally described as a lightweight optimizer and is not claimed to reproduce every official Anki optimizer result numerically.

### 3. Data-integrity review
- Cards, history, notes, decks, profiles, presets, note types, filtered decks, saved searches, undo records, session state, settings, and snapshots are persisted in IndexedDB.
- Review writes the updated card and append-only review history before remote synchronization.
- Existing card/history Google Sheets synchronization is preserved.
- Legacy remote card payloads do not erase Anki-specific local metadata absent from the old Sheets schema.
- Complete JSON backup carries the entire local collection state, not just the legacy cards.
- Automatic snapshots and collection integrity checks are available.

### 4. Review/browser feature review
Reviewed search parsing, hierarchical tags/decks, flags, marked state, suspend/bury, due-date changes, reset, reposition, deck moves, tags, find/replace, note regeneration, saved searches, filtered decks, typed answers, Cloze siblings, Image Occlusion masks, media, TTS, answer timing, keyboard shortcuts, and next-interval previews.

### 5. iPad/WebKit review
The application keeps the prior iPad compatibility work: content-versioned Service Worker cache, dialog fallbacks, ResizeObserver fallback, persistent-storage request, Pointer Events scratchpad, safe-area layout, and non-hover controls. A browser E2E test now runs the same persistence/review workflow in both Chromium and Playwright WebKit.

### 6. Security review
- Rich card/template markup is parsed through an allow-list sanitizer before being inserted into the document.
- JavaScript evaluation and arbitrary add-on code execution are not enabled.
- Media URLs are restricted to supported safe schemes/embedded data.
- Existing HMAC synchronization, nonce/timestamp protection, formula-injection handling on the Apps Script side, and CSP remain in place.
- The build includes a secret/dangerous-pattern scan, dependency audit, and CodeQL workflow.

### 7. Honest compatibility boundary
`ANKI_PARITY.md` is the authoritative compatibility matrix. Native AnkiWeb protocol identity, arbitrary Python desktop add-ons, exact `.apkg/.colpkg`/SQLite package compatibility, and desktop media-folder filesystem semantics are not falsely labelled as implemented. Browser-safe substitutes are documented.

### Required final validation
The final GitHub release tree must pass CI (lint/typecheck/unit/security/audit plus Chromium/WebKit E2E), CodeQL, and GitHub Pages deployment before this review is considered complete.
