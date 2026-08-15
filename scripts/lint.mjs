import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['src', 'gas', 'scripts'];
const violations = [];

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (/\.(ts|js|mjs|gs)$/.test(entry.name)) {
      const text = await readFile(full, 'utf8');
      text.split('\n').forEach((line, index) => {
        if (/\s+$/.test(line)) violations.push(`${path.relative(root, full)}:${index + 1}: trailing whitespace`);
        if (/\bconsole\.log\s*\(/.test(line)) violations.push(`${path.relative(root, full)}:${index + 1}: console.log is not allowed`);
        if (/\.innerHTML\s*=/.test(line)) violations.push(`${path.relative(root, full)}:${index + 1}: avoid innerHTML assignments`);
        if (/\beval\s*\(/.test(line)) violations.push(`${path.relative(root, full)}:${index + 1}: eval is not allowed`);
      });
    }
  }
}

for (const target of targets) await walk(path.join(root, target));
if (violations.length) {
  console.error(violations.join('\n'));
  process.exit(1);
}
process.stdout.write('lint: ok\n');
