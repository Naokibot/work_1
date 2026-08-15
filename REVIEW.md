# Final review record

## Review 1 — Functionality

Checked card create/edit/delete/duplicate/favorite flows, review-mode selection, self-rating and multiple-choice behavior, retry insertion, timer storage, session persistence, search, statistics, backup/export, and the Google Sheets sync queue design.

Automated tests cover the core scheduler, card selection, and canonical signing representation. Browser UI behavior is code-reviewed but not claimed as real-device tested.

## Review 2 — Data integrity

- IndexedDB is written before sync attempts.
- Failed sync does not delete cards, history, or queue entries.
- POST acknowledgements are not assumed from an opaque response; queue entries are removed only after `_SyncLog` confirms their request IDs.
- Card deletion is a tombstone (`deletedAt`) so deletion can synchronize to other devices.
- Remote-newer conflicts preserve the local payload as a separate conflict card.
- Review history is append-only in Google Sheets.
- Active review sessions are persisted after each answer.
- JSON backup excludes the sync secret.

## Review 3 — Security

- No production Apps Script URL or credential is in source.
- Sync configuration accepts only the official Apps Script `/exec` hostname/path form.
- HMAC-SHA-256 signatures cover action, timestamp, nonce, request ID, and a stable representation of the payload.
- Apps Script rejects stale timestamps and replayed nonces.
- Write request IDs are idempotent through `_SyncLog`.
- Spreadsheet formula-trigger characters are escaped before writes.
- Card content is rendered with DOM `textContent`, not `innerHTML`.
- A restrictive Content Security Policy limits script/connect destinations.
- GitHub Actions default to read-only permissions; deployment elevates only Pages/OIDC permissions.

## Review 4 — iPad / Safari / PWA

Code review checked:

- Minimum 44px controls and larger primary review buttons.
- Portrait and landscape responsive layout.
- Safe-area insets for Home Screen mode.
- No hover-dependent controls.
- Apple Pencil/touch via Pointer Events and `touch-action: none` on the scratch canvas.
- Scratch pad clear on every card transition.
- Service-worker scope and manifest use relative paths for `/work_1/` GitHub Pages deployment.
- Session restore after page reload/closure.
- Dark mode and reduced-motion preferences.
- VoiceOver-oriented labels and visible keyboard focus.

Real iPadOS Safari and physical Apple Pencil tests remain external acceptance tests.

## Review 5 — Code quality

The repository uses small modules for scheduling, storage, sync, review selection/controller, canvas, statistics, and DOM utilities. There is no runtime framework or dependency. TypeScript is the only development dependency. Build/lint/security scripts are implemented with Node standard library APIs.

## Automated validation performed in the development environment

- TypeScript strict typecheck: PASS
- Static build: PASS
- Unit tests: 9/9 PASS
- Repository lint script: PASS
- Secret/dangerous-pattern scan: PASS

## Not verified in this environment

- Physical iPad Safari behavior.
- Physical Apple Pencil behavior.
- Production Google Apps Script web-app transport.
- The user's real Google Sheet contents and permissions.
- GitHub-hosted Actions execution after push.
- GitHub Pages production deployment after push.
- Account/repository UI settings such as 2FA, Secret scanning, Push protection, and branch rulesets.
