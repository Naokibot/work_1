import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const vendorDir = path.join(dist, 'vendor');
await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, 'assets'), { recursive: true });
await mkdir(vendorDir, { recursive: true });

const tsc = spawnSync('tsc', ['-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
if (tsc.status !== 0) process.exit(tsc.status ?? 1);
for (const file of ['index.html', 'styles.css']) await cp(path.join(root, file), path.join(dist, file));
for (const file of ['manifest.webmanifest', 'icon.svg']) await cp(path.join(root, 'public', file), path.join(dist, file));

async function copyVendor(source, destination, fallback = '') {
  try { await access(source); await cp(source, path.join(vendorDir, destination)); }
  catch { if (fallback) await writeFile(path.join(vendorDir, destination), fallback); else throw new Error(`Missing vendor asset: ${source}`); }
}

await copyVendor(path.join(root, 'node_modules', 'mathjax', 'es5', 'tex-svg-full.js'), 'mathjax.js', 'window.MathJax=window.MathJax||{};');
await copyVendor(path.join(root, 'node_modules', 'fflate', 'umd', 'index.js'), 'fflate.js');
await copyVendor(path.join(root, 'node_modules', 'fzstd', 'umd', 'index.js'), 'fzstd.js');
await copyVendor(path.join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.js'), 'sql-wasm.js');
await copyVendor(path.join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'), 'sql-wasm.wasm');

async function list(dir, prefix = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = path.posix.join(prefix, entry.name), full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await list(full, rel)); else out.push(rel);
  }
  return out;
}
const assets = await list(path.join(dist, 'assets'));
const vendor = await list(vendorDir);
const precache = ['./', './index.html', './styles.css', './manifest.webmanifest', './icon.svg', ...vendor.map((file) => `./vendor/${file}`), ...assets.map((file) => `./assets/${file}`)];
const hash = createHash('sha256');
for (const file of precache.filter((file) => file !== './').map((file) => file.replace(/^\.\//, ''))) { hash.update(file); hash.update(await readFile(path.join(dist, file))); }
const template = await readFile(path.join(root, 'public', 'sw.template.js'), 'utf8');
await writeFile(path.join(dist, 'sw.js'), template.replace('__ASSET_LIST__', JSON.stringify(precache)).replace('__CACHE_NAME__', `work-1-${hash.digest('hex').slice(0, 16)}`));
