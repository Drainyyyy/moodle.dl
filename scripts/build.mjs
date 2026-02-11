#!/usr/bin/env node
/*
 * Production-safe build for browser extensions.
 *
 * Why this script exists:
 * - Content scripts cannot be ES modules.
 * - To avoid Rollup/Vite emitting shared chunks with imports, we build each entry
 *   (background/content/popup) as a single self-contained IIFE bundle.
 *
 * Usage:
 *   node scripts/build.mjs --target=chrome
 *   node scripts/build.mjs --target=firefox
 *   node scripts/build.mjs --target=firefox-compat
 *   node scripts/build.mjs --watch --target=chrome
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

function parseArg(name) {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

const watch = process.argv.includes('--watch');
const target =
  parseArg('target') || process.env.VITE_BUILD_TARGET || process.env.npm_config_target || 'chrome';

const entries = ['background', 'content', 'popup'];
const viteBin = path.resolve('node_modules', 'vite', 'bin', 'vite.js');

function spawnBuild(entry, isFirst) {
  const env = {
    ...process.env,
    VITE_BUILD_TARGET: target,
    VITE_SINGLE_ENTRY: entry,
    VITE_EMPTY_OUTDIR: isFirst ? 'true' : 'false',
  };

  const args = ['node', viteBin, 'build'];
  if (watch) args.push('--watch');

  const child = spawn(args[0], args.slice(1), {
    stdio: 'inherit',
    env,
  });

  return child;
}

function waitExit(child) {
  return new Promise((resolve, reject) => {
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Build failed for ${child.pid} with code ${code}`));
    });
  });
}

const children = [];

function teardown() {
  children.forEach((child) => {
    try {
      child.kill('SIGINT');
    } catch {
      // ignore
    }
  });
}

process.on('SIGINT', () => {
  teardown();
  process.exit(0);
});
process.on('SIGTERM', () => {
  teardown();
  process.exit(0);
});

if (watch) {
  // Watch mode: run 3 builds concurrently.
  entries.forEach((entry, idx) => {
    const child = spawnBuild(entry, idx === 0);
    children.push(child);
  });
  // Keep alive while child processes are running.
  await new Promise(() => {});
} else {
  // CI/Release mode: run sequentially to keep logs tidy.
  await entries.reduce(async (prev, entry, idx) => {
    await prev;
    const child = spawnBuild(entry, idx === 0);
    children.push(child);
    await waitExit(child);
  }, Promise.resolve());
}
