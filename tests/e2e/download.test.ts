import { test, expect } from '@playwright/test';

// E2E testing browser extensions reliably requires additional harnessing
// (loading an unpacked extension, handling service worker lifecycle, etc.).
// For MVP we keep this as a placeholder and focus on unit tests.

test.skip('extension e2e placeholder', async () => {
  expect(true).toBe(true);
});
