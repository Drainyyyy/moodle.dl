import { defineConfig, loadEnv, type Plugin } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';

type BuildTarget = 'chrome' | 'firefox' | 'firefox-compat';

async function readJson(filePath: string): Promise<any> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw);
}

function resolveFirefoxManifest(env: Record<string, string>): string {
  // Requested option B: Firefox MV3 Service Worker.
  // For legacy manifest builds (not recommended), set VITE_FIREFOX_SERVICE_WORKER=false.
  const useSw = (env.VITE_FIREFOX_SERVICE_WORKER || 'true') === 'true';
  return useSw ? 'manifests/manifest.firefox.sw.json' : 'manifests/manifest.firefox.json';
}

function resolveManifestPath(target: BuildTarget, env: Record<string, string>): string {
  if (target === 'chrome') return 'manifests/manifest.chrome.json';
  if (target === 'firefox') return resolveFirefoxManifest(env);
  return 'manifests/manifest.firefox.compat.json';
}

function manifestGeneratorPlugin(target: BuildTarget, env: Record<string, string>): Plugin {
  return {
    name: 'moodle-download-manifest-generator',
    async writeBundle(options) {
      const outDir = options.dir || '';
      if (!outDir) return;

      const base = await readJson(path.resolve('manifests/manifest.base.json'));

      const browserSpecific = await readJson(path.resolve(resolveManifestPath(target, env)));

      // Single source of truth for version: package.json (env override supported for CI).
      const pkg = await readJson(path.resolve('package.json'));

      const merged: any = {
        ...base,
        ...browserSpecific,
        version: env.VITE_EXT_VERSION || pkg.version || base.version,
      };

      // If locales exist, Chrome requires default_locale.
      merged.default_locale = merged.default_locale || 'en';

      // MV2 compat: remove MV3-only fields and ensure host permissions are in permissions.
      if (merged.manifest_version === 2) {
        delete merged.host_permissions;
        if (Array.isArray(merged.permissions) && !merged.permissions.includes('<all_urls>')) {
          merged.permissions.push('<all_urls>');
        }
      }

      await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(merged, null, 2));
    },
  };
}

function copyPopupAndLocalesPlugin(): Plugin {
  return {
    name: 'moodle-download-copy-assets',
    async writeBundle(options) {
      const outDir = options.dir || '';
      if (!outDir) return;

      async function copyFile(srcRel: string, destRel: string): Promise<void> {
        const src = path.resolve(srcRel);
        const dest = path.join(outDir, destRel);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(src, dest);
      }

      // Popup HTML/CSS
      await copyFile('src/popup/popup.html', 'popup.html');
      await copyFile('src/popup/popup.css', 'popup.css');

      // i18n locales MUST be at: dist/<target>/_locales/<lang>/messages.json
      const localesRoot = path.resolve('src/locales');
      let dirs: string[] = [];
      try {
        dirs = (await fs.readdir(localesRoot, { withFileTypes: true }))
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
      } catch {
        dirs = [];
      }

      for (const lang of dirs) {
        await copyFile(`src/locales/${lang}/messages.json`, `_locales/${lang}/messages.json`);
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const target =
    (process.env.VITE_BUILD_TARGET as BuildTarget) ||
    (env.VITE_BUILD_TARGET as BuildTarget) ||
    'chrome';
  const outDir = path.resolve(`dist/${target}`);

  const entries: Record<string, string> = {
    background: path.resolve('src/background/background.ts'),
    content: path.resolve('src/content/content.ts'),
    popup: path.resolve('src/popup/popup.ts'),
  };

  const single = process.env.VITE_SINGLE_ENTRY;
  const isSingleEntry = !!(single && entries[single]);

  if (!isSingleEntry) {
    throw new Error(
      'This project uses single-entry Vite builds to avoid module imports in extension scripts. Use: node scripts/build.mjs',
    );
  }

  const input = { [single as string]: entries[single as string] };

  return {
    publicDir: 'public',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    build: {
      outDir,
      sourcemap: (env.VITE_ENABLE_SOURCEMAPS || 'false') === 'true',
      emptyOutDir: process.env.VITE_EMPTY_OUTDIR ? process.env.VITE_EMPTY_OUTDIR === 'true' : true,
      rollupOptions: {
        input,
        output: {
          format: 'iife',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
          inlineDynamicImports: true,
        },
      },
    },
    plugins: [copyPopupAndLocalesPlugin(), manifestGeneratorPlugin(target, env)],
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
    },
  };
});
