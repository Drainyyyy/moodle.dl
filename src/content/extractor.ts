import type { MoodleResource } from '../shared/types';
import {
  ACTIVITY_LINK_SELECTORS,
  COURSE_NAME_SELECTORS,
  MOODLE_DETECT_SELECTORS,
  SECTION_SELECTORS,
  SECTION_TITLE_SELECTORS,
} from '../shared/constants';
import { dedupeResources, getFileExtensionFromUrl, guessFileType, normalizeUrl, sanitizeFileName } from '../shared/utils';

export function isMoodlePage(doc: Document): boolean {
  return MOODLE_DETECT_SELECTORS.some((sel) => !!doc.querySelector(sel));
}

function pickFirstText(doc: Document, selectors: string[]): string | undefined {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return undefined;
}

function getSectionTitle(sectionEl: Element): string | undefined {
  for (const sel of SECTION_TITLE_SELECTORS) {
    const el = sectionEl.querySelector(sel);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return undefined;
}

function looksDownloadable(href: string): boolean {
  const lower = href.toLowerCase();
  if (lower.includes('pluginfile.php')) return true;
  if (lower.includes('mod/resource/view.php')) return true;
  if (lower.includes('forcedownload=1')) return true;

  const ext = getFileExtensionFromUrl(lower);
  if (ext && ext.length <= 6) return true;

  return false;
}

function extractLinkName(a: HTMLAnchorElement): string {
  const aria = a.getAttribute('aria-label')?.trim();
  const title = a.getAttribute('title')?.trim();
  const text = a.textContent?.trim();

  const raw = aria || title || text || 'file';
  return sanitizeFileName(raw);
}

function inferResourceType(a: HTMLAnchorElement): 'file' | 'folder' {
  const href = a.href || '';
  const lower = href.toLowerCase();
  const activity = a.closest('.activity, .activity-item');

  if (activity?.classList.contains('modtype_folder')) return 'folder';
  if (lower.includes('mod/folder/view.php')) return 'folder';

  return 'file';
}

function buildPath(courseName: string | undefined, sectionName: string | undefined, extra?: string): string {
  const parts: string[] = [];
  if (courseName) parts.push(sanitizeFileName(courseName));
  if (sectionName) parts.push(sanitizeFileName(sectionName));
  if (extra) parts.push(sanitizeFileName(extra));
  return parts.filter(Boolean).join('/');
}

export function extractResources(doc: Document): MoodleResource[] {
  const courseName = pickFirstText(doc, COURSE_NAME_SELECTORS);

  const resources: MoodleResource[] = [];

  const sections = Array.from(doc.querySelectorAll(SECTION_SELECTORS.join(',')));

  const visitedAnchors = new Set<HTMLAnchorElement>();

  const processAnchor = (a: HTMLAnchorElement, sectionName?: string, extraPath?: string): void => {
    if (visitedAnchors.has(a)) return;
    visitedAnchors.add(a);

    const href = a.getAttribute('href') || '';
    if (!href) return;

    const absUrl = normalizeUrl(href, doc.baseURI);
    if (!absUrl || absUrl.startsWith('javascript:')) return;

    if (!looksDownloadable(absUrl) && !/mod\/(resource|folder|url|page)\//i.test(absUrl)) return;

    const name = extractLinkName(a);
    const type = inferResourceType(a);
    const fileType = guessFileType(absUrl, name);
    const id = (() => {
      try {
        const u = new URL(absUrl);
        const moodleId = u.searchParams.get('id');
        if (moodleId) return moodleId;
        return `${u.pathname}-${u.search}`.slice(0, 120);
      } catch {
        return absUrl.slice(0, 120);
      }
    })();

    resources.push({
      id: sanitizeFileName(id),
      name,
      url: absUrl,
      type,
      fileType,
      path: buildPath(courseName, sectionName, extraPath),
    });
  };

  if (sections.length > 0) {
    for (const sectionEl of sections) {
      const sectionName = getSectionTitle(sectionEl) || undefined;

      // Primary activity links
      const anchors = Array.from(
        sectionEl.querySelectorAll<HTMLAnchorElement>(ACTIVITY_LINK_SELECTORS.join(',')),
      ).filter((a) => !!a.getAttribute('href'));

      for (const a of anchors) {
        // Folder contents sometimes rendered inline
        const activity = a.closest('.activity, .activity-item');
        const isFolderActivity = !!activity?.classList.contains('modtype_folder');
        if (isFolderActivity) {
          const folderName = extractLinkName(a);
          const inlineFiles = Array.from(
            activity.querySelectorAll<HTMLAnchorElement>('a[href*="pluginfile.php"], a[href*="forcedownload=1"]'),
          );
          if (inlineFiles.length > 0) {
            for (const f of inlineFiles) processAnchor(f, sectionName, folderName);
            continue;
          }
          // Fallback: treat folder view link itself as expandable folder
          processAnchor(a, sectionName, folderName);
          continue;
        }

        processAnchor(a, sectionName);
      }
    }
  } else {
    // Fallback for non-course pages: grab all pluginfile/resource links.
    const anchors = Array.from(
      doc.querySelectorAll<HTMLAnchorElement>(
        'a[href*="pluginfile.php"], a[href*="mod/resource/view.php"], a[href*="forcedownload=1"]',
      ),
    );
    for (const a of anchors) processAnchor(a);
  }

  return dedupeResources(resources);
}
