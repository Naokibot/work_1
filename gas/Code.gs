const CONFIG = Object.freeze({
  cardsSheet: 'Cards',
  historySheet: 'History',
  syncSheet: '_SyncLog',
  maxSkewMs: 5 * 60 * 1000,
  maxText: 10000,
  maxRowsPerPull: 10000
});

const CARD_HEADERS = [
  'ID', 'Question', 'Answer', 'Distractor1', 'Distractor2', 'Distractor3', 'Explanation', 'Tags', 'Favorite',
  'CreatedAt', 'UpdatedAt', 'DeletedAt', 'Stability', 'Difficulty', 'DueAt', 'Reps', 'Lapses', 'Streak',
  'CorrectCount', 'IncorrectCount', 'TotalTimeMs', 'FastestMs', 'LastTimesMs', 'LastReviewAt', 'Version', 'LastRequestId', 'Metadata'
];

const HISTORY_HEADERS = [
  'ID', 'ReviewedAt', 'CardID', 'Question', 'Tags', 'Rating', 'Correct', 'ResponseMs', 'NextDueAt', 'Device', 'RequestId',
  'ProfileId', 'Source', 'WasNew', 'DeletedAt'
];

const SYNC_HEADERS = ['RequestId', 'ReceivedAt', 'Action', 'Outcome', 'CardID', 'Message'];

function setup() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open this script from the target Google Sheet, then run setup().');
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty('SPREADSHEET_ID', spreadsheet.getId());
  let secret = properties.getProperty('SYNC_SECRET');
  let generated = false;
  if (!secret) {
    secret = Utilities.getUuid() + Utilities.getUuid();
    properties.setProperty('SYNC_SECRET', secret);
    generated = true;
  }
  ensureSheet_(spreadsheet, CONFIG.cardsSheet, CARD_HEADERS, false);
  ensureSheet_(spreadsheet, CONFIG.historySheet, HISTORY_HEADERS, false);
  const sync = ensureSheet_(spreadsheet, CONFIG.syncSheet, SYNC_HEADERS, true);
  if (!sync.isSheetHidden()) sync.hideSheet();
  SpreadsheetApp.flush();
  Logger.log('work_1 setup complete for spreadsheet: %s', spreadsheet.getId());
  if (generated) Logger.log('Generated SYNC_SECRET (copy this once into the iPad app settings): %s', secret);
  else Logger.log('SYNC_SECRET already exists in Script Properties and was not printed.');
}

function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.cardsSheet || e.range.getRow() < 2) return;
  const row = e.range.getRow();
  const question = String(sheet.getRange(row, 2).getDisplayValue()).trim();
  const answer = String(sheet.getRange(row, 3).getDisplayValue()).trim();
  if (!question && !answer) return;
  const now = new Date().toISOString();
  if (!sheet.getRange(row, 1).getValue()) sheet.getRange(row, 1).setValue('sheet_' + Utilities.getUuid());
  if (!sheet.getRange(row, 10).getValue()) sheet.getRange(row, 10).setValue(now);
  sheet.getRange(row, 11).setValue(now);
  if (!sheet.getRange(row, 13).getValue()) sheet.getRange(row, 13).setValue(0);
  if (!sheet.getRange(row, 14).getValue()) sheet.getRange(row, 14).setValue(5);
  if (!sheet.getRange(row, 15).getValue()) sheet.getRange(row, 15).setValue(now);
  if (!sheet.getRange(row, 16).getValue()) sheet.getRange(row, 16).setValue(0);
  if (!sheet.getRange(row, 17).getValue()) sheet.getRange(row, 17).setValue(0);
  if (!sheet.getRange(row, 18).getValue()) sheet.getRange(row, 18).setValue(0);
  if (!sheet.getRange(row, 19).getValue()) sheet.getRange(row, 19).setValue(0);
  if (!sheet.getRange(row, 20).getValue()) sheet.getRange(row, 20).setValue(0);
  if (!sheet.getRange(row, 21).getValue()) sheet.getRange(row, 21).setValue(0);
  if (!sheet.getRange(row, 25).getValue()) sheet.getRange(row, 25).setValue(1);
}

