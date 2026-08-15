# work_1 Study Cards

An iPad-first, offline-first spaced-repetition web app. It runs as a static Progressive Web App on GitHub Pages and optionally synchronizes cards and review history with Google Sheets through a Google Apps Script web app.

## Project overview

The project is designed for daily personal study on iPad. Cards can be created and edited in the PWA, studied offline, reviewed with four self-ratings, or answered as shuffled multiple-choice questions. Review state and history are stored in IndexedDB first, so a failed network request does not erase local study data.

The scheduler is deliberately transparent. It uses the same core concepts commonly used by modern spaced-repetition systems—difficulty, stability, elapsed time, and retrievability—but it is **not an official FSRS implementation**. `src/scheduler/scheduler.ts` contains the complete formula so it can be inspected and changed without a hidden dependency.

## Features

- iPad, iPhone, and desktop responsive UI.
- Installable PWA with GitHub Pages sub-path support (`/work_1/`).
- IndexedDB persistence for cards, history, settings, sync queue, conflicts, and active sessions.
- Offline study after the first successful load.
- Four review ratings: Again, Hard, Good, Easy.
- Shuffled multiple-choice mode using the correct answer plus up to three distractors.
- Actual correct/incorrect history for multiple-choice sessions.
- Retry of incorrect cards several questions later in the same session.
- Apple Pencil / touch scratch pad with pen, eraser, undo, redo, and clear.
- Scratch pad is cleared automatically when the next card is shown.
- Per-card answer timing and recent timing statistics.
- Due, new, weak, recently wrong, favorite, random, tag, and exam modes.
- Tag filtering, search, duplicate, edit, soft delete, and favorites.
- Session recovery after Safari is closed or the iPad sleeps.
- Today / 7-day / 30-day statistics and weak-card ranking.
- JSON backup/restore and CSV card export.
- Optional Google Sheets synchronization using an HMAC-signed Apps Script API.
- Conflict preservation: when a remote edit is newer, the local version is saved as a separate `sync-conflict` card instead of being silently discarded.
- Formula-injection defense in Apps Script.
- CSP and DOM text insertion that avoids rendering card content as HTML.

## Architecture

```text
iPad Safari / installed PWA
        |
        +-- IndexedDB (authoritative local-first store)
        |     Cards / History / Queue / Session / Settings
        |
        +-- Service Worker (offline app shell)
        |
        +-- HMAC-signed sync
                |
                v
        Google Apps Script Web App
                |
                v
        Google Sheets
        - Cards
        - History
        - _SyncLog (hidden internal idempotency/ack log)
```

The PWA never contains the spreadsheet ID, Google credentials, or a Google OAuth token. Apps Script reads `SPREADSHEET_ID` and `SYNC_SECRET` from Script Properties. The user enters the same sync secret on trusted devices, where it is stored in IndexedDB and used by Web Crypto to create short-lived HMAC-SHA-256 request signatures.

Because a static GitHub Pages site cannot safely keep a client secret, the Apps Script endpoint must be reachable by the PWA. Application-level authorization is then enforced by the HMAC layer. Requests include a timestamp, nonce, and idempotent request ID. Apps Script rejects stale timestamps and replayed nonces.

### Sync transport

Apps Script Content Service responses are cross-origin. Reads use a signed JSONP callback with a strictly validated callback identifier; the secret itself is never placed in the URL. Writes use `fetch(..., { mode: "no-cors" })`; successful write acknowledgement is learned on the next signed pull through `_SyncLog`. This keeps writes idempotent even when the browser cannot inspect the cross-origin POST response.

## Directory structure

```text
.github/                 GitHub Actions, CodeQL, Dependabot
public/                  PWA manifest, icon, service-worker template
gas/                     Google Apps Script backend
scripts/                 zero-dependency build/lint/security scripts
src/
  app/                    application orchestration
  canvas/                 Apple Pencil/touch scratch pad
  cards/                  card creation and validation
  review/                 card selection and review controller
  scheduler/              transparent spaced-repetition scheduler
  statistics/             local statistics
  storage/                IndexedDB and backup/restore
  sync/                   HMAC and Apps Script sync client
  ui/                     safe DOM helpers
  utils/                  shared helpers
tests/                    Node unit tests
```

## Requirements

