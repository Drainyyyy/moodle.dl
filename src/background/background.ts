import JSZip from 'jszip';
import type {
  DownloadStats,
  DownloadTrackingMap,
  MessageFromBackground,
  MessageToBackground,
  MoodleResource,
} from '../shared/types';
import {
  DEFAULT_ZIP_NAME,
  ENABLE_TELEMETRY,
  STATS_API_KEY,
  STATS_API_URL,
  STORAGE_KEYS,
} from '../shared/constants';
import {
  calculateHash,
  dedupeResources,
  ensureUniquePath,
  extractFilenameFromHeaders,
  getBrowserType,
  getExtApi,
  guessFileType,
  joinZipPath,
  normalizeUrlKey,
  roundDateToDayISO,
  sanitizeFileName,
  withConcurrency,
} from '../shared/utils';
import { storage } from '../shared/storage';

type DownloadErrorType = string;

interface ZipBuildOptions {
  zipName?: string;
  /** Falls true, ZIP als ArrayBuffer zurückgeben (kleine ZIPs); für große ZIPs Port-Stream nutzen */
  returnBuffer?: boolean;
}

const ext = getExtApi();

function sendToPopup(msg: MessageFromBackground): void {
  try {
    ext.runtime.sendMessage(msg);
  } catch {
    // ignore
  }
}

async function fetchWithTimeout(url: string, timeoutMs = 60000): Promise<Response> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      credentials: 'include',
      redirect: 'follow',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function readResponseBytesWithProgress(
  response: Response,
  onProgress: (loaded: number, total?: number) => void,
): Promise<Uint8Array> {
  const contentLengthHeader = response.headers.get('content-length');
  const total = contentLengthHeader ? Number(contentLengthHeader) : undefined;

  // If no stream support, fall back
  if (!response.body) {
    const buf = new Uint8Array(await response.arrayBuffer());
    onProgress(buf.byteLength, total);
    return buf;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      loaded += value.byteLength;
      onProgress(loaded, total);
    }
  }

  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }

  return out;
}

function isLikelyHtml(response: Response, bytes?: Uint8Array): boolean {
  const ct = response.headers.get('content-type') || '';
  if (ct.includes('text/html')) return true;
  if (bytes && bytes.byteLength >= 20) {
    const head = new TextDecoder().decode(bytes.slice(0, 64)).toLowerCase();
    if (head.includes('<!doctype html') || head.includes('<html')) return true;
  }
  return false;
}

function extractLinksFromHtml(html: string, baseUrl: string): Array<{ url: string; name?: string }> {
  const links: Array<{ url: string; name?: string }> = [];
  const hrefRegex = /href\s*=\s*"([^"]+)"/gi;

  let m: RegExpExecArray | null;
  while ((m = hrefRegex.exec(html))) {
    const href = m[1];
    if (!href) continue;

    if (!href.includes('pluginfile.php') && !href.toLowerCase().includes('forcedownload=1')) continue;

    try {
      const abs = new URL(href, baseUrl).toString();
      links.push({ url: abs });
    } catch {
      // ignore
    }
  }

  // Try data-fileurl patterns
  const dataUrlRegex = /data-fileurl\s*=\s*"([^"]+)"/gi;
  while ((m = dataUrlRegex.exec(html))) {
    const href = m[1];
    if (!href) continue;
    try {
      const abs = new URL(href, baseUrl).toString();
      links.push({ url: abs });
    } catch {
      // ignore
    }
  }

  return links;
}

async function expandFolderResource(folder: MoodleResource): Promise<MoodleResource[]> {
  const resp = await fetchWithTimeout(folder.url, 45000);
  const html = await resp.text();

  const links = extractLinksFromHtml(html, folder.url);
  const dedup = new Map<string, { url: string; name?: string }>();
  for (const l of links) {
    const key = normalizeUrlKey(l.url);
    if (!dedup.has(key)) dedup.set(key, l);
  }

  const results: MoodleResource[] = [];
  for (const l of dedup.values()) {
    const url = l.url;
    const u = new URL(url);
    const last = u.pathname.split('/').pop() || 'file';
    const name = sanitizeFileName(decodeURIComponent(last));
    const fileType = guessFileType(url, name);

    results.push({
      id: sanitizeFileName(`${folder.id}-${name}`),
      name,
      url,
      type: 'file',
      fileType,
      path: folder.path,
    });
  }

  return results;
}

function increment(map: Record<string, number>, key: string, by = 1): void {
  // eslint-disable-next-line no-param-reassign
  map[key] = (map[key] || 0) + by;
}