function doGet(e) {
  const callback = e && e.parameter ? String(e.parameter.callback || '') : '';
  try {
    if (!isValidCallback_(callback)) throw new Error('Invalid callback.');
    const request = {
      action: String(e.parameter.action || ''),
      timestamp: String(e.parameter.timestamp || ''),
      nonce: String(e.parameter.nonce || ''),
      requestId: String(e.parameter.requestId || ''),
      payload: decodePayload_(String(e.parameter.payload || '')),
      signature: String(e.parameter.signature || '')
    };
    verifyRequest_(request);
    if (request.action !== 'pull') throw new Error('GET only supports pull.');
    const result = pull_(request.payload || {});
    return javascript_(callback, result);
  } catch (error) {
    return javascript_(isValidCallback_(callback) ? callback : '__work1_invalid', {
      ok: false,
      error: safeError_(error),
      serverTime: new Date().toISOString(),
      cards: [],
      history: [],
      syncResults: []
    });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) throw new Error('Missing request body.');
    const request = JSON.parse(e.postData.contents);
    verifyRequest_(request);
    const result = withLock_(function () { return handleWrite_(request); });
    return json_(result);
  } catch (error) {
    return json_({ ok: false, error: safeError_(error), serverTime: new Date().toISOString() });
  }
}

function handleWrite_(request) {
  validateRequestId_(request.requestId);
  const existing = findSyncResult_(request.requestId);
  if (existing) return { ok: true, duplicate: true, outcome: existing.outcome, serverTime: new Date().toISOString() };

  let result;
  if (request.action === 'upsertCard') result = upsertCard_(request.payload && request.payload.card, request.requestId, false);
  else if (request.action === 'deleteCard') result = upsertCard_(request.payload && request.payload.card, request.requestId, true);
  else if (request.action === 'appendHistory') result = appendHistory_(request.payload && request.payload.history, request.requestId);
  else if (request.action === 'deleteHistory') result = deleteHistory_(request.payload && request.payload.historyId);
  else throw new Error('Unsupported write action.');

  appendSyncLog_(request.requestId, request.action, result.outcome, result.cardId || '', result.message || '');
  return { ok: true, outcome: result.outcome, serverTime: new Date().toISOString() };
}

function pull_(payload) {
  const spreadsheet = getSpreadsheet_();
  ensureSheet_(spreadsheet, CONFIG.cardsSheet, CARD_HEADERS, false);
  ensureSheet_(spreadsheet, CONFIG.historySheet, HISTORY_HEADERS, false);
  const sync = ensureSheet_(spreadsheet, CONFIG.syncSheet, SYNC_HEADERS, true);
  if (!sync.isSheetHidden()) sync.hideSheet();
  normalizeCardsSheet_(spreadsheet.getSheetByName(CONFIG.cardsSheet));

  const since = parseDate_(payload && payload.since) || new Date(0);
  const cards = readCards_(spreadsheet.getSheetByName(CONFIG.cardsSheet)).filter(function (card) {
    return parseDate_(card.updatedAt) > since;
  }).slice(-CONFIG.maxRowsPerPull);
  const history = readHistory_(spreadsheet.getSheetByName(CONFIG.historySheet)).filter(function (item) {
    const changed = parseDate_(item.deletedAt) || parseDate_(item.reviewedAt);
    return changed > since;
  }).slice(-CONFIG.maxRowsPerPull);
  const syncResults = readSyncLog_(spreadsheet.getSheetByName(CONFIG.syncSheet)).filter(function (item) {
    return parseDate_(item.receivedAt) > since;
  }).slice(-CONFIG.maxRowsPerPull);

  return { ok: true, serverTime: new Date().toISOString(), cards: cards, history: history, syncResults: syncResults };
}

function upsertCard_(card, requestId, deleting) {
  validateCard_(card);
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.cardsSheet);
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, CARD_HEADERS.length).getValues() : [];
  let rowIndex = -1;
  let current = null;
  for (let i = 0; i < rows.length; i += 1) {
    if (String(rows[i][0] || '') === card.id) {
      rowIndex = i + 2;
      current = cardFromRow_(rows[i]);
      break;
    }
  }
  if (current) {
    const remoteUpdated = parseDate_(current.updatedAt);
    const incomingUpdated = parseDate_(card.updatedAt);
    if (remoteUpdated > incomingUpdated && Number(current.version || 0) >= Number(card.version || 0)) {
      return { outcome: 'conflict', cardId: card.id, message: 'Remote card is newer; local copy was preserved as a conflict copy.' };
    }
  }

  const normalized = normalizeCard_(card, requestId, deleting);
  const values = cardToRow_(normalized);
  if (rowIndex === -1) sheet.appendRow(values);
  else sheet.getRange(rowIndex, 1, 1, CARD_HEADERS.length).setValues([values]);
  return { outcome: 'accepted', cardId: normalized.id, message: '' };
}

