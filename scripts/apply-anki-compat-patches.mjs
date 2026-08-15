import { readFile, writeFile } from 'node:fs/promises';

async function replaceOnce(path, label, find, replacement) {
  const source = await readFile(path, 'utf8');
  if (!source.includes(find)) throw new Error(`${path}: missing patch target: ${label}`);
  await writeFile(path, source.replace(find, replacement));
}

async function replaceBetween(path, label, startMarker, endMarker, replacement) {
  const source = await readFile(path, 'utf8');
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0 || end <= start) throw new Error(`${path}: missing patch range: ${label}`);
  await writeFile(path, source.slice(0, start) + replacement + source.slice(end));
}

await replaceOnce(
  'src/anki/templates.ts',
  'image occlusion import',
  "import { emptyCard } from './defaults.js';\n",
  "import { emptyCard } from './defaults.js';\nimport { legacyMasksFromJson, parseNativeOcclusions } from './image-occlusion.js';\n"
);

await replaceBetween(
  'src/anki/templates.ts',
  'native image occlusion card generation',
  "  if (noteType.kind === 'image-occlusion') {",
  "  const generated: StudyCard[] = [];",
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
      const key = template.id + ':c' + group.ordinal;
      const existing = byTemplate.get(key) ?? byTemplate.get(template.id + ':mask:' + active.id);
      const base = makeCard(note, noteType, deck, template, key, positionBase + offset, existing);
      const hideAll = group.masks.some((mask) => mask.occludeInactive);
      output.push({
        ...base,
        question: header ? header + '<div class="io-prompt">画像の隠された部分を答えてください。</div>' : '画像の隠された部分を答えてください。',
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

`
);

await replaceOnce('src/anki/anki-package.ts', 'modern image occlusion stock kind', "originalStockKind===6?'cloze'", "originalStockKind===6?'image-occlusion'");
await replaceOnce('src/anki/anki-package.ts', 'legacy package image occlusion model kind', "type:type.kind==='cloze'?1:0", "type:(type.kind==='cloze'||type.kind==='image-occlusion')?1:0");

await replaceOnce(
  'src/anki/defaults.ts',
  'native image occlusion fields',
`      'Image Occlusion',
      ['Image', 'Masks', 'Extra'],
      [{ id: 'template_image_occlusion', name: 'Image Occlusion', front: '{{Image}}', back: '{{Image}}<hr id="answer">{{Extra}}' }],
      'image-occlusion'
`,
`      'Image Occlusion',
      ['Occlusions', 'Image', 'Header', 'Back Extra', 'Comments'],
      [{ id: 'template_image_occlusion', name: 'Image Occlusion', front: '{{#Header}}{{Header}}<br>{{/Header}}{{Image}}', back: '{{FrontSide}}<hr id="answer">{{Back Extra}}{{Comments}}' }],
      'image-occlusion'
`
);

await replaceBetween(
  'src/review/controller.ts',
  'shape-aware image occlusion reviewer',
  ' private renderImageOcclusion(card:StudyCard,reveal:boolean){',
  ' private updateRatingPreviews',
` private renderImageOcclusion(card:StudyCard,reveal:boolean){
  const data=card.imageOcclusion;
  if(!data){this.elements.io.hidden=true;return}
  this.elements.io.hidden=false;
  const stage=document.createElement('div');stage.className='review-io-stage';
  const img=document.createElement('img');img.src=data.imageDataUrl;img.alt='Image Occlusion';stage.append(img);
  if(!reveal){
   const masks=data.masks?.length?data.masks:[data.mask];
   for(const mask of masks){
    const node=document.createElement('div');
    const shape=mask.shape??'rect';
    node.className='review-io-mask shape-'+shape+(mask.occludeInactive?' is-inactive':'');
    if(shape==='polygon'&&mask.points?.length){
     Object.assign(node.style,{left:'0',top:'0',width:'100%',height:'100%',clipPath:'polygon('+mask.points.map((point)=>point.x+'% '+point.y+'%').join(',')+')'});
    }else{
     Object.assign(node.style,{left:mask.x+'%',top:mask.y+'%',width:mask.width+'%',height:mask.height+'%'});
     if(shape==='ellipse')node.style.borderRadius='50%';
    }
    if(mask.angle)node.style.transform='rotate('+mask.angle+'deg)';
    stage.append(node);
   }
  }
  this.elements.io.replaceChildren(stage)
 }
`
);

console.log('Anki compatibility patches applied.');
// trigger-v2
