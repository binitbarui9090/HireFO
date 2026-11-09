#!/usr/bin/env node
/**
 * Loads the repo-root .env (then .env.local, then $HIREFO_ENV_FILE) into
 * process.env and execs the remaining argv. One env file for every workspace:
 * the API, the worker, the Prisma CLI and the test runner all read the same file.
 *
 * Existing process.env values always win, so `FOO=1 npm run dev` still overrides.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function parse(contents) {
  const out = {};
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

// Highest precedence first: the first file to define a key wins, and anything
// already in process.env beats all of them. HIREFO_ENV_FILE is how the test
// runner points at .env.test without editing .env.
const files = [];
if (process.env.HIREFO_ENV_FILE) files.push(process.env.HIREFO_ENV_FILE);
files.push('.env.local', '.env');

const loaded = [];
for (const file of files) {
  const path = resolve(repoRoot, file);
  if (!existsSync(path)) continue;
  loaded.push(file);
  for (const [key, value] of Object.entries(parse(readFileSync(path, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const argv = process.argv.slice(2);
if (argv.length === 0) {
  console.error('usage: node scripts/with-env.mjs <command> [...args]');
  process.exit(64);
}

if (!loaded.length) {
  console.warn('[with-env] no .env file found at repo root — copy .env.example to .env');
}

const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit', env: process.env, shell: false });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
child.on('error', (err) => {
  console.error(`[with-env] failed to start "${argv[0]}":`, err.message);
  process.exit(127);
});
