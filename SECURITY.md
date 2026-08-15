# Security Policy

## Supported version

The `main` branch is the supported version.

## Secrets

Never commit API keys, OAuth tokens, Google credentials, private keys, passwords, or the sync secret. The browser app stores its sync secret only in IndexedDB on the device. The Apps Script copy of the same secret belongs in Script Properties as `SYNC_SECRET`.

The Apps Script deployment URL is not treated as a secret. Authorization is provided by a short-lived HMAC-SHA-256 signature. Requests include a timestamp, nonce, and request ID. Apps Script rejects requests outside a five-minute window and rejects reused nonces.

## Google Apps Script deployment

The static GitHub Pages client cannot safely contain a Google OAuth client secret. For the personal sync design in this repository, deploy the Apps Script web app as the deploying user and allow requests to reach the endpoint, then rely on the HMAC layer in `gas/Code.gs` for application-level authorization. Do not transmit `ScriptApp.getOAuthToken()` or any Google access token to the browser.

Use a randomly generated sync secret of at least 32 characters. If the iPad is lost or the secret may have been exposed, replace `SYNC_SECRET` in Script Properties and re-enter the new value on trusted devices.

## Spreadsheet injection

Apps Script prefixes text that begins with `=`, `+`, `-`, `@`, tab, or carriage return before writing it to Sheets. This prevents user-supplied card content from being interpreted as formulas. The prefix is removed when data is read back through the sync API.

## Browser content

Card content is inserted with `textContent`, not HTML. A restrictive Content Security Policy is included in `index.html`. The configured Apps Script URL is limited to the official `https://script.google.com/macros/s/.../exec` form so that the local sync secret is not sent to an arbitrary host.

## GitHub repository settings

Recommended settings for `work_1`:

- Require 2FA on the GitHub account.
- Enable Secret scanning and Push protection.
- Enable Dependabot alerts and Dependabot security updates.
- Enable Code scanning.
- Create a ruleset for `main` that requires pull requests and passing CI checks before merge.
- Prevent force pushes and branch deletion on `main`.
- Keep GitHub Actions permissions read-only by default. Deployment jobs in this repository elevate only `pages: write` and `id-token: write`.

Some repository settings must be enabled in the GitHub UI by an administrator and cannot be enforced by source files alone.

## Reporting a vulnerability

Do not open a public issue containing secrets or exploitable personal data. Revoke or rotate affected secrets first, then report the issue privately to the repository owner.
