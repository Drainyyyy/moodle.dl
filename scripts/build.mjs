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
  parseArg('target') ||
  process.env.VITE_BUILD_TARGET ||
  process.env.npm_config_target ||
  'chrome';

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
  for (const c of children) {
    try {
      c.kill('SIGINT');
    } catch {
      // ignore
    }
  }
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
  for (let i = 0; i < entries.length; i += 1) {
    const child = spawnBuild(entries[i], i === 0);
    children.push(child);
  }
  // keep alive
  // eslint-disable-next-line no-constant-condition
  while (true) {
    // Node event loop will stay alive because children are running.
    // Sleep via a never-resolving promise.
    // eslint-disable-next-line no-await-in-loop
    await new Promise(() => {});
  }
} else {
  // CI/Release mode: run sequentially to keep logs tidy.
  for (let i = 0; i < entries.length; i += 1) {
    const child = spawnBuild(entries[i], i === 0);
    children.push(child);
    // eslint-disable-next-line no-await-in-loop
    await waitExit(child);
  }
}