function appendHistory_(history, requestId) {
  validateHistory_(history);
  const normalized = Object.assign({}, history, { requestId: requestId, deletedAt: '' });
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.historySheet);
  const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, HISTORY_HEADERS.length).getValues() : [];
  let rowIndex = -1;
  for (let i = 0; i < rows.length; i += 1) if (String(rows[i][0] || '') === normalized.id) { rowIndex = i + 2; break; }
  if (rowIndex === -1) sheet.appendRow(historyToRow_(normalized));
  else sheet.getRange(rowIndex, 1, 1, HISTORY_HEADERS.length).setValues([historyToRow_(normalized)]);
  return { outcome: 'accepted', cardId: normalized.cardId, message: '' };
}

function deleteHistory_(historyId) {
  const id = String(historyId || '');
  if (!/^history_[A-Za-z0-9_-]+$/.test(id)) throw new Error('Invalid history ID.');
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.historySheet);
  if (!sheet || sheet.getLastRow() < 2) return { outcome: 'accepted', cardId: '', message: '' };
  const found = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  if (!found) return { outcome: 'accepted', cardId: '', message: '' };
  const row = found.getRow();
  const cardId = String(sheet.getRange(row, 3).getValue() || '');
  sheet.getRange(row, HISTORY_HEADERS.length).setValue(new Date().toISOString());
  return { outcome: 'accepted', cardId: cardId, message: '' };
}

function verifyRequest_(request) {
  if (!request || typeof request !== 'object') throw new Error('Invalid request.');
  const action = String(request.action || '');
  const timestamp = String(request.timestamp || '');
  const nonce = String(request.nonce || '');
  const requestId = String(request.requestId || '');
  const signature = String(request.signature || '');
  const payload = request.payload || {};
  if (!/^[A-Za-z]+$/.test(action)) throw new Error('Invalid action.');
  validateRequestId_(requestId);
  if (!/^nonce_[A-Za-z0-9_-]{12,}$/.test(nonce) || nonce.length > 128) throw new Error('Invalid nonce.');
  const requestTime = parseDate_(timestamp);
  if (!requestTime || Math.abs(Date.now() - requestTime.getTime()) > CONFIG.maxSkewMs) throw new Error('Request timestamp is outside the allowed window. Check the device clock.');
  const secret = PropertiesService.getScriptProperties().getProperty('SYNC_SECRET');
  if (!secret || secret.length < 16) throw new Error('SYNC_SECRET is not configured. Run setup().');
  const canonical = [action, timestamp, nonce, requestId, stableStringify_(payload)].join('\n');
  const expected = base64Url_(Utilities.computeHmacSha256Signature(canonical, secret));
  if (!constantTimeEqual_(expected, signature)) throw new Error('Authentication failed.');
  const cache = CacheService.getScriptCache();
  const nonceKey = 'nonce:' + nonce;
  if (cache.get(nonceKey)) throw new Error('Replay rejected.');
  cache.put(nonceKey, '1', 360);
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID is not configured. Run setup() from the target Sheet.');
  return SpreadsheetApp.openById(id);
}

function ensureSheet_(spreadsheet, name, headers, hide) {
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) sheet = spreadsheet.insertSheet(name);
  const current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  const mismatch = headers.some(function (header, index) { return String(current[index] || '') !== header; });
  if (sheet.getLastRow() === 0 || mismatch) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  if (hide && !sheet.isSheetHidden()) sheet.hideSheet();
  return sheet;
}

