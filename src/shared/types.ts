export interface MoodleResource {
  /** Eindeutige ID (z.B. aus Moodle-URL oder Hash) */
  id: string;
  /** Anzeigename/Dateiname */
  name: string;
  /** Download- oder View-URL */
  url: string;
  /** Ressourcentyp */
  type: 'file' | 'folder';
  /** Dateityp (z.B. 'pdf', 'zip', 'docx') */
  fileType?: string;
  /** Dateigröße in Bytes (optional) */
  size?: number;
  /** Ordnerpfad innerhalb des ZIP (z.B. 'Woche 1/Vorlesung') */
  path: string;
}

export interface DownloadStats {
  fileCount: number;
  fileTypes: Record<string, number>; // z.B. { pdf: 5, zip: 2 }
  errors: Array<{ type: string; count: number }>;
  /** ISO-String, auf Tag gerundet (YYYY-MM-DD) */
  timestamp: string;
  extensionVersion: string;
  browserType: 'chrome' | 'firefox';
}

export interface StoredDownload {
  url: string;
  hash: string; // SHA-256
  timestamp: number;
  fileName: string;
}

export interface SaveSettings {
  /**
   * downloads: via chrome.downloads (standardmäßig in Downloads)
   * directory: File System Access DirectoryHandle (nur wenn verfügbar)
   */
  mode: 'downloads' | 'directory';
  /** Bei downloads-mode: saveAs zeigt Dialog */
  saveAs: boolean;
}

export type DownloadTrackingMap = Record<string, StoredDownload>;

export type MessageToContent = { type: 'MD_EXTRACT_RESOURCES' } | { type: 'MD_PING' };

export type MessageFromContent =
  | { type: 'MD_EXTRACT_RESOURCES_RESULT'; resources: MoodleResource[]; isMoodle: boolean }
  | { type: 'MD_PONG'; isMoodle: boolean };

export type MessageToBackground =
  | { type: 'MD_GET_TRACKING' }
  | { type: 'MD_RESET_TRACKING' }
  | { type: 'MD_GET_TELEMETRY_PREF' }
  | { type: 'MD_SET_TELEMETRY_PREF'; optIn: boolean }
  | { type: 'MD_NOTIFY_SAVE_DONE'; fileCount: number }
  | {
      type: 'MD_BUILD_ZIP';
      resources: MoodleResource[];
      options: {
        zipName?: string;
        /** Falls true: ZIP als ArrayBuffer zurückgeben (Popup schreibt Datei selbst) */
        returnBuffer?: boolean;
      };
    };

export type BackgroundProgressPhase = 'fetch' | 'zip' | 'download';

export type MessageFromBackground =
  | { type: 'MD_TRACKING_RESULT'; tracking: DownloadTrackingMap }
  | { type: 'MD_RESET_TRACKING_RESULT'; ok: true }
  | { type: 'MD_TELEMETRY_PREF_RESULT'; asked: boolean; optIn: boolean }
  | { type: 'MD_NOTIFY_SAVE_DONE_RESULT'; ok: true }
  | {
      type: 'MD_BUILD_ZIP_RESULT';
      ok: true;
      downloadId?: number;
      zipBuffer?: ArrayBuffer;
      failedUrls?: string[];
    }
  | { type: 'MD_BUILD_ZIP_RESULT'; ok: false; error: string; failedUrls?: string[] }
  | {
      type: 'MD_PROGRESS';
      phase: BackgroundProgressPhase;
      current: number;
      total: number;
      fileName?: string;
    }
  | { type: 'MD_COMPLETE'; ok: true; fileCount: number; failedCount: number }
  | { type: 'MD_COMPLETE'; ok: false; error: string };

/** Port-basiertes ZIP-Streaming (für große ZIPs) */
export type ZipPortMessageToBackground = {
  type: 'MD_ZIP_STREAM_REQUEST';
  zipName: string;
  resources: MoodleResource[];
};

export type ZipPortMessageFromBackground =
  | {
      type: 'MD_ZIP_STREAM_META';
      zipName: string;
      totalBytes: number;
      chunkSize: number;
      totalChunks: number;
      fileCount: number;
      failedCount: number;
      totalFiles: number;
      failedUrls: string[];
    }
  | { type: 'MD_ZIP_STREAM_CHUNK'; index: number; data: ArrayBuffer }
  | { type: 'MD_ZIP_STREAM_DONE' }
  | { type: 'MD_ZIP_STREAM_ERROR'; error: string };
