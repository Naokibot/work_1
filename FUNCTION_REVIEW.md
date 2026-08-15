# Comprehensive Function Review

Date: 2026-08-15

This review is a release gate for the Study Cards PWA. A feature is only called browser-verified when the automated acceptance flow performs the corresponding UI/data operation in Chromium and WebKit. Browser tests wait for observable UI state rather than relying on fixed short sleeps for major screen transitions.

## Browser acceptance scope

- Application boot and PWA manifest/Service Worker availability.
- Deck creation.
- Basic card creation with an optional user card number and IndexedDB persistence.
- Basic reversed-card generation.
- Cloze sibling-card generation.
- Custom Study dialog.
- Review flow, answer reveal, Good grading, history persistence.
- Scratch pad pointer input, undo, redo and clear.
- Interrupted-session persistence and automatic restoration after reload.
- Browser search plus suspend/unsuspend operations.
- Filtered deck creation.
- Custom note-type creation.
- FSRS option save and FSRS evaluation action.
- Manual backup snapshot, database check and media check.
- Statistics rendering.
- JSON and CSV export.
- Sync client transport with an engine-independent in-page mock of a Google Apps Script endpoint. The mock uses a production-shaped GAS URL and exercises the actual `fetch()` write plus `document.head.append(script)` JSONP pull path without depending on Playwright network interception behavior.
- Profile creation and switching.
- Offline/PWA behavior: Chromium performs an actual forced-offline reload; WebKit verifies the installed Service Worker cache contains the application shell. Playwright WebKit's forced-offline reload can fail with an internal harness error, so that harness behavior is not misreported as an application failure.

The existing acceptance suite additionally verifies `.apkg` round-trip import/export, Image Occlusion pointer editing, IndexedDB persistence after reload, and both Chromium/WebKit engines.

## Review findings fixed in this cycle

- Interrupted study sessions were persisted but startup only displayed a notice; the app now automatically resumes the stored review session.
- Browser acceptance previously used a short fixed delay for a major screen transition; it now waits for the observable Browser UI state to avoid WebKit timing flakes.
- One-shot patch workflows used during review were removed after their changes were applied.

## Non-browser/external boundaries

A real Google Apps Script deployment and the user's real Google Sheet are external services. The repository can validate the client transport, signing, queue handling and GAS code, but production end-to-end sync is not claimed unless a real deployment URL/secret is supplied and exercised.

A physical iPad/Apple Pencil is also external hardware. WebKit and Pointer Events are release-tested, but that is not represented as a physical-device test.

Official AnkiWeb identity/synchronization, arbitrary Python/Qt add-ons, and native desktop OS integration are outside the static GitHub Pages PWA architecture and are not represented as implemented.