- Node.js 20 or newer for development. CI uses Node.js 22.
- TypeScript 5.8.3 (installed by `npm install`).
- A modern Safari/Chrome/Edge browser with IndexedDB.
- An HTTPS origin for PWA features. GitHub Pages provides HTTPS.
- For cloud synchronization: Google Sheets and Google Apps Script.

## Local development

Install the single development dependency:

```bash
npm install
```

Run all checks:

```bash
npm run check
```

Build the static site:

```bash
npm run build
```

Serve `dist/` with any local static HTTP server. Do not test service workers from a `file://` URL.

## Testing

```bash
npm run lint
npm run typecheck
npm test
npm run security
```

`npm test` builds the project and runs the Node test suite. The repository includes scheduler ordering, lapse behavior, bounded difficulty, retrievability decay, new-card limits, weak-card selection, tag selection, and canonical HMAC payload tests.

The repository source can be automatically checked in GitHub Actions. Real iPad Safari, Apple Pencil, Google Apps Script deployment, and the user's live spreadsheet are external environments and still require device/deployment acceptance testing.

## Google Sheets setup

1. Create or open the Google Sheet you want to use.
2. Open **Extensions → Apps Script** from that sheet.
3. Copy `gas/Code.gs` into `Code.gs`.
4. If desired, copy the settings in `gas/appsscript.json` into the Apps Script manifest.
5. Run `setup()` once from the Apps Script editor and approve the requested Sheets permission.
6. `setup()` creates or prepares these sheets:
   - `Cards` — card state.
   - `History` — append-only review history.
   - `_SyncLog` — hidden internal request acknowledgement log.
7. On the first run only, `setup()` generates a long `SYNC_SECRET` and prints it in the execution log. Copy it to a secure password manager, then enter it in the PWA settings. Later runs do not print an existing secret.

### Cards sheet columns

`Cards` contains readable card content plus scheduling state:

```text
ID, Question, Answer, Distractor1, Distractor2, Distractor3,
Explanation, Tags, Favorite, CreatedAt, UpdatedAt, DeletedAt,
Stability, Difficulty, DueAt, Reps, Lapses, Streak,
CorrectCount, IncorrectCount, TotalTimeMs, FastestMs,
LastTimesMs, LastReviewAt, Version, LastRequestId
```

You can add cards directly in Google Sheets. Put a question in `Question` and an answer in `Answer`; the simple `onEdit` trigger supplies an ID, timestamps, and initial scheduling fields. Existing rows edited manually also receive a new `UpdatedAt` value so the PWA can discover the change.

Do not rename or reorder the generated headers unless you also update `gas/Code.gs`.

## Google Apps Script setup

After `setup()` succeeds:

1. Select **Deploy → New deployment**.
2. Choose **Web app**.
3. Execute the app as the deploying account so it can access that account's Sheet.
4. Configure access so the GitHub Pages PWA can reach the endpoint. The application-level HMAC check in `Code.gs` rejects unsigned requests.
5. Deploy and copy the URL ending in `/exec`.
6. In the PWA, open **Settings** and paste the `/exec` URL.
7. Enter the `SYNC_SECRET` generated by `setup()`.
8. Save, then press the sync button.

Use the `/exec` deployment URL for the PWA. The Apps Script `/dev` URL is intended for development and is restricted to script editors.

If the device clock differs from real time by more than five minutes, signed sync requests are intentionally rejected. Correct the device clock before retrying.

## GitHub Pages deployment

The repository includes `.github/workflows/pages.yml`.

1. Push the repository to `Naokibot/work_1`.
2. Open **Settings → Pages** in GitHub.
3. Set the source to **GitHub Actions**.
4. Push to `main` or manually run **Deploy GitHub Pages**.
5. After deployment the expected URL is:

```text
https://naokibot.github.io/work_1/
```

All runtime URLs are relative. `manifest.webmanifest`, service-worker registration, module imports, and cached assets therefore work under `/work_1/` instead of assuming the domain root.

## Installing the PWA on iPad

1. Open the GitHub Pages URL in Safari.
2. Tap the Share button.
3. Choose **Add to Home Screen**.
4. Launch **Study Cards** from the Home Screen.
5. Open Settings and configure sync if you want Google Sheets backup/synchronization.

The app remains usable without sync. Cards and history are always written to IndexedDB first.

## Offline operation