function normalizeCardsSheet_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return;
  const range = sheet.getRange(2, 1, sheet.getLastRow() - 1, CARD_HEADERS.length);
  const rows = range.getValues();
  let changed = false;
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const question = String(row[1] || '').trim();
    const answer = String(row[2] || '').trim();
    if (!question && !answer) continue;
    if (!row[0]) { row[0] = 'sheet_' + Utilities.getUuid(); changed = true; }
    if (!row[9]) { row[9] = now; changed = true; }
    if (!row[10]) { row[10] = now; changed = true; }
    if (row[12] === '') { row[12] = 0; changed = true; }
    if (row[13] === '') { row[13] = 5; changed = true; }
    if (!row[14]) { row[14] = now; changed = true; }
    for (let col = 15; col <= 20; col += 1) if (row[col] === '') { row[col] = 0; changed = true; }
    if (!row[24]) { row[24] = 1; changed = true; }
  }
  if (changed) range.setValues(rows);
}

function readCards_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, CARD_HEADERS.length).getValues()
    .filter(function (row) { return row[0] && (row[1] || row[2]); })
    .map(cardFromRow_);
}

function readHistory_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, HISTORY_HEADERS.length).getValues()
    .filter(function (row) { return row[0] && row[2]; })
    .map(function (row) {
      return {
        id: String(row[0]), reviewedAt: iso_(row[1]), cardId: String(row[2]), questionSnapshot: unsanitizeCell_(row[3]),
        tags: splitTags_(row[4]), rating: String(row[5]), isCorrect: boolean_(row[6]), responseMs: Number(row[7] || 0),
        nextDue: iso_(row[8]), device: String(row[9] || 'Web'), requestId: String(row[10] || ''),
        profileId: String(row[11] || ''), source: String(row[12] || 'scheduled'), wasNew: boolean_(row[13]), deletedAt: row[14] ? iso_(row[14]) : null
      };
    });
}

function readSyncLog_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, SYNC_HEADERS.length).getValues()
    .filter(function (row) { return row[0]; })
    .map(function (row) {
      return { requestId: String(row[0]), receivedAt: iso_(row[1]), action: String(row[2]), outcome: String(row[3]), cardId: String(row[4] || ''), message: String(row[5] || '') };
    });
}

function findSyncResult_(requestId) {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.syncSheet);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const found = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(requestId).matchEntireCell(true).findNext();
  if (!found) return null;
  const row = sheet.getRange(found.getRow(), 1, 1, SYNC_HEADERS.length).getValues()[0];
  return { requestId: String(row[0]), outcome: String(row[3]) };
}

function appendSyncLog_(requestId, action, outcome, cardId, message) {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.syncSheet);
  sheet.appendRow([requestId, new Date().toISOString(), action, outcome, cardId, message]);
}

function cardFromRow_(row) {
  const base = {
    id: String(row[0]), question: unsanitizeCell_(row[1]), answer: unsanitizeCell_(row[2]),
    distractors: [row[3], row[4], row[5]].map(unsanitizeCell_).filter(Boolean), explanation: unsanitizeCell_(row[6]),
    tags: splitTags_(row[7]), favorite: boolean_(row[8]), createdAt: iso_(row[9]), updatedAt: iso_(row[10]),
    deletedAt: row[11] ? iso_(row[11]) : null,
    schedule: { stability: Number(row[12] || 0), difficulty: Number(row[13] || 5), due: iso_(row[14]), reps: Number(row[15] || 0), lapses: Number(row[16] || 0), streak: Number(row[17] || 0), lastReview: row[23] ? iso_(row[23]) : null },
    stats: { correct: Number(row[18] || 0), incorrect: Number(row[19] || 0), totalTimeMs: Number(row[20] || 0), fastestMs: row[21] === '' ? null : Number(row[21]), lastTimesMs: parseNumberArray_(row[22]) },
    version: Number(row[24] || 1), lastRequestId: String(row[25] || '')
  };
  return Object.assign(base, parseObject_(row[26]));
}

function cardToRow_(card) {
  return [
    card.id, sanitizeCell_(card.question), sanitizeCell_(card.answer), sanitizeCell_(card.distractors[0] || ''), sanitizeCell_(card.distractors[1] || ''), sanitizeCell_(card.distractors[2] || ''),
    sanitizeCell_(card.explanation), sanitizeCell_(card.tags.join(',')), Boolean(card.favorite), card.createdAt, card.updatedAt, card.deletedAt || '',
    card.schedule.stability, card.schedule.difficulty, card.schedule.due, card.schedule.reps, card.schedule.lapses, card.schedule.streak,
    card.stats.correct, card.stats.incorrect, card.stats.totalTimeMs, card.stats.fastestMs === null ? '' : card.stats.fastestMs, JSON.stringify(card.stats.lastTimesMs || []), card.schedule.lastReview || '',
    card.version, card.lastRequestId || '', JSON.stringify(cardMetadata_(card))
  ];
}

