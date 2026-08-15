import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const appPath = path.join(root, 'src/app/app.ts');
let app = await readFile(appPath, 'utf8');

function replaceOnce(from, to, label) {
  const index = app.indexOf(from);
  if (index < 0) throw new Error(`app.ts patch anchor not found: ${label}`);
  if (app.indexOf(from, index + from.length) >= 0) throw new Error(`app.ts patch anchor is not unique: ${label}`);
  app = `${app.slice(0, index)}${to}${app.slice(index + from.length)}`;
}

replaceOnce(
  "placeholder: '問題・答え・解説・タグを検索'",
  "placeholder: '番号・問題・答え・解説・タグを検索'",
  'search placeholder'
);
replaceOnce(
  "[card.question, card.answer, card.explanation, ...card.tags].join('\\n')",
  "[card.cardNumber ?? '', card.question, card.answer, card.explanation, ...card.tags].join('\\n')",
  'card number search'
);
replaceOnce(
  "    const content = el('div');\n    const title = el('h3', { text: card.question });",
  "    const content = el('div');\n    if (card.cardNumber) content.append(el('p', { className: 'card-number', text: `No. ${card.cardNumber}` }));\n    const title = el('h3', { text: card.question });",
  'card list number'
);
replaceOnce(
  "    byId<HTMLInputElement>('card-id').value = card?.id ?? '';\n",
  "    byId<HTMLInputElement>('card-id').value = card?.id ?? '';\n    byId<HTMLInputElement>('card-number').value = card?.cardNumber ?? '';\n",
  'card dialog number'
);
replaceOnce(
  "    return {\n      question: byId<HTMLTextAreaElement>('card-question').value,",
  "    return {\n      cardNumber: byId<HTMLInputElement>('card-number').value,\n      question: byId<HTMLTextAreaElement>('card-question').value,",
  'card draft number'
);
replaceOnce(
  "      const updated: StudyCard = {\n        ...original,\n        question: draft.question.trim(),",
  "      const updated: StudyCard = {\n        ...original,\n        cardNumber: draft.cardNumber?.trim() ?? '',\n        question: draft.question.trim(),",
  'edited card number'
);

await writeFile(appPath, app);

const copies = [
  ['.patch/index.html', 'index.html'],
  ['.patch/compat.css', 'compat.css'],
  ['.patch/REVIEW.md', 'REVIEW.md'],
  ['.patch/src/types.ts', 'src/types.ts'],
  ['.patch/src/cards/cards.ts', 'src/cards/cards.ts'],
  ['.patch/src/utils/core.ts', 'src/utils/core.ts'],
  ['.patch/src/main.ts', 'src/main.ts'],
  ['.patch/src/canvas/pad.ts', 'src/canvas/pad.ts'],
  ['.patch/src/review/controller.ts', 'src/review/controller.ts'],
  ['.patch/src/storage/backup.ts', 'src/storage/backup.ts'],
  ['.patch/src/sync/client.ts', 'src/sync/client.ts'],
  ['.patch/public/sw.template.js', 'public/sw.template.js'],
  ['.patch/scripts/build.mjs', 'scripts/build.mjs'],
  ['.patch/tests/cards.test.mjs', 'tests/cards.test.mjs']
];

for (const [source, destination] of copies) {
  const target = path.join(root, destination);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(path.join(root, source), target);
}

await rm(path.join(root, '.patch'), { recursive: true, force: true });
await rm(path.join(root, 'scripts/apply-ipad-fix.mjs'), { force: true });
await rm(path.join(root, '.github/workflows/apply-ipad-fix.yml'), { force: true });
