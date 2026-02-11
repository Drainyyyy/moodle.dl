import type {
  DownloadTrackingMap,
  MessageFromBackground,
  MessageFromContent,
  MessageToBackground,
  MessageToContent,
  MoodleResource,
  SaveSettings,
  ZipPortMessageFromBackground,
  ZipPortMessageToBackground,
} from '../shared/types';
import { DEFAULT_ZIP_NAME, GITHUB_REPO, GITHUB_REPO_URL, STORAGE_KEYS } from '../shared/constants';
import { extAsync } from '../shared/ext';
import { storage } from '../shared/storage';
import { idbDeleteHandle, idbGetHandle, idbSetHandle } from '../shared/idb';
import { getExtApi, normalizeUrlKey, sanitizeFileName, toErrorMessage } from '../shared/utils';

const ext = getExtApi();

const IDB_HANDLE_KEY = 'saveDirectory';

type DirectoryHandleWithPermissions = FileSystemDirectoryHandle & {
  queryPermission?: (options?: any) => Promise<PermissionState>;
  requestPermission?: (options?: any) => Promise<PermissionState>;
};

let resources: MoodleResource[] = [];
let tracking: DownloadTrackingMap = {};
let onlyNew = false;
let selected = new Set<string>();
let selectedBeforeOnlyNew: Set<string> | null = null;
let saveSettings: SaveSettings = { mode: 'downloads', saveAs: false };
let savedDirectoryHandle: FileSystemDirectoryHandle | null = null;
let sortMode: 'path' | 'type' | 'name' | 'new' = 'type';
let lastFailedUrls: string[] = [];

function initRepoLink(): void {
  const link = document.getElementById('repoLink') as HTMLAnchorElement | null;
  if (!link) return;

  link.href = GITHUB_REPO_URL || 'https://github.com';
  // Show owner/repo if configured, otherwise a generic label.
  link.textContent = GITHUB_REPO || 'GitHub';
}

function i18n(key: string, substitutions?: string | string[]): string {
  try {
    return ext.i18n.getMessage(key, substitutions as any) || key;
  } catch {
    return key;
  }
}

function setStatus(text: string): void {
  const el = document.getElementById('statusText');
  if (el) el.textContent = text;
}

function setProgress(percent: number): void {
  const bar = document.getElementById('progressBar') as HTMLDivElement | null;
  if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
}

function localizeHtml(): void {
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    el.textContent = i18n(key);
  });
}

