# moodle.download

<p align="center">
  <img src="docs/logo.png" width="240" alt="moodle.download logo" />
</p>

<p align="center">
  <a href="../../actions/workflows/test.yml"><img alt="Test" src="../../actions/workflows/test.yml/badge.svg" /></a>
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-green.svg" /></a>
  <img alt="Manifest" src="https://img.shields.io/badge/manifest-MV3-blue" />
</p>

Browser extension (Chrome + Firefox) to **mass-download Moodle course materials** with **folder structure preservation** and **ZIP export**.

## Features

- Detects Moodle course pages across **any domain** (not limited to `moodle.org`)
- Extracts course resources (PDF, ZIP, DOCX, PPTX, videos, images, etc.) via flexible selectors
- Preserves section-based folder structure inside the ZIP
- **Download tracking** (SHA-256 hash) stored **locally** in `chrome.storage.local`
- Toggle: **Only show/mark files not yet downloaded**
- Retries for failed downloads
- Optional, GDPR-oriented **opt-in telemetry** (aggregated only)
- i18n: **German** + **English**
- Build targets:
  - `dist/chrome/` (MV3 Service Worker)
  - `dist/firefox/` (MV3 Service Worker)
  - `dist/firefox-compat/` (MV2 fallback for broader Firefox compatibility)

## Installation

### Chrome (Unpacked)

1. Build: `npm run build:chrome`
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. **Load unpacked** → select `dist/chrome/`

### Firefox (MV3 Service Worker)

1. Build: `npm run build:firefox`
2. Open `about:debugging#/runtime/this-firefox`
3. **Load Temporary Add-on** → select `dist/firefox/manifest.json`

### Firefox (Compat fallback)

If your Firefox channel/version doesn’t support MV3 Service Workers reliably:

1. Build: `npm run build:firefox:compat`
2. Load `dist/firefox-compat/manifest.json` as temporary add-on.

## Usage

1. Open a Moodle course page.
2. Click the extension icon.
3. Select resources (or toggle **“Show only new files”**).
4. Optionally choose a save location.
5. Click **Download as ZIP**.

## Privacy

By default, **no data is sent anywhere**.

- Download history is stored locally in your browser.
- Telemetry is **opt-in** and only sends aggregated counters.

See: `docs/PRIVACY.md`

## Development

```bash
npm install
cp .env.example .env

# watch-build (rebuild on changes)
npm run dev
```

Then reload the unpacked extension in your browser.

## Contributing

See: `docs/CONTRIBUTING.md`

## License

MIT — see `LICENSE`.
