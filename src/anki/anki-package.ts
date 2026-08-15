import type {
  AnkiState,
  CardFlag,
  CardQueue,
  DeckDefinition,
  FieldDefinition,
  NoteTypeDefinition,
  ReviewHistory,
  Rating,
  StudyCard,
  StudyNote
} from '../types.js';
import { defaultPreset, normalizeAnkiState } from './defaults.js';
import { generateCardsForNote, stripHtml } from './templates.js';
import { getAnkiState, getCards, getHistory, saveAnkiState, saveCards, saveHistory } from '../storage/db.js';
import { clamp, nowIso, uid } from '../utils/core.js';

interface ProtoField {
  wire: number;
  value: number | Uint8Array;
}

type ProtoMap = Map<number, ProtoField[]>;

interface PackageMedia {
  name: string;
  bytes: Uint8Array;
}

interface ImportResult {
  notes: number;
  cards: number;
  history: number;
  decks: number;
  noteTypes: number;
  media: number;
  format: 'legacy' | 'latest';
}

interface LegacyModel {
  id?: number;
  name?: string;
  type?: number;
  css?: string;
  flds?: Array<{ name?: string; rtl?: boolean; sticky?: boolean; font?: string; size?: number }>;
  tmpls?: Array<{ name?: string; qfmt?: string; afmt?: string; did?: number | null }>;
}

interface LegacyDeck {
  id?: number;
  name?: string;
  desc?: string;
  conf?: number;
  dyn?: number;
}

interface SourceNoteType {
  sourceId: string;
  local: NoteTypeDefinition;
  fieldNames: string[];
}

interface SourceDeck {
  sourceId: string;
  local: DeckDefinition;
}

interface SqlRow { [key: string]: unknown }

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
let sqlRuntimePromise: Promise<SqlJsRuntime> | null = null;

function sqlRuntime(): Promise<SqlJsRuntime> {
  if (!sqlRuntimePromise) {
    sqlRuntimePromise = initSqlJs({
      locateFile: (file) => new URL(`../../vendor/${file}`, import.meta.url).href
    });
  }
  return sqlRuntimePromise;
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let cursor = offset;
  while (cursor < bytes.length && shift <= 49) {
    const byte = bytes[cursor++] ?? 0;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: cursor };
    shift += 7;
  }
  throw new Error('Invalid protobuf varint');
}

