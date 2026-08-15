import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImageOcclusionShape, parseNativeOcclusions, serializeImageOcclusionShape, serializeNativeOcclusions } from '../dist/assets/anki/image-occlusion.js';

test('parses Anki rectangle image occlusion coordinates', () => {
  const mask = parseImageOcclusionShape('rect:left=.2:top=.3:width=.4:height=.1');
  assert.equal(mask?.shape, 'rect');
  assert.equal(mask?.x, 20);
  assert.equal(mask?.y, 30);
  assert.equal(mask?.width, 40);
  assert.equal(mask?.height, 10);
});

test('parses Anki ellipse and polygon shapes', () => {
  const ellipse = parseImageOcclusionShape('ellipse:left=.1:top=.2:width=.3:height=.4');
  assert.equal(ellipse?.shape, 'ellipse');
  const polygon = parseImageOcclusionShape('polygon:points=.1,.1 .5,.2 .2,.8');
  assert.equal(polygon?.shape, 'polygon');
  assert.equal(polygon?.points?.length, 3);
  assert.equal(Math.round(polygon?.width ?? 0), 40);
});

test('reads native image-occlusion clozes grouped by ordinal', () => {
  const value = '{{c1::image-occlusion:rect:left=.1:top=.2:width=.2:height=.1}}{{c2::image-occlusion:ellipse:left=.4:top=.3:width=.2:height=.2}}';
  const groups = parseNativeOcclusions(value);
  assert.deepEqual(groups.map((group) => group.ordinal), [1, 2]);
  assert.equal(groups[0].masks[0].shape, 'rect');
  assert.equal(groups[1].masks[0].shape, 'ellipse');
});

test('serializes native occlusion syntax and Hide All inactive masks', () => {
  const masks = [
    { id: 'a', shape: 'rect', x: 10, y: 20, width: 30, height: 10, answer: '' },
    { id: 'b', shape: 'ellipse', x: 50, y: 20, width: 20, height: 20, answer: '' }
  ];
  assert.match(serializeImageOcclusionShape(masks[0]), /^rect:left=0\.1:top=0\.2:width=0\.3:height=0\.1$/);
  const value = serializeNativeOcclusions(masks, 'hide-all-guess-one');
  assert.match(value, /\{\{c1::image-occlusion:rect:/);
  assert.match(value, /\{\{c0::image-occlusion:ellipse:.*oi=1/);
});
