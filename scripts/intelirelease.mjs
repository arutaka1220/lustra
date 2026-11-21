#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.([1-9]\d*))?$/;

function version(value) {
  if (typeof value !== 'string') throw new Error('version must be a string');
  const normalized = value.replace(/^v/, '');
  if (!versionPattern.test(normalized)) throw new Error(`invalid version: ${value}`);
  return normalized;
}

function compare(left, right) {
  const a = version(left).match(versionPattern);
  const b = version(right).match(versionPattern);
  for (let index = 1; index <= 3; index += 1) {
    const difference = Number(a[index]) - Number(b[index]);
    if (difference) return Math.sign(difference);
  }
  if (a[4] === undefined && b[4] !== undefined) return 1;
  if (a[4] !== undefined && b[4] === undefined) return -1;
  return Math.sign(Number(a[4] || 0) - Number(b[4] || 0));
}

function readJson(pathname) {
  return JSON.parse(fs.readFileSync(pathname, 'utf8'));
}

function readVersionFiles(config) {
  if (!Array.isArray(config.versionFiles) || config.versionFiles.length < 2) {
    throw new Error('versionFiles must contain the authoritative version and its mirrors');
  }
  const root = fs.realpathSync('.');
  const entries = config.versionFiles.map((entry) => {
    const resolved = fs.realpathSync(entry.path);
    const relative = path.relative(root, resolved);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`version file outside repository: ${entry.path}`);
    }
    const text = fs.readFileSync(resolved, 'utf8');
    if (entry.kind === 'json') {
      const object = JSON.parse(text);
      const keys = entry.key.split('.');
      let parent = object;
      for (const key of keys.slice(0, -1)) parent = parent[key];
      const key = keys.at(-1);
      if (!parent || typeof parent[key] !== 'string') throw new Error(`missing version key in ${entry.path}`);
      return { entry, text, object, parent, key, current: version(parent[key]) };
    }
    if (entry.kind === 'text' && typeof entry.prefix === 'string' && typeof entry.suffix === 'string') {
      const escapedPrefix = entry.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const escapedSuffix = entry.suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`${escapedPrefix}(v?(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)(?:-beta\\.[1-9]\\d*)?)${escapedSuffix}`, 'g');
      const matches = [...text.matchAll(regex)];
      if (matches.length !== 1) throw new Error(`version pattern must match exactly once in ${entry.path}`);
      const match = matches[0];
      const start = match.index + entry.prefix.length;
      return { entry, text, start, end: start + match[1].length, current: version(match[1]) };
    }
    throw new Error(`unsupported version file definition: ${entry.path}`);
  });
  if (entries.some((item) => compare(item.current, entries[0].current) !== 0)) {
    throw new Error('version mirrors disagree');
  }
  return entries;
}

function validateConfig(config) {
  const entries = readVersionFiles(config);
  return entries[0].current;
}

function prepare(newVersion, config) {
  const normalized = version(newVersion);
  const entries = readVersionFiles(config);
  if (compare(normalized, entries[0].current) <= 0) throw new Error('new version must be greater than current');
  const contents = entries.map((item) => {
    if (item.object) {
      item.parent[item.key] = normalized;
      return [item.entry.path, `${JSON.stringify(item.object, null, 2)}\n`];
    }
    return [item.entry.path, `${item.text.slice(0, item.start)}${normalized}${item.text.slice(item.end)}`];
  });
  for (const [pathname, content] of contents) fs.writeFileSync(pathname, content);
}

function main(args) {
  const [command, ...rest] = args;
  if (command === 'version' && (rest.length === 1 || rest.length === 2)) {
    const value = version(rest[0]);
    if (rest[1] && compare(value, rest[1]) <= 0) throw new Error('version must increase');
    console.log(value);
    return;
  }
  if (command === 'compare' && rest.length === 2) {
    console.log(compare(rest[0], rest[1]));
    return;
  }
  if (command === 'read-version' && rest.length === 1) {
    console.log(validateConfig(readJson(rest[0])));
    return;
  }
  if (command === 'prepare' && rest.length === 2) {
    prepare(rest[0], readJson(rest[1]));
    return;
  }
  if (command === 'route' && rest.length >= 2 && rest.length <= 4) {
    const [mode, input, stable = '', beta = ''] = rest;
    const candidate = version(input);
    if (!['stable', 'stable-beta'].includes(mode)) throw new Error('invalid channel mode');
    if (stable) version(stable);
    if (beta) version(beta);
    let channels;
    if (candidate.includes('-beta.')) {
      if (mode !== 'stable-beta' || (stable && compare(candidate, stable) <= 0) || (beta && compare(candidate, beta) <= 0)) {
        throw new Error('stale or disabled beta release');
      }
      channels = ['beta'];
    } else {
      if (stable && compare(candidate, stable) <= 0) throw new Error('duplicate or stale stable release');
      channels = ['stable'];
      if (mode === 'stable-beta' && beta && compare(candidate, beta) > 0) channels.push('beta');
    }
    console.log(JSON.stringify(channels));
    return;
  }
  throw new Error('invalid command or arguments');
}

try {
  main(process.argv.slice(2));
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