function historyToRow_(history) {
  return [
    history.id, history.reviewedAt, history.cardId, sanitizeCell_(history.questionSnapshot), sanitizeCell_((history.tags || []).join(',')),
    history.rating, Boolean(history.isCorrect), Number(history.responseMs || 0), history.nextDue, sanitizeCell_(history.device || 'Web'), history.requestId,
    cleanText_(history.profileId || '', 120), cleanText_(history.source || 'scheduled', 20), Boolean(history.wasNew), history.deletedAt || ''
  ];
}

function normalizeCard_(card, requestId, deleting) {
  const now = new Date().toISOString();
  const base = {
    id: String(card.id), question: cleanText_(card.question, 5000), answer: cleanText_(card.answer, 5000),
    distractors: (Array.isArray(card.distractors) ? card.distractors : []).slice(0, 3).map(function (value) { return cleanText_(value, 5000); }),
    explanation: cleanText_(card.explanation || '', CONFIG.maxText), tags: (Array.isArray(card.tags) ? card.tags : []).slice(0, 20).map(function (tag) { return cleanText_(tag, 120); }),
    favorite: Boolean(card.favorite), createdAt: validIso_(card.createdAt) || now, updatedAt: validIso_(card.updatedAt) || now,
    deletedAt: deleting ? (validIso_(card.deletedAt) || now) : (validIso_(card.deletedAt) || null),
    schedule: {
      stability: boundedNumber_(card.schedule && card.schedule.stability, 0, 3650, 0), difficulty: boundedNumber_(card.schedule && card.schedule.difficulty, 1, 10, 5),
      due: validIso_(card.schedule && card.schedule.due) || now, reps: boundedNumber_(card.schedule && card.schedule.reps, 0, 100000, 0),
      lapses: boundedNumber_(card.schedule && card.schedule.lapses, 0, 100000, 0), streak: boundedNumber_(card.schedule && card.schedule.streak, 0, 100000, 0),
      lastReview: validIso_(card.schedule && card.schedule.lastReview) || null
    },
    stats: {
      correct: boundedNumber_(card.stats && card.stats.correct, 0, 1000000, 0), incorrect: boundedNumber_(card.stats && card.stats.incorrect, 0, 1000000, 0),
      totalTimeMs: boundedNumber_(card.stats && card.stats.totalTimeMs, 0, 1e15, 0), fastestMs: card.stats && card.stats.fastestMs !== null ? boundedNumber_(card.stats.fastestMs, 0, 3600000, null) : null,
      lastTimesMs: (card.stats && Array.isArray(card.stats.lastTimesMs) ? card.stats.lastTimesMs : []).slice(-10).map(function (n) { return boundedNumber_(n, 0, 3600000, 0); })
    },
    version: boundedNumber_(card.version, 1, 1000000000, 1), lastRequestId: requestId
  };
  return Object.assign(base, cardMetadata_(card));
}

function cardMetadata_(card) {
  const queue = ['new', 'learning', 'review', 'relearning'].indexOf(String(card.queue || '')) >= 0 ? String(card.queue) : undefined;
  return {
    cardNumber: cleanText_(card.cardNumber || '', 120) || undefined,
    profileId: cleanText_(card.profileId || '', 120) || undefined,
    deckId: cleanText_(card.deckId || '', 160) || undefined,
    noteId: cleanText_(card.noteId || '', 160) || undefined,
    noteTypeId: cleanText_(card.noteTypeId || '', 160) || undefined,
    templateId: cleanText_(card.templateId || '', 160) || undefined,
    queue: queue,
    position: Number.isFinite(Number(card.position)) ? Number(card.position) : undefined,
    flag: boundedNumber_(card.flag, 0, 7, 0),
    suspended: Boolean(card.suspended),
    buriedUntil: validIso_(card.buriedUntil) || null,
    marked: Boolean(card.marked),
    typedAnswer: cleanText_(card.typedAnswer || '', 5000) || undefined,
    siblingGroup: cleanText_(card.siblingGroup || '', 160) || undefined,
    originalDeckId: cleanText_(card.originalDeckId || '', 160) || undefined,
    filteredDeckId: cleanText_(card.filteredDeckId || '', 160) || null
  };
}