async function postTelemetryIfEnabled(stats: DownloadStats, optIn: boolean): Promise<void> {
  if (!ENABLE_TELEMETRY) return;
  if (!optIn) return;
  if (!STATS_API_URL) return;

  const endpoint = `${STATS_API_URL.replace(/\/$/, '')}/api/stats`;

  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(STATS_API_KEY ? { 'x-api-key': STATS_API_KEY } : {}),
      },
      body: JSON.stringify(stats),
    });
  } catch {
    // telemetry errors are intentionally swallowed
  }
}

async function setTracking(map: DownloadTrackingMap): Promise<void> {
  await storage.set(STORAGE_KEYS.downloadTracking, map);
}

async function getTracking(): Promise<DownloadTrackingMap> {
  const map: DownloadTrackingMap = (await storage.get(STORAGE_KEYS.downloadTracking)) || {};

  // Migration: older versions used less strict URL normalization.
  let changed = false;
  const migrated: DownloadTrackingMap = {};
  for (const [k, v] of Object.entries(map)) {
    const nk = normalizeUrlKey(k);
    migrated[nk] = v;
    if (nk !== k) changed = true;
  }
  if (changed) await setTracking(migrated);
  return migrated;
}

async function getTelemetryPref(): Promise<{ asked: boolean; optIn: boolean }> {
  const asked = (await storage.get(STORAGE_KEYS.telemetryAsked)) || false;
  const optIn = (await storage.get(STORAGE_KEYS.telemetryOptIn)) || false;
  return { asked, optIn };
}

async function setTelemetryPref(optIn: boolean): Promise<void> {
  await storage.set(STORAGE_KEYS.telemetryAsked, true);
  await storage.set(STORAGE_KEYS.telemetryOptIn, optIn);
}

function getExtFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop() || '';
    const dot = last.lastIndexOf('.');
    if (dot <= 0) return undefined;
    const extension = last.slice(dot + 1).toLowerCase();
    return extension || undefined;
  } catch {
    return undefined;
  }
}

function ensureNameHasExt(name: string, extension?: string): string {
  const clean = sanitizeFileName(name);
  if (!extension) return clean;
  if (clean.toLowerCase().endsWith(`.${extension.toLowerCase()}`)) return clean;
  // If name already has some extension, keep it
  if (/\.[a-z0-9]{1,5}$/i.test(clean)) return clean;
  return `${clean}.${extension}`;
}

function inferStatsFileType(fileName: string, fallback?: string): string {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]{1,6})$/);
  if (match?.[1]) return match[1];
  if (fallback && fallback !== 'file') return fallback;
  return 'file';
}

function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function downloadZip(zipBuffer: ArrayBuffer, zipName: string, saveAs?: boolean): Promise<number> {
  const zipBytes = new Uint8Array(zipBuffer);
  const DATA_URL_MAX_BYTES = 25 * 1024 * 1024;

  if (zipBytes.byteLength <= DATA_URL_MAX_BYTES) {
    const base64 = uint8ToBase64(zipBytes);
    const dataUrl = `data:application/zip;base64,${base64}`;
    return new Promise((resolve, reject) => {
      ext.downloads.download(
        { url: dataUrl, filename: zipName, saveAs: !!saveAs },
        (downloadId) => {
          const err = ext.runtime?.lastError;
          if (err) reject(new Error(err.message));
          else resolve(downloadId);
        },
      );
    });
  }

  const blob = new Blob([zipBytes], { type: 'application/zip' });
  const objectUrl = URL.createObjectURL(blob);

  const downloadId = await new Promise<number>((resolve, reject) => {
    ext.downloads.download(
      { url: objectUrl, filename: zipName, saveAs: !!saveAs },
      (id) => {
        const err = ext.runtime?.lastError;
        if (err) reject(new Error(err.message));
        else resolve(id);
      },
    );
  });

  const revoke = () => {
    try {
      URL.revokeObjectURL(objectUrl);
    } catch {
      // ignore
    }
  };

  const onChanged = (delta: chrome.downloads.DownloadDelta) => {
    if (delta.id !== downloadId) return;
    if (delta.state?.current === 'complete' || delta.error) {
      ext.downloads.onChanged.removeListener(onChanged);
      revoke();
    }
  };

  ext.downloads.onChanged.addListener(onChanged);
  setTimeout(() => {
    ext.downloads.onChanged.removeListener(onChanged);
    revoke();
  }, 5 * 60_000);

  return downloadId;
}

