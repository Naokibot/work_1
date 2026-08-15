import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const numbered = (prefix) => Array.from({ length: 12 }, (_, index) => `${prefix}${String(index).padStart(2, '0')}.b64`);
const parts = [
  '.patch/anki-00.b64',
  '.patch/anki-01a.b64', '.patch/anki-01b.b64', '.patch/anki-01c.b64',
  ...numbered('.patch/anki-02-'),
  '.patch/anki-03.b64', '.patch/anki-04.b64',
  ...numbered('.patch/anki-05-'),
  '.patch/anki-06.b64', '.patch/anki-07.b64'
];

let base64 = '';
for (const part of parts) base64 += await readFile(part, 'utf8');
await writeFile('.patch/anki-parity.tar.gz', Buffer.from(base64, 'base64'));

const tar = spawnSync('tar', ['-xzf', '.patch/anki-parity.tar.gz', '-C', '.'], { stdio: 'inherit' });
if (tar.status !== 0) process.exit(tar.status ?? 1);

const cleanup = [
  ...parts,
  '.patch/anki-01.b64', '.patch/anki-02.b64', '.patch/anki-05.b64',
  '.patch/anki-parity.tar.gz'
];
for (const path of cleanup) await rm(path, { force: true });
await rm('scripts/apply-anki-parity.mjs', { force: true });
await rm('.github/workflows/apply-anki-parity.yml', { force: true });
