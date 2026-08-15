import { readFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const parts = Array.from({ length: 8 }, (_, index) => `.patch/anki-${String(index).padStart(2, '0')}.b64`);
let base64 = '';
for (const part of parts) base64 += await readFile(part, 'utf8');
await writeFile('.patch/anki-parity.tar.gz', Buffer.from(base64, 'base64'));

const tar = spawnSync('tar', ['-xzf', '.patch/anki-parity.tar.gz', '-C', '.'], { stdio: 'inherit' });
if (tar.status !== 0) process.exit(tar.status ?? 1);

for (const part of parts) await rm(part, { force: true });
await rm('.patch/anki-parity.tar.gz', { force: true });
await rm('scripts/apply-anki-parity.mjs', { force: true });
await rm('.github/workflows/apply-anki-parity.yml', { force: true });
