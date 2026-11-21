import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = process.cwd();
const tempDirs = [];
function tempDir() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lustra-release-')); tempDirs.push(dir); return dir; }
function run(command, ...args) {
  const cwdArg = args.find((arg) => arg.startsWith('--cwd='));
  if (cwdArg) args.splice(args.indexOf(cwdArg), 1);
  return spawnSync(process.execPath, [path.join(repo, 'scripts/intelirelease.mjs'), command, ...args], { cwd: cwdArg ? cwdArg.slice(6) : repo, encoding: 'utf8' });
}
afterEach(() => { for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

test('accepts stable and beta versions and rejects invalid tags', () => {
  assert.equal(run('version', 'v1.2.3').stdout.trim(), '1.2.3');
  assert.equal(run('version', '1.2.3-beta.4').stdout.trim(), '1.2.3-beta.4');
  assert.notEqual(run('version', '1.2.3-rc.1').status, 0);
  assert.notEqual(run('version', 'v01.2.3').status, 0);
});

test('orders stable after its beta and compares beta sequence', () => {
  assert.equal(run('compare', '1.2.3-beta.2', '1.2.3-beta.10').stdout.trim(), '-1');
  assert.equal(run('compare', '1.2.3-beta.10', '1.2.3').stdout.trim(), '-1');
  assert.equal(run('compare', '1.2.3', '1.2.3-beta.10').stdout.trim(), '1');
});

test('validates repository version mirrors and catches a mismatch', () => {
  const good = run('read-version', '.github/release-setup.json');
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout.trim(), '0.1.0');
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'a.json'), '{"version":"1.0.0"}');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'version = "1.1.0"');
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ versionFiles: [
    { path: 'a.json', kind: 'json', key: 'version' },
    { path: 'b.txt', kind: 'text', prefix: 'version = "', suffix: '"' }
  ] }));
  const mismatch = run('read-version', 'config.json', `--cwd=${dir}`);
  assert.notEqual(mismatch.status, 0);
});

test('routes Beta only to Beta and a new Stable to both applicable channels', () => {
  assert.equal(run('route', 'stable-beta', '1.3.0-beta.2', '1.2.0', '1.3.0-beta.1').stdout.trim(), '["beta"]');
  assert.equal(run('route', 'stable-beta', '1.3.0', '1.2.0', '1.2.5-beta.1').stdout.trim(), '["stable","beta"]');
  assert.notEqual(run('route', 'stable-beta', '1.2.0', '1.2.0', '1.3.0-beta.1').status, 0);
});

test('prepares all configured version mirrors and rejects stale release version', () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, 'p.json'), '{\n  "version": "1.0.0"\n}\n');
  fs.writeFileSync(path.join(dir, 'p.toml'), 'version = "1.0.0"\n');
  const config = { versionFiles: [
    { path: 'p.json', kind: 'json', key: 'version' },
    { path: 'p.toml', kind: 'text', prefix: 'version = "', suffix: '"' }
  ] };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  const prepared = run('prepare', '1.1.0', 'config.json', `--cwd=${dir}`);
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.match(fs.readFileSync(path.join(dir, 'p.json'), 'utf8'), /"version": "1.1.0"/);
  assert.match(fs.readFileSync(path.join(dir, 'p.toml'), 'utf8'), /1.1.0/);
  assert.notEqual(run('prepare', '1.0.5', 'config.json', `--cwd=${dir}`).status, 0);
});
