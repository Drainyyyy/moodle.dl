import type { MoodleResource } from './types';
import { DOWNLOADABLE_EXTENSIONS, ENABLE_DEBUG_LOGS } from './constants';

/**
 * Cross-Browser API Zugriff (Chrome/Firefox).
 *
 * Hinweis: In Firefox existiert `chrome` als Alias zu den WebExtension APIs.
 * Daher bevorzugen wir `chrome` und verwenden konsequent Callback-Promisification.
 */
export function getExtApi(): typeof chrome {
  const anyGlobal = globalThis as any;
  return (anyGlobal.chrome || anyGlobal.browser) as typeof chrome;
}

export function getBrowserType(): 'chrome' | 'firefox' {
  const anyGlobal = globalThis as any;
  // In Firefox existiert i.d.R. `browser` zusätzlich zu `chrome`.
  return anyGlobal.browser ? 'firefox' : 'chrome';
}

export function logDebug(...args: unknown[]): void {
  if (ENABLE_DEBUG_LOGS) {
    // eslint-disable-next-line no-console
    console.log('[moodle.download]', ...args);
  }
}

/**
 * SHA-256 Hash für String/Bytes.
 */
export async function calculateHash(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data);

  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Entfernt Zeichen, die in Windows/macOS/Linux Dateinamen problematisch sind.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();

  const fallback = 'file';
  const limited = cleaned.length > 180 ? cleaned.slice(0, 180).trim() : cleaned;
  return limited || fallback;
}

export function normalizeUrl(url: string, base?: string): string {
  try {
    const u = new URL(url, base || globalThis.location?.href);
    u.hash = '';
    return u.toString();
  } catch {
    return url;
  }
}

export function getFileExtensionFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop() || '';
    const dot = last.lastIndexOf('.');
    if (dot <= 0) return undefined;
    const ext = last.slice(dot + 1).toLowerCase();
    return ext || undefined;
  } catch {
    const dot = url.lastIndexOf('.');
    if (dot == -1) return undefined;
    return url.slice(dot + 1).toLowerCase();
  }
}

export function guessFileType(resourceUrl: string, displayName?: string): string {
  const ext = getFileExtensionFromUrl(resourceUrl) || getFileExtensionFromUrl(displayName || '');
  if (ext && DOWNLOADABLE_EXTENSIONS.has(ext)) return ext;

  // Moodle Module URLs
  if (/mod\/folder\/view\.php/.test(resourceUrl)) return 'folder';
  if (/mod\/url\/view\.php/.test(resourceUrl)) return 'link';
  if (/mod\/page\/view\.php/.test(resourceUrl)) return 'page';
  if (/mod\/resource\/view\.php/.test(resourceUrl)) return 'file';

  return 'file';
}

export function roundDateToDayISO(date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function extractFilenameFromHeaders(headers: Headers): string | undefined {
  const contentDisp = headers.get('content-disposition') || headers.get('Content-Disposition');
  if (!contentDisp) return undefined;

  // RFC 5987 filename*
  const filenameStarMatch = contentDisp.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (filenameStarMatch?.[1]) {
    try {
      return sanitizeFileName(decodeURIComponent(filenameStarMatch[1].replace(/(^\s*"|"\s*$)/g, '')));
    } catch {
      return sanitizeFileName(filenameStarMatch[1]);
    }
  }

  const filenameMatch = contentDisp.match(/filename=([^;]+)/i);
  if (filenameMatch?.[1]) {
    return sanitizeFileName(filenameMatch[1].replace(/(^\s*"|"\s*$)/g, ''));
  }

  return undefined;
}

export function joinZipPath(path: string, fileName: string): string {
  const cleanedPath = path
    .split('/')
    .map((p) => sanitizeFileName(p))
    .filter(Boolean)
    .join('/');

  return cleanedPath ? `${cleanedPath}/${sanitizeFileName(fileName)}` : sanitizeFileName(fileName);
}

export function ensureUniquePath(existing: Set<string>, fullPath: string): string {
  if (!existing.has(fullPath)) {
    existing.add(fullPath);
    return fullPath;
  }

  const dot = fullPath.lastIndexOf('.');
  const base = dot > -1 ? fullPath.slice(0, dot) : fullPath;
  const ext = dot > -1 ? fullPath.slice(dot) : '';

  let i = 1;
  while (existing.has(`${base} (${i})${ext}`)) i += 1;

  const unique = `${base} (${i})${ext}`;
  existing.add(unique);
  return unique;
}

export function dedupeResources(resources: MoodleResource[]): MoodleResource[] {
  const seen = new Set<string>();
  const out: MoodleResource[] = [];
  for (const r of resources) {
    const key = normalizeUrl(r.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export async function withConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function run(): Promise<void> {
    while (idx < items.length) {
      const current = idx;
      idx += 1;
      results[current] = await worker(items[current], current);
    }
  }

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function toErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as any).message === 'string') {
    return (err as any).message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}