async function buildZip(
  resources: MoodleResource[],
  _options: ZipBuildOptions,
): Promise<{ zipBuffer: ArrayBuffer; failedUrls: string[]; successfulCount: number; totalFiles: number }> {
  void _options;
  const chosen = dedupeResources(resources);
  const zip = new JSZip();
  const existingPaths = new Set<string>();

  const tracking = await getTracking();
  const { optIn } = await getTelemetryPref();

  const errorsByType: Record<DownloadErrorType, number> = {};
  const fileTypes: Record<string, number> = {};

  // Expand folders
  const expanded: MoodleResource[] = [];
  for (const r of chosen) {
    if (r.type === 'folder') {
      try {
        const ex = await expandFolderResource(r);
        expanded.push(...ex);
      } catch {
        increment(errorsByType, 'folder_expand_error');
      }
    } else {
      expanded.push(r);
    }
  }

  const files = dedupeResources(expanded);
  const total = files.length;
  const failedUrls: string[] = [];

  // Fetch + add to zip with limited concurrency
  let completed = 0;

  await withConcurrency(files, 3, async (file) => {
    const normalized = normalizeUrlKey(file.url);
    try {
      sendToPopup({ type: 'MD_PROGRESS', phase: 'fetch', current: completed, total, fileName: file.name });

      const resp = await fetchWithTimeout(file.url, 120000);
      if (!resp.ok) {
        increment(errorsByType, String(resp.status));
        failedUrls.push(file.url);
        completed += 1;
        sendToPopup({ type: 'MD_PROGRESS', phase: 'fetch', current: completed, total, fileName: file.name });
        return;
      }

      let lastProgressSent = 0;
      const bytes = await readResponseBytesWithProgress(resp, (loaded, tot) => {
        // throttle UI updates
        if (tot && loaded - lastProgressSent < Math.max(1024 * 256, tot * 0.02)) return;
        lastProgressSent = loaded;
      });

      if (isLikelyHtml(resp, bytes)) {
        // Often indicates session timeout/login redirect
        increment(errorsByType, 'likely_login_required');
        failedUrls.push(file.url);
        completed += 1;
        sendToPopup({ type: 'MD_PROGRESS', phase: 'fetch', current: completed, total, fileName: file.name });
        return;
      }

      const headerName = extractFilenameFromHeaders(resp.headers);
      const urlExt = getExtFromUrl(resp.url || file.url);
      const baseName = headerName || ensureNameHasExt(file.name, urlExt);

      const fullPath = ensureUniquePath(existingPaths, joinZipPath(file.path, baseName));

      zip.file(fullPath, bytes);

      const hash = await calculateHash(bytes);
      tracking[normalized] = {
        url: normalized,
        hash,
        timestamp: Date.now(),
        fileName: baseName,
      };

      increment(fileTypes, inferStatsFileType(baseName, file.fileType));

      completed += 1;
      sendToPopup({ type: 'MD_PROGRESS', phase: 'fetch', current: completed, total, fileName: baseName });
    } catch (err: any) {
      const type = err?.name === 'AbortError' ? 'timeout' : 'network_error';
      increment(errorsByType, type);
      failedUrls.push(file.url);
      completed += 1;
      sendToPopup({ type: 'MD_PROGRESS', phase: 'fetch', current: completed, total, fileName: file.name });
    }
  });

  sendToPopup({ type: 'MD_PROGRESS', phase: 'zip', current: 0, total: 100 });

  // Generate ZIP (always ArrayBuffer; download is handled by the popup)
  const zipBytes = await zip.generateAsync(
    {
      type: 'uint8array',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    },
    (meta) => {
      const percent = Math.round(meta.percent || 0);
      sendToPopup({ type: 'MD_PROGRESS', phase: 'zip', current: percent, total: 100 });
    },
  );

  const zipOut = zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength);

  // Persist tracking
  await setTracking(tracking);

  // Telemetry (session-level)
  const stats: DownloadStats = {
    fileCount: total - failedUrls.length,
    fileTypes,
    errors: Object.entries(errorsByType).map(([type, count]) => ({ type, count })),
    timestamp: roundDateToDayISO(),
    extensionVersion: ext.runtime.getManifest().version,
    browserType: getBrowserType(),
  };
  await postTelemetryIfEnabled(stats, optIn);

  return {
    zipBuffer: zipOut as ArrayBuffer,
    failedUrls,
    successfulCount: total - failedUrls.length,
    totalFiles: total,
  };
}

