import { webcrypto } from 'node:crypto';

// Ensure WebCrypto is available in Vitest/Node.
if (!(globalThis as any).crypto?.subtle) {
  (globalThis as any).crypto = webcrypto as any;
}

// Provide Vite define globals for unit tests.
Object.assign(globalThis, {
  __MD_ENABLE_TELEMETRY__: false,
  __MD_STATS_API_URL__: '',
  __MD_STATS_API_KEY__: '',
  __MD_ENABLE_DEBUG_LOGS__: false,
  __MD_GITHUB_REPO__: '',
});
