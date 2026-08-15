# Review record

## 2026-08-15 card number, persistence, and iPad button fix

### Review 1 — Functionality

Reviewed card creation/editing/duplication, review sessions, correct/incorrect tracking, backup/export, navigation, dialogs, and Service Worker updates.

Changes:

- Added a user-editable `cardNumber` field. It is separate from the internal immutable card ID, so changing the visible number does not break review history.
- Card numbers are shown in the card list and review screen and are included in search.
- JSON backup naturally includes card numbers; CSV export now has a `CardNumber` column.
- Review history stores a card-number snapshot in local data for future display/inspection while continuing to link by internal card ID.
- Duplicate cards intentionally start with an empty visible number to avoid accidental duplicate numbering.

### Review 2 — Same-device data integrity

Cards and review history were already stored in IndexedDB. Review answers update the card statistics and append history before any cloud synchronization attempt. This behavior is retained.

Additional safeguards:

- The app requests persistent browser storage when supported.
- Settings now explicitly explain that cards, card numbers, and correct/incorrect history remain on the same device/browser installation unless site data is cleared.
- JSON backup remains available for protection against browser-data deletion.
- Remote synchronization from an older Apps Script deployment no longer removes a locally stored card number when the server response does not contain that field.

### Review 3 — iPad / Safari button failure

Found several compatibility/update risks that could make a deployed page render while controls appear unresponsive:

1. The Service Worker cache name was permanently fixed at `work-1-v1`. A new deployment could therefore continue serving stale JavaScript. The build now creates a content-derived cache version so every changed build activates a new cache and removes the old one.
2. Card/study dialogs depended on `method="dialog"` and `SubmitEvent.submitter`. They now use explicit `type="button"` cancel/close controls and normal submit events.
3. Dialog opening now has a fallback when `showModal()` is unavailable.
4. The scratch pad directly constructed `ResizeObserver`. It now has resize/orientation fallbacks so failure of that API cannot prevent the whole app from binding buttons.
5. `crypto.randomUUID()` now has a secure `getRandomValues()` fallback for older WebKit versions.
6. Top-level `await` was removed from the application entry point. Initialization errors are surfaced in the status area instead of leaving a silently non-interactive page.
7. Download object URLs are revoked after a short delay rather than immediately, which is safer for Safari downloads.

### Review 4 — Learning records

- Correct/incorrect counts remain on each card and review history remains append-only locally.
- Each answer persists card state, history, sync queue, and active session progress.
- The configured idle timeout is now actually applied: very long idle responses are recorded with `responseMs = 0` and excluded from speed averages while the correct/incorrect result itself is preserved.
- Incorrect cards continue to be inserted several questions later in the session.

### Review 5 — Security and code quality

- The visible card number is treated as plain text and rendered with `textContent` through the existing DOM helpers.
- Card-number length is limited to 100 characters.
- No secrets were added to source.
- IndexedDB schema does not require a migration because it stores structured objects and the new fields are backward-compatible optional fields.
- The cloud backend remains backward-compatible: same-device card-number persistence does not require an Apps Script redeployment. Card-number synchronization to Google Sheets can be added separately if desired.

## Validation target

The repository CI must pass lint, TypeScript strict checking, unit tests, build, security checks, and audit after this change. A new unit-test file covers card-number trimming, optional values, and the maximum length.

Physical iPad Safari / Apple Pencil behavior remains a device acceptance test. After deployment, fully close and reopen the Home Screen PWA once so the new Service Worker can take control; the new versioned cache prevents later releases from remaining stuck on an older JavaScript bundle.
