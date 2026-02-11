# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-02-11

### Fixed

- Prevent corrupted ZIP downloads on Chrome by building and downloading ZIPs in the background service worker.
- Keep ZIP byte streams consistent when transferring between background and popup.

### Changed

- Installation guide now points to the latest releases instead of local builds.

## [1.1.0] - 2026-02-11

### Added

- Firefox MV2 compat build target (`firefox-compat`)

### Changed

- Popup UI: dark theme, flat styling, hard corners, and per-file type labels
- Popup UI: GitHub repository link in header
- Popup list: file-type badge class sanitization (e.g. `7z`), keeping type sorting stable

### Fixed

- Linting Problems

### Removed

- None

## [1.0.0] - 2026-02-07

### Added

- Initial release
- Mass download of Moodle resources
- ZIP export with folder structure
- Download tracking (SHA-256 hashes)
- Optional anonymous telemetry (GDPR-compliant)
- Chrome and Firefox support
- German and English localization

### Changed

- None

### Fixed

- None

### Removed

- None