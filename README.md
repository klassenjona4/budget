# Budget

An offline budget tracker that installs to the home screen. All data stays on
the device, encrypted with AES-GCM 256. There is no backend, no account and no
network traffic at runtime. After the first install the app works permanently
in airplane mode.

Currency is EUR. Amounts are formatted with the de-DE locale by default and can
be switched to en-IE in the settings.

## Requirements

Node 20 or newer.

## Local development

```
npm install
npm run dev
```

The dev server prints a local URL. The base path defaults to `/budget/`, so the
app is served at `http://localhost:5173/budget/`.

Note: the React Fast Refresh plugin is deliberately not installed, so an edit
reloads the page and locks the vault again. Type checking runs with
`npm run typecheck`.

## Build

```
npm run build
npm run preview
```

`npm run build` regenerates the icons, type checks with `tsc -b`, then builds
with Vite. The service worker is produced by vite-plugin-pwa in `generateSW`
mode with no runtime caching, because nothing is fetched at runtime.

To build for a deployment at the domain root:

```
BASE_PATH=/ npm run build
```

## Deployment

The app is a static folder. Copy `dist` to any static host that serves over
HTTPS. HTTPS is required: WebAuthn, service workers and persistent storage all
need a secure context.

For a GitHub Pages project site at `https://<user>.github.io/budget/`, build
with the default base path and publish `dist` to the `gh-pages` branch. For a
user site at the domain root, build with `BASE_PATH=/`.

Navigation uses the URL hash, so no server rewrite rules are needed.

### Installing on a phone

- iOS: open the URL in Safari, then Share, then Add to Home Screen.
- Android: open the URL in Chrome, then Install app.

Enrol the biometric from inside the installed app, not from the browser tab.

## Icons

`scripts/generate-icons.mjs` holds the icon geometry once and writes
`public/icon.svg` plus every PNG size from it. The PNGs are encoded by hand
with the built in zlib, so no image library is needed. The script runs as part
of `npm run dev` and `npm run build`.

## Fonts

The app uses the system font stack. To self host a font instead, put the
`woff2` files in `public/fonts`, declare them with `@font-face` in
`src/styles/index.css` and add the family to the `--font-stack` custom
property. They will be precached automatically. Never link to a font CDN.

## Security model

```
DEK  (data encryption key)   random 32 bytes, AES-GCM 256, created once at setup
 |
 +-- wrapped by KEK_pin      PBKDF2-SHA256(pin, salt_pin, 600000) -> 256 bit
 |
 +-- wrapped by KEK_bio      HKDF-SHA256(prfOutput, salt_bio, info) -> 256 bit
```

Both wrapped copies live in IndexedDB. Either unlock path recovers the same
DEK. While unlocked the DEK exists only in memory as a non extractable
`CryptoKey`. Nothing decrypted is ever written to `localStorage` or
`sessionStorage`.

Records are stored one per row. Only `id` and `type` are plaintext, the payload
is AES-GCM ciphertext with a fresh 12 byte IV per write. Amounts are integer
cents everywhere, including in the formatter, which is given a decimal string
rather than a floating point number.

Failed PIN attempts are counted in IndexedDB and survive a restart. Attempts 1
to 4 are free, then the keypad locks for 5, 15, 60 and 300 seconds on each
further failure. The optional `wipeAfterFailures` setting deletes everything
after 10 consecutive failures.

### Biometric modes

- `prf`: the authenticator returned a stable secret through the WebAuthn PRF
  extension. It is run through HKDF to rebuild the wrapping key, so the
  biometric is genuinely part of the encryption.
- `gate`: the authenticator does not support PRF. A random device key wraps the
  DEK and a successful WebAuthn assertion with user verification is required
  before it is used. The key material is present on the device, so the check
  guards the interface rather than the data, and the real protection is the
  phone lock screen. The PIN path is unaffected and stays fully encrypted.

The current mode is shown in the settings screen with the same explanation.

Enrolling a biometric and changing the PIN both ask for the current PIN,
because the DEK has to be unwrapped before it can be wrapped again. A wrong PIN
in either dialog counts towards the failure backoff.