function protoDecode(bytes: Uint8Array): ProtoMap {
  const fields: ProtoMap = new Map();
  let offset = 0;
  while (offset < bytes.length) {
    const key = readVarint(bytes, offset); offset = key.next;
    const fieldNumber = Math.floor(key.value / 8), wire = key.value & 7;
    let value: number | Uint8Array;
    if (wire === 0) {
      const item = readVarint(bytes, offset); value = item.value; offset = item.next;
    } else if (wire === 1) {
      if (offset + 8 > bytes.length) throw new Error('Invalid protobuf fixed64');
      value = bytes.slice(offset, offset + 8); offset += 8;
    } else if (wire === 2) {
      const length = readVarint(bytes, offset); offset = length.next;
      const end = offset + length.value;
      if (end > bytes.length) throw new Error('Invalid protobuf length-delimited value');
      value = bytes.slice(offset, end); offset = end;
    } else if (wire === 5) {
      if (offset + 4 > bytes.length) throw new Error('Invalid protobuf fixed32');
      value = bytes.slice(offset, offset + 4); offset += 4;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wire}`);
    }
    const list = fields.get(fieldNumber) ?? [];
    list.push({ wire, value }); fields.set(fieldNumber, list);
  }
  return fields;
}

function protoBytes(map: ProtoMap, field: number, index = 0): Uint8Array | undefined {
  const value = map.get(field)?.[index]?.value;
  return value instanceof Uint8Array ? value : undefined;
}
function protoNumber(map: ProtoMap, field: number, fallback = 0): number {
  const value = map.get(field)?.[0]?.value;
  return typeof value === 'number' ? value : fallback;
}
function protoString(map: ProtoMap, field: number, fallback = ''): string {
  const value = protoBytes(map, field);
  return value ? textDecoder.decode(value) : fallback;
}
function protoMessages(map: ProtoMap, field: number): ProtoMap[] {
  return (map.get(field) ?? []).flatMap((item) => item.value instanceof Uint8Array ? [protoDecode(item.value)] : []);
}

function rows(db: SqlDatabase, sql: string): SqlRow[] {
  const statement = db.prepare(sql);
  const out: SqlRow[] = [];
  try {
    while (statement.step()) out.push(statement.getAsObject());
  } finally { statement.free(); }
  return out;
}

function tableExists(db: SqlDatabase, table: string): boolean {
  const statement = db.prepare("select 1 from sqlite_master where type='table' and name=? limit 1");
  try { statement.bind([table]); return statement.step(); } finally { statement.free(); }
}

function asNumber(value: unknown, fallback = 0): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function asString(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : value == null ? fallback : String(value); }
function asBytes(value: unknown): Uint8Array { return value instanceof Uint8Array ? value : new Uint8Array(); }
function isoFromSeconds(value: number, fallback = nowIso()): string {
  const date = new Date(value * 1000); return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}
function isoFromMillis(value: number, fallback = nowIso()): string {
  const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
}
function sourceId(prefix: string, value: unknown): string { return `anki_${prefix}_${asString(value).replace(/[^0-9A-Za-z_.-]/g, '_')}`; }

function parseTags(raw: string): string[] {
  return [...new Set(raw.trim().split(/\s+/u).map((value) => value.trim()).filter(Boolean))];
}

function mimeForName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
    mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac', opus: 'audio/ogg',
    mp4: 'video/mp4', webm: 'video/webm'
  };
  return map[ext] ?? 'application/octet-stream';
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  return `data:${mime};base64,${btoa(binary)}`;
}

function dataUrlToBytes(url: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
  if (!match) return null;
  const mime = match[1] || 'application/octet-stream';
  try {
    if (match[2]) {
      const binary = atob(match[3] ?? '');
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return { mime, bytes };
    }
    return { mime, bytes: textEncoder.encode(decodeURIComponent(match[3] ?? '')) };
  } catch { return null; }
}

function enrichMedia(value: string, media: Map<string, PackageMedia>): string {
  let output = value.replace(/(<(?:img|audio|video)\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi, (_m, prefix: string, name: string, suffix: string) => {
    const entry = media.get(decodeURIComponent(name));
    return entry ? `${prefix}${bytesToDataUrl(entry.bytes, mimeForName(entry.name))}${suffix}` : `${prefix}${name}${suffix}`;
  });
  output = output.replace(/\[sound:([^\]]+)]/gi, (_m, name: string) => {
    const entry = media.get(name);
    return entry ? `<audio controls preload="none" src="${bytesToDataUrl(entry.bytes, mimeForName(entry.name))}"></audio>` : `[sound:${name}]`;
  });
  return output;
}

function decodeLatestMedia(entries: Record<string, Uint8Array>): Map<string, PackageMedia> {
  const result = new Map<string, PackageMedia>();
  const mediaFile = entries.media;
  if (!mediaFile) return result;
  let decoded: Uint8Array;
  try { decoded = fzstd.decompress(mediaFile); } catch { decoded = mediaFile; }
  const container = protoDecode(decoded);
  protoMessages(container, 1).forEach((entry, index) => {
    const name = protoString(entry, 1);
    if (!name) return;
    const zipIndex = protoNumber(entry, 255, index);
    const archived = entries[String(zipIndex)];
    if (!archived) return;
    let bytes: Uint8Array;
    try { bytes = fzstd.decompress(archived); } catch { bytes = archived; }
    result.set(name, { name, bytes });
  });
  return result;
}

function decodeLegacyMedia(entries: Record<string, Uint8Array>): Map<string, PackageMedia> {
  const result = new Map<string, PackageMedia>();
  if (!entries.media) return result;
  try {
    const mapping = JSON.parse(textDecoder.decode(entries.media)) as Record<string, string>;
    for (const [zipName, actualName] of Object.entries(mapping)) {
      const bytes = entries[zipName];
      if (bytes && actualName) result.set(actualName, { name: actualName, bytes });
    }
  } catch { /* malformed maps are ignored like missing media */ }
  return result;
}

function decodeModernNotetypes(db: SqlDatabase, profileId: string): SourceNoteType[] {
  const now = nowIso();
  const fieldRows = rows(db, 'select ntid, ord, name, config from fields order by ntid, ord');
  const templateRows = rows(db, 'select ntid, ord, name, config from templates order by ntid, ord');
  return rows(db, 'select id, name, mtime_secs, config from notetypes order by id').map((row) => {
    const source = asString(row.id);
    const config = protoDecode(asBytes(row.config));
    const originalStockKind = protoNumber(config, 9, 0);
    const kind: NoteTypeDefinition['kind'] = originalStockKind === 6 ? 'cloze' : protoNumber(config, 1, 0) === 1 ? 'cloze' : 'standard';
    const fields: FieldDefinition[] = fieldRows.filter((field) => asString(field.ntid) === source).map((field) => {
      const cfg = protoDecode(asBytes(field.config));
      return {
        id: sourceId('field', `${source}_${asNumber(field.ord)}`),
        name: asString(field.name, `Field ${asNumber(field.ord) + 1}`),
        sticky: Boolean(protoNumber(cfg, 1)),
        rtl: Boolean(protoNumber(cfg, 2)),
        font: protoString(cfg, 3) || undefined,
        fontSize: protoNumber(cfg, 4) || undefined
      };
    });
    const templates = templateRows.filter((template) => asString(template.ntid) === source).map((template) => {
      const cfg = protoDecode(asBytes(template.config));
      return {
        id: sourceId('template', `${source}_${asNumber(template.ord)}`),
        name: asString(template.name, `Card ${asNumber(template.ord) + 1}`),
        front: protoString(cfg, 1),
        back: protoString(cfg, 2),
        deckOverrideId: protoNumber(cfg, 5) > 0 ? sourceId('deck', protoNumber(cfg, 5)) : undefined
      };
    });
    const updated = isoFromSeconds(asNumber(row.mtime_secs), now);
    return {
      sourceId: source,
      fieldNames: fields.map((field) => field.name),
      local: {
        id: sourceId('notetype', source),
        name: asString(row.name, 'Imported Note Type'),
        kind,
        fields,
        templates,
        css: protoString(config, 3),
        builtin: false,
        createdAt: updated,
        updatedAt: updated
      }
    };
  }).filter((item) => item.local.fields.length > 0 && item.local.templates.length > 0);
}

function decodeLegacyNotetypes(db: SqlDatabase): SourceNoteType[] {
  const col = rows(db, 'select models from col limit 1')[0];
  let models: Record<string, LegacyModel> = {};
  try { models = JSON.parse(asString(col?.models, '{}')) as Record<string, LegacyModel>; } catch { /* keep empty */ }
  const now = nowIso();
  return Object.entries(models).map(([key, model]) => {
    const source = String(model.id ?? key);
    const fields: FieldDefinition[] = (model.flds ?? []).map((field, index) => ({
      id: sourceId('field', `${source}_${index}`), name: field.name || `Field ${index + 1}`, rtl: Boolean(field.rtl), sticky: Boolean(field.sticky), font: field.font, fontSize: field.size
    }));
    return {
      sourceId: source,
      fieldNames: fields.map((field) => field.name),
      local: {
        id: sourceId('notetype', source),
        name: model.name || 'Imported Note Type',
        kind: model.type === 1 ? 'cloze' : 'standard',
        fields,
        templates: (model.tmpls ?? []).map((template, index) => ({
          id: sourceId('template', `${source}_${index}`), name: template.name || `Card ${index + 1}`, front: template.qfmt ?? '', back: template.afmt ?? '',
          deckOverrideId: template.did ? sourceId('deck', template.did) : undefined
        })),
        css: model.css ?? '', builtin: false, createdAt: now, updatedAt: now
      }
    };
  }).filter((item) => item.local.fields.length > 0 && item.local.templates.length > 0);
}

function decodeModernDecks(db: SqlDatabase, profileId: string): SourceDeck[] {
  const now = nowIso();
  return rows(db, 'select id, name, mtime_secs, kind from decks order by name').map((row) => {
    const source = asString(row.id);
    const kind = protoDecode(asBytes(row.kind));
    const normal = protoBytes(kind, 1);
    const normalCfg = normal ? protoDecode(normal) : new Map<number, ProtoField[]>();
    const updated = isoFromSeconds(asNumber(row.mtime_secs), now);
    return {
      sourceId: source,
      local: {
        id: sourceId('deck', source), profileId, name: asString(row.name, 'Imported'), description: protoString(normalCfg, 4),
        presetId: 'preset_default', createdAt: updated, updatedAt: updated
      }
    };
  });
}

function decodeLegacyDecks(db: SqlDatabase, profileId: string): SourceDeck[] {
  const col = rows(db, 'select decks from col limit 1')[0];
  let decks: Record<string, LegacyDeck> = {};
  try { decks = JSON.parse(asString(col?.decks, '{}')) as Record<string, LegacyDeck>; } catch { /* keep empty */ }
  const now = nowIso();
  return Object.entries(decks).map(([key, deck]) => {
    const source = String(deck.id ?? key);
    return { sourceId: source, local: { id: sourceId('deck', source), profileId, name: deck.name || 'Imported', description: deck.desc ?? '', presetId: 'preset_default', createdAt: now, updatedAt: now } };
  });
}

function queueFromAnki(queue: number, type: number): { queue: CardQueue; suspended: boolean; buried: boolean } {
  if (queue === -1) return { queue: type === 0 ? 'new' : 'review', suspended: true, buried: false };
  if (queue === -2 || queue === -3) return { queue: type === 0 ? 'new' : 'review', suspended: false, buried: true };
  if (queue === 0 || type === 0) return { queue: 'new', suspended: false, buried: false };
  if (queue === 1 || queue === 3 || type === 1 || type === 3) return { queue: type === 3 || queue === 3 ? 'relearning' : 'learning', suspended: false, buried: false };
  return { queue: 'review', suspended: false, buried: false };
}

function dueIso(queue: number, type: number, due: number, creationSeconds: number): string {
  if (queue === 1 || type === 1) return isoFromSeconds(due);
  if (queue === 2 || queue === 3 || type === 2 || type === 3) return isoFromSeconds(creationSeconds + Math.max(0, due) * 86400);
  return nowIso();
}

function ratingFromEase(value: number): Rating { return value <= 1 ? 'again' : value === 2 ? 'hard' : value === 3 ? 'good' : 'easy'; }

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const map = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

function mapNoteFields(fieldNames: string[], raw: string, media: Map<string, PackageMedia>): Record<string, string> {
  const values = raw.split('\x1f');
  return Object.fromEntries(fieldNames.map((name, index) => [name, enrichMedia(values[index] ?? '', media)]));
}

function countStats(history: ReviewHistory[], cardId: string): StudyCard['stats'] {
  const items = history.filter((entry) => entry.cardId === cardId);
  const times = items.map((entry) => entry.responseMs).filter((value) => Number.isFinite(value) && value >= 0);
  return {
    correct: items.filter((entry) => entry.isCorrect).length,
    incorrect: items.filter((entry) => !entry.isCorrect).length,
    totalTimeMs: times.reduce((sum, value) => sum + value, 0),
    fastestMs: times.length ? Math.min(...times) : null,
    lastTimesMs: times.slice(-20)
  };
}

export async function importAnkiPackage(file: File): Promise<ImportResult> {
  if (file.size > 500 * 1024 * 1024) throw new Error('Ankiパッケージが500MBを超えています。');
  const zip = fflate.unzipSync(new Uint8Array(await file.arrayBuffer()));
  const latest = Boolean(zip['collection.21b']);
  const collectionBytes = latest ? fzstd.decompress(zip['collection.21b'] as Uint8Array) : (zip['collection.anki21'] ?? zip['collection.anki2']);
  if (!collectionBytes) throw new Error('Ankiコレクションがパッケージ内に見つかりません。');
  const media = latest ? decodeLatestMedia(zip) : decodeLegacyMedia(zip);
  const SQL = await sqlRuntime();
  const db = new SQL.Database(collectionBytes);
  try {
    if (!tableExists(db, 'notes') || !tableExists(db, 'cards')) throw new Error('有効なAnkiコレクションではありません。');
    const existingState = await getAnkiState();
    const profileId = existingState.activeProfileId;
    const modern = tableExists(db, 'notetypes') && tableExists(db, 'fields') && tableExists(db, 'templates');
    const noteTypes = modern ? decodeModernNotetypes(db, profileId) : decodeLegacyNotetypes(db);
    const decks = modern && tableExists(db, 'decks') ? decodeModernDecks(db, profileId) : decodeLegacyDecks(db, profileId);
    const noteTypeMap = new Map(noteTypes.map((item) => [item.sourceId, item]));
    const deckMap = new Map(decks.map((item) => [item.sourceId, item.local.id]));
    const defaultDeck = decks[0]?.local.id ?? existingState.decks.find((item) => item.profileId === profileId)?.id ?? 'deck_default';
    const created = tableExists(db, 'col') ? asNumber(rows(db, 'select crt from col limit 1')[0]?.crt, Math.floor(Date.now() / 1000)) : Math.floor(Date.now() / 1000);

    const importedNotes: StudyNote[] = rows(db, 'select id, guid, mid, mod, tags, flds from notes').flatMap((row) => {
      const sourceType = noteTypeMap.get(asString(row.mid));
      if (!sourceType) return [];
      const updated = isoFromSeconds(asNumber(row.mod));
      return [{
        id: sourceId('note', row.id), guid: asString(row.guid, sourceId('guid', row.id)), profileId, deckId: defaultDeck,
        noteTypeId: sourceType.local.id, fields: mapNoteFields(sourceType.fieldNames, asString(row.flds), media), tags: parseTags(asString(row.tags)),
        createdAt: isoFromMillis(asNumber(row.id), updated), updatedAt: updated, deletedAt: null
      }];
    });
    const importedNoteMap = new Map(importedNotes.map((note) => [note.id, note]));

    const cardRows = rows(db, "select id,nid,did,ord,mod,type,queue,due,ivl,factor,reps,lapses,left,odue,odid,flags,data from cards");
    for (const row of cardRows) {
      const note = importedNoteMap.get(sourceId('note', row.nid));
      if (note) note.deckId = deckMap.get(asString(asNumber(row.odid) > 0 ? row.odid : row.did)) ?? note.deckId;
    }

    const importedHistory: ReviewHistory[] = tableExists(db, 'revlog') ? rows(db, 'select id,cid,ease,ivl,lastIvl,factor,time,type from revlog').map((row) => {
      const ease = asNumber(row.ease, 3), cardId = sourceId('card', row.cid), reviewedAt = isoFromMillis(asNumber(row.id));
      return { id: sourceId('rev', row.id), cardId, questionSnapshot: '', tags: [], rating: ratingFromEase(ease), isCorrect: ease > 1, responseMs: Math.max(0, asNumber(row.time)), reviewedAt, nextDue: reviewedAt, device: 'Anki import', requestId: sourceId('req', row.id) };
    }) : [];

    const stateForRender: AnkiState = normalizeAnkiState({
      ...existingState,
      decks: mergeById(existingState.decks, decks.map((item) => item.local)),
      noteTypes: mergeById(existingState.noteTypes, noteTypes.map((item) => item.local)),
      notes: mergeById(existingState.notes, importedNotes)
    });

    const importedCards: StudyCard[] = cardRows.flatMap((row) => {
      const note = importedNoteMap.get(sourceId('note', row.nid));
      if (!note) return [];
      const noteType = stateForRender.noteTypes.find((item) => item.id === note.noteTypeId);
      const deck = stateForRender.decks.find((item) => item.id === note.deckId);
      if (!noteType || !deck) return [];
      const generated = generateCardsForNote(note, stateForRender);
      const ordinal = Math.max(0, asNumber(row.ord));
      const rendered = noteType.kind === 'cloze' ? (generated.find((card) => card.templateId?.endsWith(`:c${ordinal + 1}`)) ?? generated[ordinal] ?? generated[0]) : (generated[ordinal] ?? generated[0]);
      if (!rendered) return [];
      const queue = queueFromAnki(asNumber(row.queue), asNumber(row.type));
      let data: Record<string, unknown> = {};
      try { data = JSON.parse(asString(row.data, '{}')) as Record<string, unknown>; } catch { /* ignore */ }
      const stability = Math.max(0.01, asNumber(data.s, Math.max(0.01, asNumber(row.ivl, 1))));
      const difficulty = clamp(asNumber(data.d, 11 - asNumber(row.factor, 2500) / 250), 1, 10);
      const lastReviewSeconds = asNumber(data.lrt, 0);
      const cardId = sourceId('card', row.id);
      const updated = isoFromSeconds(asNumber(row.mod), rendered.updatedAt);
      return [{
        ...rendered,
        id: cardId,
        deckId: note.deckId,
        noteId: note.id,
        noteTypeId: noteType.id,
        templateId: noteType.kind === 'cloze' ? rendered.templateId : noteType.templates[ordinal]?.id ?? rendered.templateId,
        queue: queue.queue,
        suspended: queue.suspended,
        buriedUntil: queue.buried ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null,
        flag: (asNumber(row.flags) & 7) as CardFlag,
        position: queue.queue === 'new' ? asNumber(row.due) : rendered.position,
        originalDeckId: asNumber(row.odid) > 0 ? deckMap.get(asString(row.odid)) : undefined,
        createdAt: isoFromMillis(asNumber(row.id), rendered.createdAt), updatedAt: updated,
        schedule: {
          stability,
          difficulty,
          due: dueIso(asNumber(row.queue), asNumber(row.type), asNumber(row.due), created),
          reps: Math.max(0, asNumber(row.reps)),
          lapses: Math.max(0, asNumber(row.lapses)),
          streak: 0,
          lastReview: lastReviewSeconds > 0 ? isoFromSeconds(lastReviewSeconds) : null,
          learningStep: queue.queue === 'learning' || queue.queue === 'relearning' ? Math.max(0, asNumber(row.left) % 1000) : null,
          relearning: queue.queue === 'relearning'
        },
        customData: { ...(rendered.customData ?? {}), ankiCardId: asString(row.id), ankiData: asString(row.data) },
        stats: countStats(importedHistory, cardId),
        version: 1
      }];
    });

    const cardMap = new Map(importedCards.map((card) => [card.id, card]));
    for (const history of importedHistory) {
      const card = cardMap.get(history.cardId);
      if (card) { history.questionSnapshot = stripHtml(card.question); history.tags = [...card.tags]; history.nextDue = card.schedule.due; }
    }

    await saveAnkiState(stateForRender);
    await saveCards(mergeById(await getCards(true, true), importedCards));
    const existingHistory = await getHistory();
    for (const item of mergeById(existingHistory, importedHistory)) await saveHistory(item);

    return { notes: importedNotes.length, cards: importedCards.length, history: importedHistory.length, decks: decks.length, noteTypes: noteTypes.length, media: media.size, format: latest ? 'latest' : 'legacy' };
  } finally { db.close(); }
}

function numericIds(values: string[], start = Date.now()): Map<string, number> {
  const unique = [...new Set(values)];
  return new Map(unique.map((value, index) => [value, start + index + 1]));
}

function unixSeconds(iso: string | null | undefined, fallback = Math.floor(Date.now() / 1000)): number {
  if (!iso) return fallback;
  const value = new Date(iso).getTime(); return Number.isFinite(value) ? Math.floor(value / 1000) : fallback;
}

async function checksum(value: string): Promise<number> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', textEncoder.encode(stripHtml(value))));
  return Number.parseInt([...hash.slice(0, 4)].map((byte) => byte.toString(16).padStart(2, '0')).join(''), 16) >>> 0;
}

function sqlValue(value: unknown): string | number | Uint8Array | null {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'number' || value instanceof Uint8Array) return value;
  return String(value);
}

function insert(db: SqlDatabase, sql: string, values: unknown[]): void { db.run(sql, values.map(sqlValue)); }

function sanitizeFilename(value: string): string {
  const cleaned = value.normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 180);
  return cleaned || `media-${uid('file')}`;
}

function extensionForMime(mime: string): string {
  const map: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'video/webm': 'webm' };
  return map[mime] ?? 'bin';
}

function extractEmbeddedMedia(value: string, media: Map<string, Uint8Array>): string {
  let sequence = media.size;
  let output = value.replace(/(<(?:img|video)\b[^>]*?\bsrc\s*=\s*["'])(data:[^"']+)(["'][^>]*>)/gi, (_match, prefix: string, url: string, suffix: string) => {
    const decoded = dataUrlToBytes(url); if (!decoded) return `${prefix}${url}${suffix}`;
    const name = sanitizeFilename(`media-${++sequence}.${extensionForMime(decoded.mime)}`); media.set(name, decoded.bytes); return `${prefix}${name}${suffix}`;
  });
  output = output.replace(/<audio\b[^>]*?\bsrc\s*=\s*["'](data:[^"']+)["'][^>]*>(?:<\/audio>)?/gi, (_match, url: string) => {
    const decoded = dataUrlToBytes(url); if (!decoded) return '';
    const name = sanitizeFilename(`audio-${++sequence}.${extensionForMime(decoded.mime)}`); media.set(name, decoded.bytes); return `[sound:${name}]`;
  });
  return output;
}

export async function exportAnkiPackage(): Promise<void> {
  const [state, allCards, history] = await Promise.all([getAnkiState(), getCards(false, true), getHistory()]);
  const profileId = state.activeProfileId;
  const notes = state.notes.filter((note) => note.profileId === profileId && !note.deletedAt);
  const noteIds = new Set(notes.map((note) => note.id));
  const cards = allCards.filter((card) => (card.profileId ?? profileId) === profileId && !card.deletedAt && noteIds.has(card.noteId ?? ''));
  const noteTypes = state.noteTypes.filter((type) => notes.some((note) => note.noteTypeId === type.id));
  const decks = state.decks.filter((deck) => deck.profileId === profileId);
  const SQL = await sqlRuntime();
  const db = new SQL.Database();
  const nowSeconds = Math.floor(Date.now() / 1000), creationSeconds = nowSeconds - (nowSeconds % 86400);
  db.run(`
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn on notes (usn); CREATE INDEX ix_cards_usn on cards (usn); CREATE INDEX ix_cards_nid on cards (nid); CREATE INDEX ix_revlog_usn on revlog (usn); CREATE INDEX ix_revlog_cid on revlog (cid);
`);

  const noteIdMap = numericIds(notes.map((note) => note.id), Date.now());
  const cardIdMap = numericIds(cards.map((card) => card.id), Date.now() + notes.length + 1000);
  const noteTypeIdMap = numericIds(noteTypes.map((type) => type.id), Date.now() + 2_000_000);
  const deckIdMap = numericIds(decks.map((deck) => deck.id), Date.now() + 3_000_000);
  const media = new Map<string, Uint8Array>();

  const models: Record<string, unknown> = {};
  for (const type of noteTypes) {
    const id = noteTypeIdMap.get(type.id) as number;
    models[String(id)] = {
      id, name: type.name, type: type.kind === 'cloze' ? 1 : 0, mod: nowSeconds, usn: -1, sortf: 0,
      did: null,
      tmpls: type.templates.map((template, ord) => ({ name: template.name, ord, qfmt: template.front, afmt: template.back, did: template.deckOverrideId ? deckIdMap.get(template.deckOverrideId) ?? null : null, bqfmt: '', bafmt: '' })),
      flds: type.fields.map((field, ord) => ({ name: field.name, ord, sticky: Boolean(field.sticky), rtl: Boolean(field.rtl), font: field.font || 'Arial', size: field.fontSize || 20 })),
      css: type.css, latexPre: '', latexPost: '', req: []
    };
  }
  const deckJson: Record<string, unknown> = {};
  for (const deck of decks) {
    const id = deckIdMap.get(deck.id) as number;
    deckJson[String(id)] = { id, name: deck.name, mod: nowSeconds, usn: -1, desc: deck.description, dyn: 0, collapsed: false, browserCollapsed: false, extendNew: 0, extendRev: 0, conf: 1 };
  }
  const dconf = { '1': { id: 1, name: 'Default', mod: nowSeconds, usn: -1, maxTaken: 60, autoplay: true, timer: 0, replayq: true, new: { perDay: 20, delays: [1, 10], ints: [1, 4], initialFactor: 2500, order: 1, bury: true }, rev: { perDay: 200, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, hardFactor: 1.2, bury: true }, lapse: { delays: [10], mult: 0, minInt: 1, leechFails: 8, leechAction: 0 } } };
  insert(db, 'insert into col values (?,?,?,?,?,?,?,?,?,?,?,?,?)', [1, creationSeconds, Date.now(), Date.now(), 11, 0, 0, 0, JSON.stringify({ schedVer: 2 }), JSON.stringify(models), JSON.stringify(deckJson), JSON.stringify(dconf), '{}']);

  for (const note of notes) {
    const type = state.noteTypes.find((item) => item.id === note.noteTypeId); if (!type) continue;
    const id = noteIdMap.get(note.id) as number, mid = noteTypeIdMap.get(type.id) as number;
    const exportedFields = type.fields.map((field) => extractEmbeddedMedia(note.fields[field.name] ?? '', media));
    const first = exportedFields[0] ?? '';
    insert(db, 'insert into notes values (?,?,?,?,?,?,?,?,?,?,?)', [id, note.guid || sourceId('guid', id), mid, unixSeconds(note.updatedAt), -1, note.tags.length ? ` ${note.tags.join(' ')} ` : '', exportedFields.join('\x1f'), stripHtml(first), await checksum(first), 0, '']);
  }

  const today = Math.floor((nowSeconds - creationSeconds) / 86400);
  for (const card of cards) {
    const id = cardIdMap.get(card.id) as number, nid = noteIdMap.get(card.noteId ?? ''); if (!nid) continue;
    const deckId = deckIdMap.get(card.deckId ?? '') ?? deckIdMap.values().next().value ?? 1;
    const noteType = state.noteTypes.find((type) => type.id === card.noteTypeId);
    let ord = noteType?.templates.findIndex((template) => template.id === card.templateId) ?? 0;
    if (noteType?.kind === 'cloze') { const match = /:c(\d+)$/.exec(card.templateId ?? ''); if (match) ord = Math.max(0, Number(match[1]) - 1); }
    let type = 2, queue = 2, due = today, left = 0;
    if (card.suspended) queue = -1;
    else if (card.buriedUntil) queue = -2;
    if ((card.queue ?? 'new') === 'new') { type = 0; if (!card.suspended && !card.buriedUntil) queue = 0; due = Math.max(1, Math.round(card.position ?? id % 1_000_000)); }
    else if (card.queue === 'learning' || card.queue === 'relearning') { type = card.queue === 'relearning' ? 3 : 1; if (!card.suspended && !card.buriedUntil) queue = 1; due = unixSeconds(card.schedule.due); left = Math.max(1, card.schedule.learningStep ?? 1); }
    else { const dueSeconds = unixSeconds(card.schedule.due); due = Math.max(0, Math.floor((dueSeconds - creationSeconds) / 86400)); }
    const ivl = Math.max(1, Math.round(card.schedule.stability));
    const factor = Math.round((11 - clamp(card.schedule.difficulty, 1, 10)) * 250);
    const data = JSON.stringify({ s: Number(card.schedule.stability.toFixed(4)), d: Number(card.schedule.difficulty.toFixed(3)), ...(card.schedule.lastReview ? { lrt: unixSeconds(card.schedule.lastReview) } : {}), ...(Object.keys(card.customData ?? {}).length ? { cd: JSON.stringify(card.customData).slice(0, 100) } : {}) });
    insert(db, 'insert into cards values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, nid, deckId, Math.max(0, ord), unixSeconds(card.updatedAt), -1, type, queue, due, ivl, factor, card.schedule.reps, card.schedule.lapses, left, 0, 0, card.flag ?? 0, data]);
  }

  let revSequence = 0;
  for (const item of history.filter((entry) => cardIdMap.has(entry.cardId))) {
    const cid = cardIdMap.get(item.cardId) as number;
    const idBase = new Date(item.reviewedAt).getTime();
    const id = Number.isFinite(idBase) ? idBase + (revSequence++ % 1000) : Date.now() + revSequence++;
    const ease = item.rating === 'again' ? 1 : item.rating === 'hard' ? 2 : item.rating === 'good' ? 3 : 4;
    const card = cards.find((entry) => entry.id === item.cardId);
    const ivl = Math.max(1, Math.round(card?.schedule.stability ?? 1));
    insert(db, 'insert or replace into revlog values (?,?,?,?,?,?,?,?,?)', [id, cid, -1, ease, ivl, Math.max(1, ivl - 1), 2500, Math.max(0, item.responseMs), 1]);
  }

  const collection = db.export(); db.close();
  const zipEntries: Record<string, Uint8Array> = { 'collection.anki21': collection };
  const mediaMap: Record<string, string> = {};
  let mediaIndex = 0;
  for (const [name, bytes] of media) { const key = String(mediaIndex++); mediaMap[key] = name; zipEntries[key] = bytes; }
  zipEntries.media = textEncoder.encode(JSON.stringify(mediaMap));
  const archive = fflate.zipSync(zipEntries, { level: 6 });
  const url = URL.createObjectURL(new Blob([archive as BlobPart], { type: 'application/octet-stream' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `collection-${new Date().toISOString().slice(0, 10)}.apkg`; document.body.append(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export const __ankiPackageTest = { protoDecode, protoNumber, protoString, protoMessages, decodeLegacyMedia, decodeLatestMedia };
