# Architecture

## Overview

The extension consists of three primary components:

1. **Content Script** (`src/content/*`)
   - Detects Moodle pages.
   - Extracts downloadable resources and section-based folder structure.
   - Responds to popup requests via `chrome.runtime` messaging.

2. **Background** (`src/background/background.ts`)
   - Coordinates downloads and creates the ZIP via JSZip.
   - Performs authenticated fetches with `credentials: 'include'` so Moodle sessions work.
   - Tracks completed downloads (SHA-256) in `chrome.storage.local`.
   - Emits progress events back to the popup.

3. **Popup UI** (`src/popup/*`)
   - Lists extracted resources with selection controls.
   - Optional filter: only files not yet downloaded.
   - Triggers ZIP build and shows progress.

## Messaging

- Popup → Content: `MD_EXTRACT_RESOURCES`
- Popup → Background: `MD_BUILD_ZIP`, tracking + telemetry settings
- Background → Popup: progress + completion events

All message types and payloads are defined in `src/shared/types.ts`.

## Storage

- `downloadTracking`: `{ [fileUrl]: { hash, timestamp, fileName } }`
- `telemetryAsked`, `telemetryOptIn`

See `src/shared/storage.ts` for a typed wrapper.

## Build

We intentionally build each entry (background/content/popup) as a **single self-contained bundle** to avoid ES module imports in content scripts.

Build orchestration: `scripts/build.mjs`.

Targets:

- `dist/chrome/` (MV3 service worker)
- `dist/firefox/` (MV3 service worker)
- `dist/firefox-compat/` (MV2 fallback)
