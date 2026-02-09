#!/usr/bin/env node
/**
 * Sync the version from package.json into manifests/manifest.base.json.
 *
 * Single source of truth:
 * - package.json#version
 *
 * This prevents having to maintain the version in multiple places.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

async function readJson(p) {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(p, obj) {
  await fs.writeFile(p, `${JSON.stringify(obj, null, 2)}\n`);
}

async function main() {
  const pkgPath = path.resolve('package.json');
  const pkg = await readJson(pkgPath);
  if (!pkg.version) throw new Error('package.json has no version');

  const baseManifestPath = path.resolve('manifests/manifest.base.json');
  const manifest = await readJson(baseManifestPath);
  manifest.version = String(pkg.version);

  await writeJson(baseManifestPath, manifest);
}

await main();