ext.runtime.onMessage.addListener(
  (message: MessageToBackground, _sender: unknown, sendResponse: (resp: MessageFromBackground) => void) => {
    (async () => {
      try {
        if (message?.type === 'MD_GET_TRACKING') {
          const tracking = await getTracking();
          sendResponse({ type: 'MD_TRACKING_RESULT', tracking });
          return;
        }

        if (message?.type === 'MD_RESET_TRACKING') {
          await storage.set(STORAGE_KEYS.downloadTracking, {});
          sendResponse({ type: 'MD_RESET_TRACKING_RESULT', ok: true });
          return;
        }

        if (message?.type === 'MD_GET_TELEMETRY_PREF') {
          const pref = await getTelemetryPref();
          sendResponse({ type: 'MD_TELEMETRY_PREF_RESULT', ...pref });
          return;
        }

        if (message?.type === 'MD_SET_TELEMETRY_PREF') {
          await setTelemetryPref(message.optIn);
          const pref = await getTelemetryPref();
          sendResponse({ type: 'MD_TELEMETRY_PREF_RESULT', ...pref });
          return;
        }

        if (message?.type === 'MD_BUILD_ZIP') {
          const { resources, options } = message;
          const { zipBuffer, failedUrls, successfulCount } = await buildZip(resources, options);

          sendToPopup({
            type: 'MD_COMPLETE',
            ok: true,
            fileCount: successfulCount,
            failedCount: failedUrls.length,
          });

          if (options?.returnBuffer) {
            sendResponse({ type: 'MD_BUILD_ZIP_RESULT', ok: true, zipBuffer, failedUrls });
            return;
          }

          const rawName = typeof options?.zipName === 'string' ? options.zipName : DEFAULT_ZIP_NAME;
          const safeName = sanitizeFileName(rawName.endsWith('.zip') ? rawName : `${rawName}.zip`);
          const downloadId = await downloadZip(zipBuffer, safeName, options?.saveAs);
          sendResponse({ type: 'MD_BUILD_ZIP_RESULT', ok: true, downloadId, failedUrls });
          return;
        }

        if (message?.type === 'MD_NOTIFY_SAVE_DONE') {
          try {
            ext.notifications.create(
              {
                type: 'basic',
                iconUrl: 'icons/icon128.png',
                title: 'moodle.download',
                message: `Download abgeschlossen: ${message.fileCount} Dateien`,
              },
              () => {
                // no-op
              },
            );
          } catch {
            // ignore
          }
          sendResponse({ type: 'MD_NOTIFY_SAVE_DONE_RESULT', ok: true });
          return;
        }

        sendResponse({ type: 'MD_BUILD_ZIP_RESULT', ok: false, error: 'Unknown message' });
      } catch (err: any) {
        const msg = typeof err?.message === 'string' ? err.message : 'Unknown error';
        sendToPopup({ type: 'MD_COMPLETE', ok: false, error: msg });
        sendResponse({ type: 'MD_BUILD_ZIP_RESULT', ok: false, error: msg });
      }
    })();

    // Keep the message channel open for async responses
    return true;
  },
);

// Large ZIPs cannot be returned via runtime.sendMessage reliably.
// We stream ZIP ArrayBuffers in chunks via a long-lived Port.
const ZIP_CHUNK_SIZE = 1024 * 1024; // 1 MiB

ext.runtime.onConnect.addListener((port) => {
  if (port.name !== 'md-zip') return;

  port.onMessage.addListener((msg: any) => {
    (async () => {
      try {
        if (msg?.type !== 'MD_ZIP_STREAM_REQUEST') return;
        const zipName = typeof msg.zipName === 'string' ? msg.zipName : DEFAULT_ZIP_NAME;
        const resources = (msg.resources || []) as MoodleResource[];

        const { zipBuffer, failedUrls, successfulCount, totalFiles } = await buildZip(resources, {
          zipName,
          returnBuffer: true,
        });

        const zipBytes = new Uint8Array(zipBuffer);
        const totalBytes = zipBytes.byteLength;
        const totalChunks = Math.ceil(totalBytes / ZIP_CHUNK_SIZE);

        port.postMessage({
          type: 'MD_ZIP_STREAM_META',
          zipName,
          totalBytes,
          chunkSize: ZIP_CHUNK_SIZE,
          totalChunks,
          fileCount: successfulCount,
          failedCount: failedUrls.length,
          totalFiles,
          failedUrls,
        });

        for (let i = 0; i < totalChunks; i += 1) {
          const start = i * ZIP_CHUNK_SIZE;
          const end = Math.min(totalBytes, start + ZIP_CHUNK_SIZE);
          const chunk = zipBytes.slice(start, end);
          port.postMessage({ type: 'MD_ZIP_STREAM_CHUNK', index: i, data: chunk });
        }

        port.postMessage({ type: 'MD_ZIP_STREAM_DONE' });
      } catch (err: any) {
        const error = typeof err?.message === 'string' ? err.message : 'Unknown error';
        try {
          port.postMessage({ type: 'MD_ZIP_STREAM_ERROR', error });
        } catch {
          // ignore
        }
      }
    })();
  });
});
