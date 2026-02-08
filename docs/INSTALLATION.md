# Installation

## From source

```bash
npm install
cp .env.example .env
```

### Build for Chrome

```bash
npm run build:chrome
```

Load unpacked:

- Open `chrome://extensions`
- Enable **Developer mode**
- Click **Load unpacked** → select `dist/chrome/`

### Build for Firefox (MV3 service worker)

```bash
npm run build:firefox
```

Load temporary add-on:

- Open `about:debugging#/runtime/this-firefox`
- Click **Load Temporary Add-on** → select `dist/firefox/manifest.json`

### Build for Firefox (compat fallback)

```bash
npm run build:firefox:compat
```

Load `dist/firefox-compat/manifest.json` the same way.
