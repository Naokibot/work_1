import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'assets'), { recursive: true });

const tsc = spawnSync('tsc', ['-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

for (const file of ['index.html', 'styles.css', 'compat.css']) {
  await cp(path.join(root, file), path.join(dist, file));
}
for (const file of ['manifest.webmanifest', 'icon.svg']) {
  await cp(path.join(root, 'public', file), path.join(dist, file));
}

async function listFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    const rel = path.posix.join(prefix, entry.name);
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(full, rel));
    else output.push(rel);
  }
  return output;
}

const assets = await listFiles(path.join(dist, 'assets'));
const precache = ['./', './index.html', './styles.css', './compat.css', './manifest.webmanifest', './icon.svg', ...assets.map((f) => `./assets/${f}`)];
const hash = createHash('sha256');
for (const file of ['index.html', 'styles.css', 'compat.css', 'manifest.webmanifest', 'icon.svg', ...assets.map((f) => `assets/${f}`)]) {
  hash.update(file);
  hash.update(await readFile(path.join(dist, file)));
}
const cacheName = `work-1-${hash.digest('hex').slice(0, 16)}`;
const template = await readFile(path.join(root, 'public', 'sw.template.js'), 'utf8');
const serviceWorker = template
  .replace('__ASSET_LIST__', JSON.stringify(precache, null, 2))
  .replace('__CACHE_NAME__', cacheName);
await writeFile(path.join(dist, 'sw.js'), serviceWorker);
