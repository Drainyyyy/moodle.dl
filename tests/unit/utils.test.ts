import { describe, it, expect } from 'vitest';
import { calculateHash, sanitizeFileName, ensureUniquePath } from '../../src/shared/utils';

describe('calculateHash', () => {
  it('should return consistent SHA-256 hash', async () => {
    const hash1 = await calculateHash('test');
    const hash2 = await calculateHash('test');
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('sanitizeFileName', () => {
  it('should remove illegal characters', () => {
    expect(sanitizeFileName('a/b:c*?"<>|')).toBe('a_b_c______');
  });

  it('should return fallback for empty', () => {
    expect(sanitizeFileName('   ')).toBe('file');
  });
});

describe('ensureUniquePath', () => {
  it('should uniquify duplicate names', () => {
    const set = new Set<string>();
    const p1 = ensureUniquePath(set, 'Woche 1/file.pdf');
    const p2 = ensureUniquePath(set, 'Woche 1/file.pdf');
    expect(p1).toBe('Woche 1/file.pdf');
    expect(p2).toBe('Woche 1/file (1).pdf');
  });
});
