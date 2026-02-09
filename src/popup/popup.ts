import type {
  DownloadTrackingMap,
  MessageFromBackground,
  MessageFromContent,
  MessageToBackground,
  MessageToContent,
  MoodleResource,
} from '../shared/types';
import { DEFAULT_ZIP_NAME } from '../shared/constants';
import { extAsync } from '../shared/ext';
import { getExtApi, normalizeUrlKey, sanitizeFileName, toErrorMessage } from '../shared/utils';

const ext = getExtApi();

type SaveTarget =
  | { mode: 'downloads'; saveAs: boolean }
  | { mode: 'fileHandle'; fileHandle: FileSystemFileHandle }
  | { mode: 'directoryHandle'; directoryHandle: FileSystemDirectoryHandle };

let resources: MoodleResource[] = [];
let tracking: DownloadTrackingMap = {};
let onlyNew = false;
let selected = new Set<string>();
let selectedBeforeOnlyNew: Set<string> | null = null;
let saveTarget: SaveTarget = { mode: 'downloads', saveAs: true };
let lastFailedUrls: string[] = [];

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
  return await extAsync.tabsSendMessage<MessageFromContent>(tabId, msg);
}

async function sendToBackground(msg: MessageToBackground): Promise<MessageFromBackground> {
  return await extAsync.runtimeSendMessage<MessageFromBackground>(msg);
}

function isResourceNew(r: MoodleResource): boolean {
  const key = normalizeUrlKey(r.url);
  return !tracking[key];
}

function getVisibleResources(): MoodleResource[] {
  return onlyNew ? resources.filter(isResourceNew) : resources;
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

function renderList(): void {
  const list = document.getElementById('resourceList');
  if (!list) return;
  list.innerHTML = '';

  const visible = getVisibleResources();

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'row';
    empty.innerHTML = `<div></div><div class="badge">—</div><div class="name">${i18n('noResourcesFound')}</div><div class="meta"></div>`;
    list.appendChild(empty);
    return;
  }

  for (const r of visible) {
    const row = document.createElement('div');
    row.className = 'row';

    const checked = selected.has(r.id);
    const badgeText = (r.type === 'folder' ? 'FOLD' : (r.fileType || 'file').toUpperCase()).slice(0, 4);
    const badgeClass = (r.fileType || 'file').toLowerCase();

    const meta = r.size ? formatBytes(r.size) : isResourceNew(r) ? i18n('new') : i18n('downloaded');
    const metaClass = r.size ? 'pill-size' : isResourceNew(r) ? 'pill-new' : 'pill-done';

    row.innerHTML = `
      <input type="checkbox" ${checked ? 'checked' : ''} data-id="${r.id}" />
      <div class="badge ${badgeClass}">${badgeText}</div>
      <div>
        <div class="name" title="${r.name}">${r.name}</div>
        <div class="path" title="${r.path}">${r.path || ''}</div>
      </div>
      <div class="meta"><span class="pill ${metaClass}">${meta}</span></div>
    `;

    const cb = row.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    cb?.addEventListener('change', () => {
      const id = cb.getAttribute('data-id') || '';
      if (!id) return;
      if (cb.checked) selected.add(id);
      else selected.delete(id);
    });

    list.appendChild(row);
  }
}

