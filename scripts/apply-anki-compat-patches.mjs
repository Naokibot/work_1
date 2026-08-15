import { readFile, writeFile } from 'node:fs/promises';

async function patch(path, transforms) {
  let source = await readFile(path, 'utf8');
  for (const [label, find, replace] of transforms) {
    const before = source;
    source = typeof find === 'string' ? source.replace(find, replace) : source.replace(find, replace);
    if (source === before) throw new Error(`${path}: patch not applied: ${label}`);
  }
  await writeFile(path, source);
}

await patch('src/anki/templates.ts', [
  ['image occlusion import',
    "import { emptyCard } from './defaults.js';\n",
    "import { emptyCard } from './defaults.js';\nimport { legacyMasksFromJson, parseNativeOcclusions } from './image-occlusion.js';\n"],
  ['native image occlusion card generation',
`  if (noteType.kind === 'image-occlusion') {
    const image = fieldValue(note, 'Image');
    const extra = fieldValue(note, 'Extra');
    const output: StudyCard[] = [];
    const template = noteType.templates[0];
    if (!template) return output;
    masksFromNote(note).forEach((mask, offset) => {
      const key = \`${'${template.id}'}:mask:${'${mask.id}'}\`;
      const existing = byTemplate.get(key);
      const base = makeCard(note, noteType, deck, template, key, positionBase + offset, existing);
      output.push({
        ...base,
        question: '画像の隠された部分を答えてください。',
        answer: mask.answer || '画像の隠された部分',
        explanation: extra,
        imageOcclusion: { imageDataUrl: image, mask, extra }
      });
    });
    return output;
  }
`,
`  if (noteType.kind === 'image-occlusion') {
    const image = fieldValue(note, 'Image');
    const header = fieldValue(note, 'Header');
    const extra = fieldValue(note, 'Back Extra') || fieldValue(note, 'Extra');
    const comments = fieldValue(note, 'Comments');
    const nativeGroups = parseNativeOcclusions(fieldValue(note, 'Occlusions'));
    const legacyMasks = legacyMasksFromJson(fieldValue(note, 'Masks'));
    const groups = nativeGroups.length
      ? nativeGroups
      : legacyMasks.map((mask, index) => ({ ordinal: index + 1, masks: [mask] }));
    const output: StudyCard[] = [];
    const template = noteType.templates[0];
    if (!template) return output;
    groups.forEach((group, offset) => {
      const active = group.masks.find((mask) => !mask.occludeInactive) ?? group.masks[0];
      if (!active) return;
      const key = \`${'${template.id}'}:c${'${group.ordinal}'}\`;
      const existing = byTemplate.get(key) ?? byTemplate.get(\`${'${template.id}'}:mask:${'${active.id}'}\`);
      const base = makeCard(note, noteType, deck, template, key, positionBase + offset, existing);
      const hideAll = group.masks.some((mask) => mask.occludeInactive);
      output.push({
        ...base,
        question: header ? \`${'${header}'}<div class="io-prompt">画像の隠された部分を答えてください。</div>\` : '画像の隠された部分を答えてください。',
        answer: active.text || active.answer || comments || extra || '画像の隠された部分',
        explanation: [extra, comments].filter(Boolean).join('<br>'),
        imageOcclusion: {
          imageDataUrl: image,
          mask: active,
          masks: group.masks,
          mode: hideAll ? 'hide-all-guess-one' : 'hide-one-guess-one',
          activeOrdinal: group.ordinal,
          header,
          comments,
          extra
        }
      });
    });
    return output;
  }
`]
]);

await patch('src/anki/anki-package.ts', [
  ['modern image occlusion stock kind', "originalStockKind===6?'cloze'", "originalStockKind===6?'image-occlusion'"],
  ['legacy package image occlusion model kind', "type:type.kind==='cloze'?1:0", "type:(type.kind==='cloze'||type.kind==='image-occlusion')?1:0"]
]);

await patch('src/anki/defaults.ts', [
  ['native image occlusion fields',
`      'Image Occlusion',
      ['Image', 'Masks', 'Extra'],
      [{ id: 'template_image_occlusion', name: 'Image Occlusion', front: '{{Image}}', back: '{{Image}}<hr id="answer">{{Extra}}' }],
      'image-occlusion'
`,
`      'Image Occlusion',
      ['Occlusions', 'Image', 'Header', 'Back Extra', 'Comments'],
      [{ id: 'template_image_occlusion', name: 'Image Occlusion', front: '{{#Header}}{{Header}}<br>{{/Header}}{{Image}}', back: '{{FrontSide}}<hr id="answer">{{Back Extra}}{{Comments}}' }],
      'image-occlusion'
`]
]);

await patch('src/review/controller.ts', [
  ['shape-aware image occlusion reviewer',
` private renderImageOcclusion(card:StudyCard,reveal:boolean){const data=card.imageOcclusion;if(!data)return;this.elements.io.hidden=false;const stage=document.createElement('div');stage.className='review-io-stage';const img=document.createElement('img');img.src=data.imageDataUrl;img.alt='Image Occlusion';stage.append(img);if(!reveal){const m=document.createElement('div');m.className='review-io-mask';Object.assign(m.style,{left:\`${'${data.mask.x}'}%\`,top:\`${'${data.mask.y}'}%\`,width:\`${'${data.mask.width}'}%\`,height:\`${'${data.mask.height}'}%\`});stage.append(m)}this.elements.io.replaceChildren(stage)}
`,
` private renderImageOcclusion(card:StudyCard,reveal:boolean){const data=card.imageOcclusion;if(!data){this.elements.io.hidden=true;return}this.elements.io.hidden=false;const stage=document.createElement('div');stage.className='review-io-stage';const img=document.createElement('img');img.src=data.imageDataUrl;img.alt='Image Occlusion';stage.append(img);if(!reveal){const masks=data.masks?.length?data.masks:[data.mask];for(const mask of masks){const m=document.createElement('div');const shape=mask.shape??'rect';m.className=\`review-io-mask shape-${'${shape}'}${'${mask.occludeInactive}'}?' is-inactive':''\`;if(shape==='polygon'&&mask.points?.length){Object.assign(m.style,{left:'0',top:'0',width:'100%',height:'100%',clipPath:\`polygon(${'${mask.points.map((point)=>`${point.x}% ${point.y}%`).join(\',\')}'} )\`})}else{Object.assign(m.style,{left:\`${'${mask.x}'}%\`,top:\`${'${mask.y}'}%\`,width:\`${'${mask.width}'}%\`,height:\`${'${mask.height}'}%\`});if(shape==='ellipse')m.style.borderRadius='50%'}if(mask.angle)m.style.transform=\`rotate(${'${mask.angle}'}deg)\`;stage.append(m)}}this.elements.io.replaceChildren(stage)}
`]
]);

console.log('Anki compatibility patches applied.');