The service worker precaches the complete application shell and compiled JavaScript modules. Offline changes are written to IndexedDB and appended to the sync queue. The queue is not deleted after an opaque cross-origin POST. It is removed only when a later authenticated pull reports the matching request ID from `_SyncLog`.

When connectivity returns, the app attempts synchronization automatically. Manual sync is also available from the top-right sync button.

## Backup and restore

Settings → Backup offers:

- JSON export: cards plus history.
- JSON import: validates the backup format before replacing local cards/history.
- CSV export: readable card content for external editing/archival.

The sync secret is deliberately excluded from exported backups.

Before importing a JSON backup, the UI asks for confirmation because import replaces the local card/history datasets. The Google Sheets copy is not automatically deleted by a local import.

## Security

See `SECURITY.md` for the complete security model.

Key points:

- No secrets are committed to GitHub.
- Sync secrets are stored in browser IndexedDB and Apps Script Script Properties.
- Sync signatures use HMAC-SHA-256 through Web Crypto / Apps Script Utilities.
- Timestamps and nonces reduce replay risk.
- Request IDs make retries idempotent.
- The browser only accepts official `script.google.com/macros/s/.../exec` endpoints for sync configuration.
- Card text is rendered with `textContent`.
- Sheets values beginning with formula-trigger characters are escaped before writing.
- Local data is never deleted just because a sync call fails.

A determined attacker with access to an unlocked trusted iPad can inspect browser storage and recover the local sync secret. Treat the device as part of the trust boundary and rotate the secret if the device is lost.

## GitHub repository security settings

Source-controlled protections included here:

- CI validation.
- CodeQL workflow.
- Dependency Review workflow.
- Dependabot configuration for npm and GitHub Actions.
- Minimal workflow permissions; Pages write and OIDC permissions are scoped to the deployment job.
- `.gitignore` patterns for common credentials and private keys.

Enable these repository/account settings in GitHub as well:

1. Account 2FA.
2. Secret scanning.
3. Push protection.
4. Dependabot alerts and security updates.
5. Code scanning.
6. A `main` branch ruleset requiring pull requests and successful CI checks.
7. Block force-push and deletion of `main`.
8. Set default GitHub Actions workflow permissions to read-only.

## Troubleshooting

### Sync says the Apps Script URL is invalid

Use the deployed web-app URL that starts with `https://script.google.com/macros/s/` and ends with `/exec`.

### Authentication failed

The PWA and Script Properties do not have the same `SYNC_SECRET`, or the secret was changed. Enter the current secret again on the device.

### Timestamp rejected

Enable automatic date/time on iPad. Requests more than five minutes away from Apps Script time are rejected.

### Cards created in Sheets do not appear

Confirm the script is bound to the same spreadsheet, `setup()` has been run, and the `Cards` headers are unchanged. Editing `Question` or `Answer` should cause `onEdit` to populate `ID` and `UpdatedAt`. Then sync again from the PWA.

### Offline screen does not load

Open the deployed PWA online at least once so the service worker can install and cache the app shell.

### A card named “(conflict copy)” appeared

The same card was edited on the device and remotely, and the remote version was newer. The app intentionally preserved the local edit as a new card tagged `sync-conflict` rather than silently overwriting it. Compare the two cards and delete the one you do not need.

## Known limitations

- The scheduler is an inspectable FSRS-inspired model, not the official FSRS algorithm or a drop-in Anki scheduler.
- Real Apple Pencil pressure/behavior can vary by iPadOS/Safari version. The code uses Pointer Events and falls back to a default pressure value.
- The web app cannot force iPadOS to keep the display awake. It requests the Screen Wake Lock API only when the browser supports it.
- Browser storage can be cleared by the operating system or user. Keep Google Sheets sync or periodic JSON backups if the data matters.
- Google Apps Script quotas and Google Sheets limits still apply.
- The sync transport depends on Apps Script web-app behavior. A real deployed Apps Script endpoint must be acceptance-tested because this repository cannot emulate Google's production redirects locally.
- GitHub security settings such as branch rulesets and account 2FA must be enabled in the GitHub UI; workflow files cannot force those account/repository settings.
- No real iPad, Apple Pencil, or production Google Apps Script connection was available during automated repository tests. These are explicitly not claimed as verified.

## License

No license has been selected. Add a license before redistributing the project outside your personal use or team unless you intentionally want normal copyright defaults to apply.
