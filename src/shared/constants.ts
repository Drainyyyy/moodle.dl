export const STORAGE_KEYS = {
  downloadTracking: 'downloadTracking',
  telemetryAsked: 'telemetryAsked',
  telemetryOptIn: 'telemetryOptIn',
  saveSettings: 'saveSettings',
} as const;

export const MOODLE_DETECT_SELECTORS: string[] = [
  'body.pagelayout-course',
  'body.path-course-view',
  'body.format-topics',
  'body.format-weeks',
  'meta[name="generator"][content*="Moodle"]',
  '#page',
  '#page-course-view',
];

export const COURSE_NAME_SELECTORS: string[] = [
  '#page-header .page-header-headings h1',
  '#page-header h1',
  'header#page-header h1',
  'h1',
];

export const SECTION_SELECTORS: string[] = [
  '.course-content .section',
  'li.section',
  'div.section',
];

export const SECTION_TITLE_SELECTORS: string[] = [
  '.sectionname',
  'h3.sectionname',
  'h2.sectionname',
  '.section-title',
  'h3',
  'h2',
];

export const ACTIVITY_LINK_SELECTORS: string[] = [
  'a.aalink[href]',
  '.activity a[href]',
  '.activity-item a[href]',
  'a[href*="pluginfile.php"]',
  'a[href*="mod/resource/view.php"]',
  'a[href*="mod/folder/view.php"]',
  'a[href*="mod/url/view.php"]',
];

export const DOWNLOADABLE_EXTENSIONS = new Set([
  'pdf',
  'zip',
  'rar',
  '7z',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'csv',
  'txt',
  'md',
  'rtf',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'mp4',
  'mov',
  'm4v',
  'webm',
  'mp3',
  'wav',
  'm4a',
  'ogg',
]);

export const KNOWN_MOODLE_PATH_HINTS = [
  '/course/view.php',
  '/mod/resource/',
  '/mod/folder/',
  '/pluginfile.php',
  '/mod/url/',
];

export const DEFAULT_ZIP_NAME = 'moodle-download.zip';

/**
 * Build-time injected flags.
 *
 * We intentionally do NOT rely on `import.meta.env` at runtime because extension
 * scripts are bundled as classic IIFEs (non-module) for maximum MV3/MV2
 * compatibility.
 */
export const ENABLE_TELEMETRY = __MD_ENABLE_TELEMETRY__;
export const STATS_API_URL = __MD_STATS_API_URL__;
export const STATS_API_KEY = __MD_STATS_API_KEY__;
export const ENABLE_DEBUG_LOGS = __MD_ENABLE_DEBUG_LOGS__;

/**
 * GitHub repository in the form "owner/repo".
 * Used for UI links and optional update checks.
 */
export const GITHUB_REPO = __MD_GITHUB_REPO__;

/**
 * Full https URL to the repository.
 */
export const GITHUB_REPO_URL = GITHUB_REPO ? `https://github.com/${GITHUB_REPO}` : '';
