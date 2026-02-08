import { webcrypto } from 'node:crypto';

// Ensure WebCrypto is available in Vitest/Node.
if (!(globalThis as any).crypto?.subtle) {
  (globalThis as any).crypto = webcrypto as any;
}
