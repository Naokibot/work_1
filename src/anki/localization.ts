import type { NoteTypeDefinition } from '../types.js';
import {
  BASIC_NOTE_TYPE_ID,
  BASIC_OPTIONAL_REVERSE_NOTE_TYPE_ID,
  BASIC_REVERSE_NOTE_TYPE_ID,
  CLOZE_NOTE_TYPE_ID,
  IMAGE_OCCLUSION_NOTE_TYPE_ID,
  TYPE_ANSWER_NOTE_TYPE_ID
} from './defaults.js';

const BUILTIN_NOTE_TYPE_NAMES: Record<string, string> = {
  [BASIC_NOTE_TYPE_ID]: '基本',
  [BASIC_REVERSE_NOTE_TYPE_ID]: '基本（表裏2枚）',
  [BASIC_OPTIONAL_REVERSE_NOTE_TYPE_ID]: '基本（任意で表裏2枚）',
  [TYPE_ANSWER_NOTE_TYPE_ID]: '基本（解答入力）',
  [CLOZE_NOTE_TYPE_ID]: '穴埋め',
  [IMAGE_OCCLUSION_NOTE_TYPE_ID]: '画像穴埋め'
};

const STOCK_NAME_TRANSLATIONS: Record<string, string> = {
  'Basic': '基本',
  'Basic (and reversed card)': '基本（表裏2枚）',
  'Basic (optional reversed card)': '基本（任意で表裏2枚）',
  'Basic (type in the answer)': '基本（解答入力）',
  'Cloze': '穴埋め',
  'Image Occlusion': '画像穴埋め'
};

const FIELD_TRANSLATIONS: Record<string, string> = {
  Front: '表面',
  Back: '裏面',
  Extra: '補足',
  'Add Reverse': '裏面カードを追加',
  Text: '文章',
  'Back Extra': '裏面の補足',
  Occlusions: 'マスク情報',
  Masks: 'マスク情報',
  Image: '画像',
  Header: '見出し',
  Comments: 'コメント'
};

export function noteTypeDisplayName(type: Pick<NoteTypeDefinition, 'id' | 'name'>): string {
  return BUILTIN_NOTE_TYPE_NAMES[type.id] ?? STOCK_NAME_TRANSLATIONS[type.name] ?? type.name;
}

export function noteFieldDisplayName(name: string): string {
  return FIELD_TRANSLATIONS[name] ?? name;
}

export function noteTypeKindDisplayName(kind: NoteTypeDefinition['kind']): string {
  if (kind === 'cloze') return '穴埋め';
  if (kind === 'image-occlusion') return '画像穴埋め';
  return '標準';
}
