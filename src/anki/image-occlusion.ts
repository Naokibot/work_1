import type { ImageOcclusionMask } from '../types.js';
import { uid } from '../utils/core.js';

export interface NativeOcclusionGroup {
  ordinal: number;
  masks: ImageOcclusionMask[];
}

function unescapeProperty(value: string): string {
  return value.replace(/\\([\\:])/g, '$1');
}

function splitProperties(value: string): string[] {
  const parts: string[] = [];
  let buffer = '';
  let escaped = false;
  for (const char of value) {
    if (escaped) { buffer += `\\${char}`; escaped = false; continue; }
    if (char === '\\') { escaped = true; continue; }
    if (char === ':') { parts.push(buffer); buffer = ''; continue; }
    buffer += char;
  }
  if (escaped) buffer += '\\';
  parts.push(buffer);
  return parts;
}

function coord(value: string | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.abs(numeric) <= 1.5 ? numeric * 100 : numeric;
}

function parsePoints(value: string | undefined): Array<{ x: number; y: number }> {
  return (value ?? '').trim().split(/\s+/).flatMap((pair) => {
    const [xRaw, yRaw] = pair.split(',');
    const x = coord(xRaw), y = coord(yRaw);
    return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
  });
}

function bounds(points: Array<{ x: number; y: number }>): { x: number; y: number; width: number; height: number } {
  if (!points.length) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
  const left = Math.min(...xs), top = Math.min(...ys), right = Math.max(...xs), bottom = Math.max(...ys);
  return { x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

export function parseImageOcclusionShape(value: string): ImageOcclusionMask | null {
  const [shapeRaw, ...propertyParts] = splitProperties(value);
  const shape = shapeRaw === 'ellipse' || shapeRaw === 'polygon' || shapeRaw === 'text' ? shapeRaw : shapeRaw === 'rect' ? 'rect' : null;
  if (!shape) return null;
  const properties = new Map<string, string>();
  for (const part of propertyParts) {
    const split = part.indexOf('=');
    if (split < 1) continue;
    properties.set(part.slice(0, split), unescapeProperty(part.slice(split + 1)));
  }
  const points = shape === 'polygon' ? parsePoints(properties.get('points')) : undefined;
  const box = points?.length ? bounds(points) : {
    x: coord(properties.get('left')),
    y: coord(properties.get('top')),
    width: coord(properties.get('width')),
    height: coord(properties.get('height'))
  };
  return {
    id: uid('io'),
    shape,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    points,
    angle: Number(properties.get('angle') ?? 0) || 0,
    fill: properties.get('fill') || undefined,
    text: properties.get('text') || undefined,
    answer: properties.get('text') || '',
    occludeInactive: properties.get('oi') === '1' || properties.get('oi') === 'true'
  };
}

export function parseNativeOcclusions(value: string): NativeOcclusionGroup[] {
  const groups = new Map<number, ImageOcclusionMask[]>();
  const pattern = /\{\{c([\d,]+)::image-occlusion:((?:\\.|[^}])*)\}\}/g;
  for (const match of value.matchAll(pattern)) {
    const mask = parseImageOcclusionShape(match[2] ?? '');
    if (!mask) continue;
    const ordinals = (match[1] ?? '').split(',').map(Number).filter((ordinal) => Number.isInteger(ordinal) && ordinal >= 0);
    for (const ordinal of ordinals) {
      const list = groups.get(ordinal) ?? [];
      list.push({ ...mask, id: uid(`io${ordinal}`) }); groups.set(ordinal, list);
    }
  }
  return [...groups.entries()].filter(([ordinal]) => ordinal > 0).sort(([a], [b]) => a - b).map(([ordinal, masks]) => ({ ordinal, masks }));
}

function normalized(value: number): string {
  const result = Math.abs(value) > 1.5 ? value / 100 : value;
  return Number(result.toFixed(5)).toString();
}
function escapeProperty(value: string): string { return value.replace(/\\/g, '\\\\').replace(/:/g, '\\:'); }

export function serializeImageOcclusionShape(mask: ImageOcclusionMask): string {
  const shape = mask.shape ?? 'rect';
  const properties: string[] = [];
  if (shape === 'polygon' && mask.points?.length) properties.push(`points=${mask.points.map((point) => `${normalized(point.x)},${normalized(point.y)}`).join(' ')}`);
  else {
    properties.push(`left=${normalized(mask.x)}`, `top=${normalized(mask.y)}`, `width=${normalized(mask.width)}`, `height=${normalized(mask.height)}`);
  }
  if (mask.angle) properties.push(`angle=${normalized(mask.angle)}`);
  if (mask.fill) properties.push(`fill=${escapeProperty(mask.fill)}`);
  if (mask.occludeInactive) properties.push('oi=1');
  if (shape === 'text' && (mask.text || mask.answer)) properties.push(`text=${escapeProperty(mask.text || mask.answer)}`);
  return `${shape}:${properties.join(':')}`;
}

export function serializeNativeOcclusions(masks: ImageOcclusionMask[], mode: 'hide-all-guess-one' | 'hide-one-guess-one' = 'hide-all-guess-one'): string {
  return masks.map((mask, index) => {
    const ordinal = index + 1;
    const active = `{{c${ordinal}::image-occlusion:${serializeImageOcclusionShape(mask)}}}`;
    if (mode === 'hide-one-guess-one') return active;
    const inactive = masks.filter((_, other) => other !== index).map((other) => `{{c0::image-occlusion:${serializeImageOcclusionShape({ ...other, occludeInactive: true })}}}`).join('');
    return `${active}${inactive}`;
  }).join('');
}

export function legacyMasksFromJson(value: string): ImageOcclusionMask[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Record<string, unknown>;
      const x = Number(item.x), y = Number(item.y), width = Number(item.width), height = Number(item.height);
      if (![x, y, width, height].every(Number.isFinite)) return [];
      return [{ id: String(item.id ?? uid('io')), shape: 'rect' as const, x, y, width, height, answer: String(item.answer ?? '') }];
    });
  } catch { return []; }
}