function validateCard_(card) {
  if (!card || typeof card !== 'object') throw new Error('Missing card.');
  if (!/^card_[A-Za-z0-9_-]+$|^sheet_[A-Za-z0-9_-]+$/.test(String(card.id || ''))) throw new Error('Invalid card ID.');
  if (!String(card.question || '').trim() || !String(card.answer || '').trim()) throw new Error('Question and answer are required.');
  if (String(card.question).length > 5000 || String(card.answer).length > 5000) throw new Error('Card text is too long.');
  if (!card.schedule || !card.stats) throw new Error('Missing card state.');
}

function validateHistory_(history) {
  if (!history || typeof history !== 'object') throw new Error('Missing history.');
  if (!/^history_[A-Za-z0-9_-]+$/.test(String(history.id || ''))) throw new Error('Invalid history ID.');
  if (!/^card_[A-Za-z0-9_-]+$|^sheet_[A-Za-z0-9_-]+$/.test(String(history.cardId || ''))) throw new Error('Invalid history card ID.');
  if (!['again', 'hard', 'good', 'easy'].includes(String(history.rating || ''))) throw new Error('Invalid rating.');
  if (history.source && !['scheduled', 'custom', 'exam'].includes(String(history.source))) throw new Error('Invalid history source.');
  if (!validIso_(history.reviewedAt) || !validIso_(history.nextDue)) throw new Error('Invalid history time.');
}

function validateRequestId_(value) {
  if (!/^(?:req|pull)_[A-Za-z0-9_-]{12,}$/.test(String(value || '')) || String(value).length > 128) throw new Error('Invalid request ID.');
}

function stableStringify_(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify_).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(function (key) { return JSON.stringify(key) + ':' + stableStringify_(value[key]); }).join(',') + '}';
}

function decodePayload_(encoded) {
  if (!encoded) return {};
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || encoded.length > 10000) throw new Error('Invalid payload encoding.');
  const bytes = Utilities.base64DecodeWebSafe(encoded);
  return JSON.parse(Utilities.newBlob(bytes).getDataAsString('UTF-8'));
}

function base64Url_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function constantTimeEqual_(a, b) {
  a = String(a || ''); b = String(b || '');
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) diff |= (a.charCodeAt(i % Math.max(1, a.length)) || 0) ^ (b.charCodeAt(i % Math.max(1, b.length)) || 0);
  return diff === 0;
}

function sanitizeCell_(value) {
  const text = cleanText_(value == null ? '' : value, CONFIG.maxText);
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

function unsanitizeCell_(value) {
  const text = String(value == null ? '' : value);
  return /^'[=+\-@\t\r]/.test(text) ? text.slice(1) : text;
}

function cleanText_(value, maxLength) {
  return String(value == null ? '' : value).replace(/\u0000/g, '').slice(0, maxLength);
}

function splitTags_(value) {
  return unsanitizeCell_(value).split(',').map(function (tag) { return tag.trim(); }).filter(Boolean).slice(0, 20);
}

function parseNumberArray_(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.slice(-10).map(function (n) { return Number(n) || 0; }) : [];
  } catch (_) { return []; }
}

function parseObject_(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) { return {}; }
}

function boolean_(value) {
  return value === true || String(value || '').toLowerCase() === 'true';
}

function boundedNumber_(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function validIso_(value) {
  const date = parseDate_(value);
  return date ? date.toISOString() : '';
}

function parseDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const date = new Date(String(value || ''));
  return isNaN(date.getTime()) ? null : date;
}

function iso_(value) {
  const date = parseDate_(value);
  return date ? date.toISOString() : new Date(0).toISOString();
}

function isValidCallback_(value) {
  return /^[A-Za-z_$][0-9A-Za-z_$]{0,80}$/.test(String(value || ''));
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function javascript_(callback, value) {
  const safe = isValidCallback_(callback) ? callback : '__work1_invalid';
  return ContentService.createTextOutput(safe + '(' + JSON.stringify(value) + ');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('The sync service is busy. Try again.');
  try { return callback(); } finally { lock.releaseLock(); }
}

function safeError_(error) {
  return error && error.message ? String(error.message).slice(0, 300) : 'Unknown error';
}
