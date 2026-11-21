#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.([1-9]\d*))?$/;
function parseVersion(value) {
  const match = typeof value === 'string' && value.match(versionPattern);
  if (!match) throw new Error(`invalid semantic version: ${value}`);
  return match.slice(1).map((part, index) => index < 3 ? Number(part) : part === undefined ? null : Number(part));
}
function compareVersions(left, right) {
  const a = parseVersion(left), b = parseVersion(right);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  if (a[3] === null && b[3] !== null) return 1;
  if (a[3] !== null && b[3] === null) return -1;
  return Math.sign((a[3] ?? 0) - (b[3] ?? 0));
}
function safeFile(directory, name) {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(name)) throw new Error(`unsafe artifact name: ${name}`);
  const file = path.join(directory, name);
  if (!fs.statSync(file).isFile() || fs.statSync(file).size === 0 || fs.lstatSync(file).isSymbolicLink()) {
    throw new Error(`missing or empty artifact: ${name}`);
  }
  return file;
}
function readSignature(directory, filename) {
  const contents = fs.readFileSync(safeFile(directory, `${filename}.sig`), 'utf8').trim();
  const lines = contents.split(/\r?\n/);
  const base64 = (value) => /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
  if (lines.length !== 4 || !lines[0].startsWith('untrusted comment:') ||
      !lines[2].startsWith('trusted comment:') || !base64(lines[1]) || !base64(lines[3]) ||
      Buffer.from(lines[1], 'base64').length !== 74 || Buffer.from(lines[3], 'base64').length !== 64) {
    throw new Error(`invalid Tauri updater signature: ${filename}.sig`);
  }
  return contents;
}
function main([version, assetsDir, outputDir]) {
  if (!version || !assetsDir || !outputDir) throw new Error('usage: generate-update-feed.mjs VERSION ASSETS_DIR OUTPUT_DIR');
  parseVersion(version);
  const config = JSON.parse(fs.readFileSync('.github/release-setup.json', 'utf8'));
  const notesPath = process.env.RELEASE_NOTES_FILE;
  const notes = notesPath ? fs.readFileSync(notesPath, 'utf8').trim() : '';
  const tag = process.env.RELEASE_TAG || `v${version}`;
  const base = `https://github.com/${process.env.GITHUB_REPOSITORY || 'arutaka1220/lustra'}/releases/download/${tag}`;
  const previousStable = process.env.PREVIOUS_STABLE || '';
  const previousBeta = process.env.PREVIOUS_BETA || '';
  const allowRetry = process.env.ALLOW_FEED_RETRY === 'true';
  if (previousStable) parseVersion(previousStable);
  if (previousBeta) parseVersion(previousBeta);
  const isBeta = version.includes('-beta.');
  if (isBeta && config.channelMode !== 'stable-beta') throw new Error('Beta release is disabled');
  if (isBeta && previousStable && compareVersions(version, previousStable) <= 0) throw new Error('Beta version must be newer than current Stable');
  if (isBeta && previousBeta) {
    const order = compareVersions(version, previousBeta);
    if (order < 0 || (order === 0 && !allowRetry)) throw new Error('Beta version cannot move backwards or duplicate a published release');
  }
  if (!isBeta && previousStable) {
    const order = compareVersions(version, previousStable);
    if (order < 0 || (order === 0 && !allowRetry)) throw new Error('Stable version cannot move backwards or duplicate a published release');
  }

  const platforms = {};
  for (const [target, filename] of Object.entries(config.feed.tauri.artifacts)) {
    const artifact = safeFile(assetsDir, filename);
    const signatureText = readSignature(assetsDir, filename);
    platforms[target] = { url: `${base}/${encodeURIComponent(filename)}`, signature: signatureText };
    if (!fs.statSync(artifact).size) throw new Error(`empty updater artifact: ${filename}`);
  }
  if (Object.keys(platforms).length === 0) throw new Error('no updater artifacts configured');
  const sessionSnapshotVersions = config.feed.tauri.sessionSnapshotVersions;
  if (!Array.isArray(sessionSnapshotVersions)
    || sessionSnapshotVersions.length === 0
    || sessionSnapshotVersions.some((item) => !Number.isInteger(item) || item < 1)) {
    throw new Error('feed.tauri.sessionSnapshotVersions must list supported session snapshot versions');
  }
  const pubDate = process.env.RELEASE_PUB_DATE || new Date().toISOString();
  if (Number.isNaN(Date.parse(pubDate))) throw new Error('invalid release publication date');
  const feed = {
    version,
    notes,
    pub_date: pubDate,
    session_snapshot_versions: sessionSnapshotVersions,
    platforms,
  };
  const destinations = isBeta ? ['beta'] : ['stable', ...(previousBeta && compareVersions(version, previousBeta) > 0 ? ['beta'] : [])];
  for (const channel of destinations) {
    const mapping = config.feed.tauri.paths[channel];
    if (!mapping || !Object.keys(mapping).length) throw new Error(`missing feed path for ${channel}`);
    for (const [relative, target] of Object.entries(mapping)) {
      if (path.isAbsolute(relative) || relative.split('/').some((part) => part === '..' || part === '.')) throw new Error(`unsafe feed path: ${relative}`);
      const result = target === 'aggregate' ? feed : (() => {
        if (!platforms[target]) throw new Error(`unknown platform target: ${target}`);
        return { version, notes, pub_date: feed.pub_date, ...platforms[target] };
      })();
      const destination = path.join(outputDir, channel, relative);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, `${JSON.stringify(result, null, 2)}\n`);
    }
  }
}
try { main(process.argv.slice(2)); }
catch (error) { console.error(`error: ${error.message}`); process.exitCode = 1; }