## Backup, and what to do about a forgotten PIN

There is no recovery route for a forgotten PIN other than restoring an
encrypted backup. No password reset exists, because no server holds anything.
If the PIN is lost and there is no backup, the data is gone.

Export a backup from Settings, Export encrypted backup. The file is
`budget-backup-YYYY-MM-DD.json` and contains
`{version, kdf, salt, iv, ct}`, encrypted under a key derived from a
passphrase with PBKDF2-SHA256 at 600000 iterations. Store the passphrase
somewhere other than the file. On iOS the download opens the share sheet, so
choose Save to Files or send it somewhere durable.

To restore: install the app, set any new PIN, then Settings, Import backup,
choose the file, enter the passphrase and pick Replace all. A wrong passphrase
fails with a message and changes nothing.

The CSV export is unencrypted and is meant for reading elsewhere, not for
restoring.

The Overview screen shows a reminder when the last backup is more than 30 days
old, or when there has never been one. Deleting the home screen icon on iOS
deletes the database with it, which is why the reminder exists.

## Running it permanently on a phone

Install the deployed URL as a PWA and treat that origin as the app's identity
for good. Once installed, Android gives it its own icon, its own entry in the
app drawer and its own task in the recents list, and it launches without any
browser chrome.

Three things to get right before entering real data:

1. **Fix the URL first.** IndexedDB and WebAuthn credentials are both bound to
   the origin. Renaming the repository, moving to a custom domain or switching
   between a project site and a user site all produce a different origin, and
   the old data is not visible from the new one. Decide on the address, then
   set up the PIN.
2. **Check that storage is persistent.** Settings, Storage shows the current
   state. Chrome normally grants persistence to an installed app without
   asking. If it still reports that storage is not persistent, use Request
   persistent storage on that screen.
3. **Export a backup and keep the passphrase somewhere else.** The backup file
   is encrypted, so putting it in Google Drive or any other cloud storage does
   not expose the contents. The passphrase belongs in a password manager, not
   next to the file.

The data is deleted, with no recovery other than a backup, by any of these:

- uninstalling the app,
- clearing site data for the origin in Chrome, including a broad Clear
  browsing data that covers cookies and site data,
- Delete all data in Settings, or 10 failed PIN attempts when
  `wipeAfterFailures` is on.

Updates are automatic. A push to `main` rebuilds and redeploys, and the service
worker is registered with `autoUpdate`, so the installed app picks up the new
version on a later launch.

Native packaging with a Trusted Web Activity or a WebView wrapper is possible
but buys nothing here. A TWA still stores everything in the same Chrome origin,
and it needs a Digital Asset Links file at the domain root, which a GitHub
Pages project site cannot serve.

## Storage persistence

After the first successful unlock the app calls `navigator.storage.persist()`
and shows the result in Settings, where it can also be requested again. Without
persistence the browser may evict the database under storage pressure.

## Project layout

```
scripts/generate-icons.mjs   icon geometry and PNG encoder
src/lib/crypto.ts            all Web Crypto usage
src/lib/db.ts                all IndexedDB usage
src/lib/vault.ts             unlock, enrolment, backoff, key rotation
src/lib/records.ts           encrypted record repository and validation
src/lib/backup.ts            encrypted backup, CSV, import
src/lib/budget.ts            budget arithmetic, integers only
src/lib/money.ts             cents parsing and formatting
src/lib/period.ts            budget periods from the month start day
src/state/store.tsx          decrypted state, actions, auto lock
src/views/                   one file per screen
src/components/              keypad, dialog, progress bar, tab bar, switch
src/styles/index.css         every colour, spacing, radius and size token
```

Components never call Web Crypto or IndexedDB directly.

## Dependencies

vite, react, react-dom, typescript, vite-plugin-pwa, idb, date-fns, and the
type packages for React and Node. Everything else, including all cryptography,
the router and the icon pipeline, is written by hand.

## Non goals

Bank import, PSD2 or Open Banking, multi device sync, multi currency, receipt
photos, shared budgets, cloud backup, accounts or ledgers, and recurring
transaction automation are out of scope.
