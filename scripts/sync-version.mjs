#!/usr/bin/env node
/**
 * Sync extension metadata from environment variables into:
 * - package.json
 * - manifests/manifest.base.json
 *
 * Variables:
 * - VITE_EXT_VERSION
 * - VITE_EXT_NAME
 * - VITE_EXT_DESCRIPTION
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const version = process.env.VITE_EXT_VERSION || '1.0.0';
const name = process.env.VITE_EXT_NAME || 'moodle.download';
const description =
  process.env.VITE_EXT_DESCRIPTION ||
  'Mass download Moodle course materials with folder structure preservation';

async function readJson(p) {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(p, obj) {
  await fs.writeFile(p, `${JSON.stringify(obj, null, 2)}\n`);
}

async function main() {
  // package.json
  const pkgPath = path.resolve('package.json');
  const pkg = await readJson(pkgPath);
  pkg.version = version;
  pkg.name = name;
  pkg.description = description;
  await writeJson(pkgPath, pkg);

  // manifest base
  const manifestPath = path.resolve('manifests/manifest.base.json');
  const manifest = await readJson(manifestPath);
  manifest.version = version;
  manifest.name = name;
  manifest.description = description;
  await writeJson(manifestPath, manifest);
}

await main();