function setButtonsEnabled(enabled: boolean): void {
  const ids = ['btnSelectAll', 'btnDeselectAll', 'btnChooseFolder', 'btnDownload', 'btnReset', 'chkOnlyNew'];
  for (const id of ids) {
    const el = document.getElementById(id) as HTMLButtonElement | HTMLInputElement | null;
    if (!el) continue;
    (el as any).disabled = !enabled;
  }
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

async function pickSaveTarget(): Promise<void> {
  // Prefer directory picker, fallback to save file picker, fallback to downloads.saveAs
  try {
    if ('showDirectoryPicker' in window) {
      const directoryHandle = await (window as any).showDirectoryPicker();
      saveTarget = { mode: 'directoryHandle', directoryHandle };
      setStatus(i18n('saveLocationSet'));
      return;
    }
  } catch {
    // user cancelled
  }

  try {
    if ('showSaveFilePicker' in window) {
      const fileHandle = await (window as any).showSaveFilePicker({
        suggestedName: DEFAULT_ZIP_NAME,
        types: [
          {
            description: 'ZIP',
            accept: { 'application/zip': ['.zip'] },
          },
        ],
      });
      saveTarget = { mode: 'fileHandle', fileHandle };
      setStatus(i18n('saveLocationSet'));
      return;
    }
  } catch {
    // user cancelled
  }

  // Fallback
  saveTarget = { mode: 'downloads', saveAs: true };
  setStatus(i18n('savingToDownloads'));
}

async function writeZipToHandle(zipBuffer: ArrayBuffer, zipName: string): Promise<void> {
  if (saveTarget.mode === 'fileHandle') {
    const writable = await saveTarget.fileHandle.createWritable();
    await writable.write(new Blob([zipBuffer], { type: 'application/zip' }));
    await writable.close();
    return;
  }

  if (saveTarget.mode === 'directoryHandle') {
    const fileHandle = await saveTarget.directoryHandle.getFileHandle(zipName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(new Blob([zipBuffer], { type: 'application/zip' }));
    await writable.close();
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

async function startDownload(selectedResources: MoodleResource[]): Promise<void> {
  setButtonsEnabled(false);
  setProgress(0);
  lastFailedUrls = [];

  const zipName = computeDefaultZipName();
  setStatus(i18n('downloadStarted'));

  const returnBuffer = saveTarget.mode !== 'downloads';

  const resp = await sendToBackground({
    type: 'MD_BUILD_ZIP',
    resources: selectedResources,
    options: {
      zipName,
      saveAs: saveTarget.mode === 'downloads' ? saveTarget.saveAs : false,
      returnBuffer,
    },
  });

  if (resp.type === 'MD_BUILD_ZIP_RESULT' && resp.ok) {
    if (resp.failedUrls?.length) lastFailedUrls = resp.failedUrls;

    if (resp.zipBuffer && returnBuffer) {
      await writeZipToHandle(resp.zipBuffer, sanitizeFileName(zipName));
    }

    // Refresh tracking after download
    await loadTracking();

    if (onlyNew) {
      // When filtering to only-new, refresh selection to avoid checking already-downloaded items.
      selected = new Set(getVisibleResources().map((r) => r.id));
    }
    renderList();

    const okCount = selectedResources.filter((r) => !lastFailedUrls.includes(r.url)).length;
    setStatus(i18n('downloadComplete', String(okCount)));
    setProgress(100);

    if (lastFailedUrls.length > 0) showError(`${i18n('someFilesFailed', String(lastFailedUrls.length))}`);
    else hideError();
  } else if (resp.type === 'MD_BUILD_ZIP_RESULT' && !resp.ok) {
    showError(resp.error);
    setStatus(i18n('error'));
  }

  setButtonsEnabled(true);
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

  document.getElementById('btnChooseFolder')?.addEventListener('click', async () => {
    await pickSaveTarget();
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
      if (msg.phase === 'download') {
        setProgress(98);
        setStatus(i18n('saving'));
      }
    }

    if (msg.type === 'MD_COMPLETE' && msg.ok) {
      setProgress(100);
      setStatus(i18n('downloadComplete', String(msg.fileCount)));
    }

    if (msg.type === 'MD_COMPLETE' && !msg.ok) {
      showError(msg.error);
    }

    return false;
  });
}

async function init(): Promise<void> {
  localizeHtml();
  attachEventHandlers();

  setStatus(i18n('loading'));
  setProgress(0);

  await loadTelemetryPref();
  await loadTracking();

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
      setStatus(i18n('ready', String(resources.length)));
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
