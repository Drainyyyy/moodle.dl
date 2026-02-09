#!/usr/bin/env node
/**
 * Set a single version number and propagate it across the repo.
 *
 * Updates:
 * - package.json#version
 * - manifests/manifest.base.json#version
 * - optionally: .env (VITE_EXT_VERSION) if the file exists
 * - CHANGELOG.md: ensures a section exists (creates a skeleton if missing)
 *
 * Usage:
 *   node scripts/set-version.mjs 1.2.3
 *   node scripts/set-version.mjs --version=1.2.3
 */

import fs from 'node:fs/promises';
import path from 'node:path';

function parseVersionArg(argv) {
  const byFlag = argv.find((a) => a.startsWith('--version='));
  if (byFlag) return byFlag.split('=')[1];
  const firstPositional = argv.find((a) => !a.startsWith('--'));
  return firstPositional;
}

function isSemver(v) {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v);
}

async function readJson(p) {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(p, obj) {
  await fs.writeFile(p, `${JSON.stringify(obj, null, 2)}\n`);
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function ensureChangelogSection(version) {
  const changelogPath = path.resolve('CHANGELOG.md');
  let content;
  try {
    content = await fs.readFile(changelogPath, 'utf8');
  } catch {
    // No changelog file: create one with a minimal template.
    const template = `# Changelog\n\n## [Unreleased]\n\n## [${version}] - ${todayISO()}\n### Added\n- Initial release\n`;
    await fs.writeFile(changelogPath, template);
    return;
  }

  const sectionHeader = `## [${version}]`;
  if (content.includes(sectionHeader)) return;

  // Insert new section right before the first existing version section (after Unreleased block).
  const unreleasedIdx = content.indexOf('## [Unreleased]');
  if (unreleasedIdx === -1) {
    // Fallback: append at end.
    const block = `\n\n## [${version}] - ${todayISO()}\n### Added\n- TODO\n`;
    await fs.writeFile(changelogPath, `${content}${block}`);
    return;
  }

  // Find the next version header after Unreleased.
  const afterUnreleased = content.slice(unreleasedIdx + '## [Unreleased]'.length);
  const match = afterUnreleased.match(/\n## \[[^\]]+\]/);
  let insertPos;
  if (match && typeof match.index === 'number') {
    insertPos = unreleasedIdx + '## [Unreleased]'.length + match.index;
  } else {
    insertPos = content.length;
  }

  const block = `\n\n## [${version}] - ${todayISO()}\n### Added\n- TODO\n\n### Changed\n- None\n\n### Fixed\n- None\n\n### Removed\n- None\n`;
  const updated = `${content.slice(0, insertPos)}${block}${content.slice(insertPos)}`;
  await fs.writeFile(changelogPath, updated);
}

async function updateEnvFile(version) {
  const envPath = path.resolve('.env');
  try {
    const raw = await fs.readFile(envPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    let found = false;
    const out = lines.map((line) => {
      if (line.startsWith('VITE_EXT_VERSION=')) {
        found = true;
        return `VITE_EXT_VERSION=${version}`;
      }
      return line;
    });
    if (!found) out.push(`VITE_EXT_VERSION=${version}`);
    await fs.writeFile(envPath, out.join('\n'));
  } catch {
    // .env is optional; ignore if missing.
  }
}

async function main() {
  const version = parseVersionArg(process.argv.slice(2));
  if (!version) {
    console.error('Missing version. Usage: node scripts/set-version.mjs 1.2.3');
    process.exit(1);
  }
  if (!isSemver(version)) {
    console.error(`Invalid semver: ${version}`);
    process.exit(1);
  }

  // package.json
  const pkgPath = path.resolve('package.json');
  const pkg = await readJson(pkgPath);
  pkg.version = version;
  await writeJson(pkgPath, pkg);

  // manifest base
  const baseManifestPath = path.resolve('manifests/manifest.base.json');
  const manifest = await readJson(baseManifestPath);
  manifest.version = version;
  await writeJson(baseManifestPath, manifest);

  // Optional .env
  await updateEnvFile(version);

  // Changelog presence (create skeleton if missing)
  await ensureChangelogSection(version);

  console.log(`Version set to ${version}`);
}

await main();
