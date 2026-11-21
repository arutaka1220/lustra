import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = process.cwd();
const temporary = [];
function makeDir() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lustra-feed-')); temporary.push(dir); return dir; }
function fixtureSignature() {
  return `untrusted comment: fixture only\n${Buffer.alloc(74).toString('base64')}\ntrusted comment: fixture only\n${Buffer.alloc(64).toString('base64')}\n`;
}
function setupAssets() {
  const dir = makeDir();
  const config = JSON.parse(fs.readFileSync(path.join(repo, '.github/release-setup.json'), 'utf8'));
  for (const filename of Object.values(config.feed.tauri.artifacts)) {
    fs.writeFileSync(path.join(dir, filename), `signed payload for ${filename}`);
    fs.writeFileSync(path.join(dir, `${filename}.sig`), fixtureSignature());
  }
  return { dir, config };
}
function generate(version, assets, output, env = {}) {
  return spawnSync(process.execPath, [path.join(repo, 'scripts/generate-update-feed.mjs'), version, assets, output], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_REPOSITORY: 'arutaka1220/lustra', RELEASE_TAG: `v${version}`, ...env }
  });
}
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

test('generates channel-specific aggregate feeds from artifact and signature files', () => {
  const { dir, config } = setupAssets();
  const output = makeDir();
  const result = generate('0.2.0-beta.1', dir, output, { RELEASE_PUB_DATE: '2026-11-21T12:00:00Z' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(output, 'stable/stable.json')), false);
  const beta = JSON.parse(fs.readFileSync(path.join(output, 'beta/beta.json'), 'utf8'));
  assert.equal(beta.version, '0.2.0-beta.1');
  assert.equal(beta.pub_date, '2026-11-21T12:00:00Z');
  assert.deepEqual(beta.session_snapshot_versions, [3]);
  assert.deepEqual(Object.keys(beta.platforms).sort(), Object.keys(config.feed.tauri.artifacts).sort());
  for (const [target, filename] of Object.entries(config.feed.tauri.artifacts)) {
    assert.equal(beta.platforms[target].url, `https://github.com/arutaka1220/lustra/releases/download/v0.2.0-beta.1/${encodeURIComponent(filename)}`);
    assert.equal(beta.platforms[target].signature, fixtureSignature().trim());
  }
});

test('a Stable feed also reaches Beta only when Stable promotes a newer compatible version', () => {
  const { dir } = setupAssets();
  const output = makeDir();
  const result = generate('0.3.0', dir, output, { PREVIOUS_STABLE: '0.2.0', PREVIOUS_BETA: '0.2.5-beta.1' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'stable/stable.json'), 'utf8')).version, '0.3.0');
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, 'beta/beta.json'), 'utf8')).version, '0.3.0');
});

test('a first Stable release seeds only the Stable channel', () => {
  const { dir } = setupAssets();
  const output = makeDir();
  const result = generate('0.1.0', dir, output);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(output, 'stable/stable.json')), true);
  assert.equal(fs.existsSync(path.join(output, 'beta/beta.json')), false);
});

test('refuses missing signature files, empty packages, and stale feed writes', () => {
  const { dir, config } = setupAssets();
  const output = makeDir();
  fs.rmSync(path.join(dir, `${Object.values(config.feed.tauri.artifacts)[0]}.sig`));
  assert.notEqual(generate('0.2.0', dir, output).status, 0);
  const { dir: second } = setupAssets();
  const file = Object.values(config.feed.tauri.artifacts)[0];
  fs.writeFileSync(path.join(second, file), '');
  assert.notEqual(generate('0.2.0', second, output).status, 0);
  const { dir: third, config: thirdConfig } = setupAssets();
  fs.writeFileSync(path.join(third, `${Object.values(thirdConfig.feed.tauri.artifacts)[0]}.sig`), 'not a minisign signature');
  assert.notEqual(generate('0.2.0', third, output).status, 0);
  assert.notEqual(generate('0.2.0', second, output, { PREVIOUS_STABLE: '0.3.0' }).status, 0);
});

test('allows an exact-version feed retry while rejecting older versions', () => {
  const { dir } = setupAssets();
  const output = makeDir();
  const retry = generate('0.2.0', dir, output, { PREVIOUS_STABLE: '0.2.0', ALLOW_FEED_RETRY: 'true' });
  assert.equal(retry.status, 0, retry.stderr);
  assert.notEqual(generate('0.1.9', dir, output, { PREVIOUS_STABLE: '0.2.0' }).status, 0);
  assert.notEqual(generate('0.2.0', dir, output, { PREVIOUS_STABLE: '0.2.0' }).status, 0);
  const betaRetry = generate('0.2.0-beta.1', dir, output, { PREVIOUS_BETA: '0.2.0-beta.1', ALLOW_FEED_RETRY: 'true' });
  assert.equal(betaRetry.status, 0, betaRetry.stderr);
});
