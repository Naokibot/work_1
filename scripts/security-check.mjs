import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skip = new Set(['node_modules', 'dist', '.git']);
const findings = [];
const patterns = [
  ['GitHub token', /gh[pousr]_[A-Za-z0-9_]{20,}/g],
  ['Google API key', /AIza[0-9A-Za-z_-]{30,}/g],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ['hard-coded Apps Script deployment URL', /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec/g]
];

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (!/\.(png|jpg|jpeg|gif|ico|zip)$/i.test(entry.name)) {
      const text = await readFile(full, 'utf8');
      for (const [label, regex] of patterns) {
        if (regex.test(text)) findings.push(`${path.relative(root, full)}: ${label}`);
        regex.lastIndex = 0;
      }
    }
  }
}

await walk(root);
if (findings.length) {
  console.error(findings.join('\n'));
  process.exit(1);
}
process.stdout.write('security-check: ok\n');