async function getActiveTabId(): Promise<number | undefined> {
  const tabs = await extAsync.tabsQuery({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function sendToContent(tabId: number, msg: MessageToContent): Promise<MessageFromContent> {
  return extAsync.tabsSendMessage<MessageFromContent>(tabId, msg);
}

async function sendToBackground(msg: MessageToBackground): Promise<MessageFromBackground> {
  return extAsync.runtimeSendMessage<MessageFromBackground>(msg);
}

function isResourceNew(r: MoodleResource): boolean {
  const key = normalizeUrlKey(r.url);
  return !tracking[key];
}

function getVisibleResources(): MoodleResource[] {
  return onlyNew ? resources.filter(isResourceNew) : [...resources];
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let idx = 0;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function onResourceCheckboxChange(ev: Event): void {
  const cb = ev.target as HTMLInputElement | null;
  if (!cb) return;
  const id = cb.getAttribute('data-id') || '';
  if (!id) return;
  if (cb.checked) selected.add(id);
  else selected.delete(id);
}

function onResourceRowClick(ev: Event): void {
  const target = ev.target as HTMLElement | null;
  if (!target) return;
  if (target.tagName.toLowerCase() === 'input') return;
  const row = ev.currentTarget as HTMLElement | null;
  if (!row) return;
  const cb = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
  cb?.click();
}

function renderList(): void {
  const list = document.getElementById('resourceList');
  if (!list) return;
  list.innerHTML = '';

  const visible = getVisibleResources();

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'row row-empty';
    empty.innerHTML = `
      <div class="cell-check"></div>
      <div class="cell-icon"><div class="badge">—</div></div>
      <div class="cell-main">
        <div class="name">${i18n('noResourcesFound')}</div>
      </div>
      <div class="cell-meta"></div>
    `;
    list.appendChild(empty);
    return;
  }

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const cmpText = (a: string, b: string) => collator.compare(a || '', b || '');
  const cmpBool = (a: boolean, b: boolean) => (a === b ? 0 : a ? -1 : 1);

  const typeOrder = (ft: string): number => {
    const t = (ft || 'other').toLowerCase();
    if (t === 'folder' || t === 'dir') return 100;

    if (t === 'pdf') return 0;

    if (t === 'doc' || t === 'docx' || t === 'rtf') return 10;
    if (t === 'ppt' || t === 'pptx') return 20;
    if (t === 'xls' || t === 'xlsx' || t === 'csv') return 30;

    if (t === 'zip' || t === 'rar' || t === '7z') return 40;

    if (t === 'png' || t === 'jpg' || t === 'jpeg' || t === 'gif' || t === 'webp' || t === 'svg') return 50;

    if (t === 'mp4' || t === 'mov' || t === 'm4v' || t === 'webm') return 60;
    if (t === 'mp3' || t === 'wav' || t === 'm4a' || t === 'ogg') return 70;

    return 90;
  };

  const getType = (r: MoodleResource): string => {
    if (r.type === 'folder') return 'folder';
    // Avoid showing "FILE" in the UI; if we cannot infer a type, use "other".
    return (r.fileType || 'other').toLowerCase();
  };

  const sorted = [...visible].sort((a, b) => {
    const aNew = isResourceNew(a);
    const bNew = isResourceNew(b);

    const aType = getType(a);
    const bType = getType(b);

    if (sortMode === 'new') {
      const cNew = cmpBool(aNew, bNew);
      if (cNew !== 0) return cNew;
    }

    if (sortMode === 'type') {
      const cTypeOrder = typeOrder(aType) - typeOrder(bType);
      if (cTypeOrder !== 0) return cTypeOrder;
      const cType = cmpText(aType, bType);
      if (cType !== 0) return cType;
    }

    if (sortMode === 'path') {
      const cPath = cmpText(a.path || '', b.path || '');
      if (cPath !== 0) return cPath;
    }

    if (sortMode === 'name') {
      const cName = cmpText(a.name, b.name);
      if (cName !== 0) return cName;
    }

    // Secondary sorting (stable + intuitive)
    const cPath2 = cmpText(a.path || '', b.path || '');
    if (cPath2 !== 0) return cPath2;

    const cType2 = typeOrder(aType) - typeOrder(bType);
    if (cType2 !== 0) return cType2;

    const cName2 = cmpText(a.name, b.name);
    if (cName2 !== 0) return cName2;

    return cmpText(a.url, b.url);
  });

  for (const r of sorted) {
    const row = document.createElement('div');
    row.className = 'row';

    const checked = selected.has(r.id);
    const ftRaw = getType(r);
    const ftSafe = (ftRaw || 'other').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'other';
    const badgeText = r.type === 'folder' ? 'FOLDER' : (ftRaw || 'other').toUpperCase();

    const pathLabel = r.path || i18n('noFolder');

    const pills: string[] = [];
    pills.push(
      `<span class="pill ${isResourceNew(r) ? 'pill-new' : 'pill-done'}">${isResourceNew(r) ? i18n('new') : i18n('downloaded')}</span>`,
    );
    if (r.size) pills.push(`<span class="pill pill-size">${formatBytes(r.size)}</span>`);

    const sub = r.type === 'folder' ? `${pathLabel} • ${i18n('folderWillBeExpanded')}` : pathLabel;

    row.innerHTML = `
      <div class="cell-check">
        <input type="checkbox" ${checked ? 'checked' : ''} data-id="${r.id}" />
      </div>
      <div class="cell-icon">
        <div class="badge t-${ftSafe}">${badgeText}</div>
      </div>
      <div class="cell-main">
        <div class="name" title="${r.name}">${r.name}</div>
        <div class="sub" title="${r.url}">${sub}</div>
      </div>
      <div class="cell-meta">${pills.join('')}</div>
    `;

    const cb = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    cb?.addEventListener('change', onResourceCheckboxChange);

    // Click row toggles checkbox (more intuitive)
    row.addEventListener('click', onResourceRowClick);

    list.appendChild(row);
  }
}

function setButtonsEnabled(enabled: boolean): void {
  const ids = [
    'btnSelectAll',
    'btnDeselectAll',
    'btnSaveMenu',
    'btnDownload',
    'btnReset',
    'chkOnlyNew',
    'selSort',
  ];
  for (const id of ids) {
    const el = document.getElementById(id) as HTMLButtonElement | HTMLInputElement | null;
    if (!el) continue;
    (el as any).disabled = !enabled;
  }
}

function updateSaveLabel(): void {
  const el = document.getElementById('saveLabel');
  if (!el) return;

  if (saveSettings.mode === 'directory') {
    el.textContent = i18n('saveModeFolder');
    return;
  }

  el.textContent = saveSettings.saveAs ? i18n('saveModeAsk') : i18n('saveModeDownloads');
}

async function loadTracking(): Promise<void> {
  const resp = await sendToBackground({ type: 'MD_GET_TRACKING' });
  if (resp.type === 'MD_TRACKING_RESULT') tracking = resp.tracking;
}

async function loadTelemetryPref(): Promise<void> {
  const resp = await sendToBackground({ type: 'MD_GET_TELEMETRY_PREF' });
  if (resp.type !== 'MD_TELEMETRY_PREF_RESULT') return;

  const panel = document.getElementById('telemetryPanel');
  if (!panel) return;

  if (!resp.asked) panel.classList.remove('hidden');
  else panel.classList.add('hidden');
}

async function loadSaveSettings(): Promise<void> {
  const stored = await storage.get(STORAGE_KEYS.saveSettings);
  if (stored) saveSettings = stored;

  if (saveSettings.mode === 'directory') {
    try {
      savedDirectoryHandle = (await idbGetHandle<FileSystemDirectoryHandle>(IDB_HANDLE_KEY)) ?? null;
    } catch {
      savedDirectoryHandle = null;
    }
  }

  updateSaveLabel();
}

async function setSaveSettings(next: SaveSettings): Promise<void> {
  saveSettings = next;
  await storage.set(STORAGE_KEYS.saveSettings, next);
  updateSaveLabel();
}

function toggleSaveMenu(show?: boolean): void {
  const menu = document.getElementById('saveMenu');
  if (!menu) return;
  const shouldShow = show ?? menu.classList.contains('hidden');
  if (shouldShow) menu.classList.remove('hidden');
  else menu.classList.add('hidden');
}

async function pickAndPersistDirectory(): Promise<void> {
  if (!('showDirectoryPicker' in window)) {
    // Nicht verfügbar (z.B. Firefox): fallback auf saveAs
    await setSaveSettings({ mode: 'downloads', saveAs: true });
    setStatus(i18n('fsNotSupported'));
    return;
  }

  try {
    const handle = await (window as any).showDirectoryPicker();
    await idbSetHandle(IDB_HANDLE_KEY, handle);
    savedDirectoryHandle = handle;
    await setSaveSettings({ mode: 'directory', saveAs: false });
    setStatus(i18n('saveLocationSet'));
  } catch {
    // user cancelled
  }
}

async function clearPersistedDirectory(): Promise<void> {
  try {
    await idbDeleteHandle(IDB_HANDLE_KEY);
  } catch {
    // ignore
  }
  savedDirectoryHandle = null;
  await setSaveSettings({ mode: 'downloads', saveAs: false });
  setStatus(i18n('savingToDownloads'));
}

async function saveZip(zipBuffer: ArrayBuffer, zipName: string): Promise<void> {
  const safeName = sanitizeFileName(zipName.endsWith('.zip') ? zipName : `${zipName}.zip`);

  // Prefer File System Access if configured.
  if (saveSettings.mode === 'directory' && savedDirectoryHandle) {
    try {
      const handle = savedDirectoryHandle as DirectoryHandleWithPermissions;
      const perm = await handle.queryPermission?.({ mode: 'readwrite' as any });
      if (perm !== 'granted') {
        const req = await handle.requestPermission?.({ mode: 'readwrite' as any });
        if (req !== 'granted') throw new Error(i18n('permissionDenied'));
      }

      const fileHandle = await savedDirectoryHandle.getFileHandle(safeName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(new Blob([zipBuffer], { type: 'application/zip' }));
      await writable.close();
      return;
    } catch {
      // fall back
      savedDirectoryHandle = null;
      await setSaveSettings({ mode: 'downloads', saveAs: false });
    }
  }

  // Default: downloads folder, optionally saveAs dialog.
  const blob = new Blob([zipBuffer], { type: 'application/zip' });
  const objectUrl = URL.createObjectURL(blob);
  try {
    await extAsync.downloadsDownload({ url: objectUrl, filename: safeName, saveAs: saveSettings.saveAs });
  } finally {
    // Delay revoke a bit so the browser has time to read it
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

function computeDefaultZipName(): string {
  return DEFAULT_ZIP_NAME;
}

function showError(text: string): void {
  const panel = document.getElementById('errorPanel');
  const t = document.getElementById('errorText');
  if (t) t.textContent = text;
  panel?.classList.remove('hidden');
}

function hideError(): void {
  const panel = document.getElementById('errorPanel');
  panel?.classList.add('hidden');
}

async function buildZipStream(
  selectedResources: MoodleResource[],
  zipName: string,
): Promise<{ zipBuffer: ArrayBuffer; failedUrls: string[]; fileCount: number }> {
  // Preferred: stream ZIP through a Port (works for large files)
  try {
    const port = ext.runtime.connect({ name: 'md-zip' });

    return await new Promise((resolve, reject) => {
      let totalBytes = 0;
      let chunkSize = 0;
      let totalChunks = 0;
      let fileCount = 0;
      let failedUrls: string[] = [];
      let buffer: Uint8Array | null = null;
      let receivedChunks = 0;

      const handlers = {
        onMessage: (msg: ZipPortMessageFromBackground) => {
          void msg;
        },
        onDisconnect: () => {},
      };

      const cleanup = () => {
        try {
          port.onMessage.removeListener(handlers.onMessage as any);
          port.onDisconnect.removeListener(handlers.onDisconnect as any);
          port.disconnect();
        } catch {
          // ignore
        }
      };

      handlers.onDisconnect = () => {
        cleanup();
        reject(new Error(i18n('zipStreamDisconnected')));
      };

      handlers.onMessage = (msg: ZipPortMessageFromBackground) => {
        if (msg.type === 'MD_ZIP_STREAM_META') {
          totalBytes = msg.totalBytes;
          chunkSize = msg.chunkSize;
          totalChunks = msg.totalChunks;
          fileCount = msg.fileCount;
          failedUrls = msg.failedUrls;
          buffer = new Uint8Array(totalBytes);
          return;
        }

        if (msg.type === 'MD_ZIP_STREAM_CHUNK') {
          if (!buffer) return;
          const offset = msg.index * chunkSize;
          buffer.set(new Uint8Array(msg.data), offset);
          receivedChunks += 1;
          // small UI hint (not the main progress)
          if (totalChunks > 0) {
            const p = 70 + Math.round((receivedChunks / totalChunks) * 25);
            setProgress(Math.min(95, Math.max(70, p)));
          }
          return;
        }

        if (msg.type === 'MD_ZIP_STREAM_DONE') {
          if (!buffer) {
            cleanup();
            reject(new Error(i18n('zipStreamMissingBuffer')));
            return;
          }
          const zipBuffer = buffer.buffer;
          cleanup();
          resolve({ zipBuffer, failedUrls, fileCount });
          return;
        }

        if (msg.type === 'MD_ZIP_STREAM_ERROR') {
          cleanup();
          reject(new Error(msg.error));
        }
      };

      port.onDisconnect.addListener(handlers.onDisconnect);
      port.onMessage.addListener(handlers.onMessage as any);

      const req: ZipPortMessageToBackground = {
        type: 'MD_ZIP_STREAM_REQUEST',
        zipName,
        resources: selectedResources,
      };
      port.postMessage(req);
    });
  } catch {
    // Fallback: request ZIP buffer via runtime messaging (may fail for large ZIPs)
    const resp = await sendToBackground({
      type: 'MD_BUILD_ZIP',
      resources: selectedResources,
      options: {
        zipName,
        returnBuffer: true,
      },
    });

    if (resp.type === 'MD_BUILD_ZIP_RESULT' && resp.ok && resp.zipBuffer) {
      return {
        zipBuffer: resp.zipBuffer,
        failedUrls: resp.failedUrls || [],
        fileCount: selectedResources.length,
      };
    }

    if (resp.type === 'MD_BUILD_ZIP_RESULT' && !resp.ok) {
      throw new Error(resp.error);
    }
    throw new Error(i18n('zipBuildFailed'));
  }
}

async function startDownload(selectedResources: MoodleResource[]): Promise<void> {
  setButtonsEnabled(false);
  setProgress(0);
  lastFailedUrls = [];

  const zipName = computeDefaultZipName();
  setStatus(i18n('downloadStarted'));

  try {
    const { zipBuffer, failedUrls, fileCount } = await buildZipStream(selectedResources, zipName);
    if (failedUrls.length) lastFailedUrls = failedUrls;

    await saveZip(zipBuffer, zipName);

    // Refresh tracking after build/save
    await loadTracking();

    if (onlyNew) {
      selected = new Set(getVisibleResources().map((r) => r.id));
    }
    renderList();

    const okCount = Math.max(0, fileCount - lastFailedUrls.length);
    setStatus(i18n('downloadComplete', [String(okCount)]));
    setProgress(100);

    await sendToBackground({ type: 'MD_NOTIFY_SAVE_DONE', fileCount: okCount });

    if (lastFailedUrls.length > 0) showError(i18n('someFilesFailed', [String(lastFailedUrls.length)]));
    else hideError();
  } catch (err) {
    showError(toErrorMessage(err));
    setStatus(i18n('error'));
  } finally {
    setButtonsEnabled(true);
  }
}

function attachEventHandlers(): void {
  document.getElementById('btnSelectAll')?.addEventListener('click', () => {
    for (const r of getVisibleResources()) selected.add(r.id);
    renderList();
  });

  document.getElementById('btnDeselectAll')?.addEventListener('click', () => {
    for (const r of getVisibleResources()) selected.delete(r.id);
    renderList();
  });

  document.getElementById('chkOnlyNew')?.addEventListener('change', (e) => {
    onlyNew = (e.target as HTMLInputElement).checked;

    if (onlyNew) {
      selectedBeforeOnlyNew = new Set(selected);
      selected = new Set(resources.filter(isResourceNew).map((r) => r.id));
    } else if (selectedBeforeOnlyNew) {
      selected = new Set(selectedBeforeOnlyNew);
      selectedBeforeOnlyNew = null;
    }

    renderList();
  });

  document.getElementById('selSort')?.addEventListener('change', (e) => {
    sortMode = (e.target as HTMLSelectElement).value as any;
    renderList();
  });

  document.getElementById('btnSaveMenu')?.addEventListener('click', (e) => {
    e.preventDefault();
    toggleSaveMenu();
  });

  document.getElementById('saveToDownloads')?.addEventListener('click', async () => {
    await setSaveSettings({ mode: 'downloads', saveAs: false });
    toggleSaveMenu(false);
  });

  document.getElementById('saveAskEveryTime')?.addEventListener('click', async () => {
    await setSaveSettings({ mode: 'downloads', saveAs: true });
    toggleSaveMenu(false);
  });

  document.getElementById('savePickFolder')?.addEventListener('click', async () => {
    await pickAndPersistDirectory();
    toggleSaveMenu(false);
  });

  document.getElementById('saveClearFolder')?.addEventListener('click', async () => {
    await clearPersistedDirectory();
    toggleSaveMenu(false);
  });

  document.addEventListener('click', (e) => {
    const menu = document.getElementById('saveMenu');
    const btn = document.getElementById('btnSaveMenu');
    if (!menu || !btn) return;
    if (menu.classList.contains('hidden')) return;
    const target = e.target as Node | null;
    if (!target) return;
    if (menu.contains(target) || btn.contains(target)) return;
    toggleSaveMenu(false);
  });

  document.getElementById('btnDownload')?.addEventListener('click', async () => {
    hideError();

    const selectedResources = resources.filter((r) => selected.has(r.id));
    if (selectedResources.length === 0) {
      setStatus(i18n('nothingSelected'));
      return;
    }

    await startDownload(selectedResources);
  });

  document.getElementById('btnRetry')?.addEventListener('click', async () => {
    hideError();
    if (lastFailedUrls.length === 0) return;
    const retryResources = resources.filter((r) => lastFailedUrls.includes(r.url));
    selected = new Set(retryResources.map((r) => r.id));
    renderList();
    await startDownload(retryResources);
  });

  document.getElementById('btnReset')?.addEventListener('click', async () => {
    await sendToBackground({ type: 'MD_RESET_TRACKING' });
    await loadTracking();
    renderList();
    setStatus(i18n('trackingResetDone'));
  });

  document.getElementById('telemetryYes')?.addEventListener('click', async () => {
    await sendToBackground({ type: 'MD_SET_TELEMETRY_PREF', optIn: true });
    (document.getElementById('telemetryPanel') as HTMLElement | null)?.classList.add('hidden');
  });

  document.getElementById('telemetryNo')?.addEventListener('click', async () => {
    await sendToBackground({ type: 'MD_SET_TELEMETRY_PREF', optIn: false });
    (document.getElementById('telemetryPanel') as HTMLElement | null)?.classList.add('hidden');
  });

  ext.runtime.onMessage.addListener((msg: MessageFromBackground) => {
    if (msg.type === 'MD_PROGRESS') {
      if (msg.phase === 'fetch') {
        const percent = msg.total > 0 ? Math.round((msg.current / msg.total) * 70) : 0;
        setProgress(percent);
        setStatus(`${i18n('downloadStarted')} ${msg.current}/${msg.total}`);
      }
      if (msg.phase === 'zip') {
        setProgress(70 + Math.round((msg.current / msg.total) * 25));
        setStatus(i18n('zipping'));
      }
    }

    if (msg.type === 'MD_COMPLETE' && msg.ok) {
      setProgress(100);
      setStatus(i18n('downloadComplete', [String(msg.fileCount)]));
    }

    if (msg.type === 'MD_COMPLETE' && !msg.ok) {
      showError(msg.error);
    }

    return false;
  });
}

async function init(): Promise<void> {
  localizeHtml();
  initRepoLink();
  attachEventHandlers();

  const selSort = document.getElementById('selSort') as HTMLSelectElement | null;
  if (selSort) selSort.value = sortMode;

  setStatus(i18n('loading'));
  setProgress(0);

  await loadTelemetryPref();
  await loadTracking();
  await loadSaveSettings();

  const tabId = await getActiveTabId();
  if (!tabId) {
    setStatus(i18n('noActiveTab'));
    return;
  }

  try {
    const ping = await sendToContent(tabId, { type: 'MD_PING' });
    if (ping.type === 'MD_PONG' && !ping.isMoodle) {
      setStatus(i18n('noMoodleDetected'));
    }

    const resp = await sendToContent(tabId, { type: 'MD_EXTRACT_RESOURCES' });
    if (resp.type === 'MD_EXTRACT_RESOURCES_RESULT') {
      resources = resp.resources;
      // Default selection: all
      selected = new Set(resources.map((r) => r.id));
      renderList();
      setStatus(i18n('ready', [String(resources.length)]));
      setProgress(0);
    }
  } catch (err) {
    showError(toErrorMessage(err));
    setStatus(i18n('error'));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  void init();
});
