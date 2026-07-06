/**
 * @OnlyCurrentDoc
 *
 * Container-bound Apps Script for the SMS link MVP.
 * This script intentionally never returns DB lookup results to Render/browser.
 */

const DB_SHEETS = [
  { name: '【閲覧用】スカウト', key: 'c', priority: 1 },
  { name: '【閲覧用】タクシー', key: 'b', priority: 2 },
  { name: '【閲覧用】', key: 'a', priority: 3 }
];

const DATA_START_ROW = 5;
const DB_COL_CANDIDATE_NO = 3;
const DB_COL_PHONE = 4;
const DB_COL_ADDRESS = 5;
const DB_COL_NAME = 6;

const CLICKBOT_SHEET_NAME = '【記入用】Clickbot';

const HEADERS = {
  LinkIndex: [
    'created_at',
    'candidate_key',
    'candidate_no',
    'db_sheet_key',
    'db_sheet_name',
    'match_status',
    'matched_count',
    'matched_sheets',
    'link_id',
    'campaign_id',
    'channel',
    'destination_type',
    'tracking_url',
    'lp_url',
    'public_tracking_code',
    'send_url',
    'final_message',
    'name',
    'phone_number',
    'phone_without_leading_zero',
    'email',
    'address',
    'license',
    'age',
    'gender',
    'station',
    'prefecture',
    'applied_at',
    'apply_media',
    'apply_route',
    'status',
    'raw_input_phone',
    'raw_input_message'
  ],
  SendLogs: [
    'timestamp',
    'candidate_key',
    'candidate_no',
    'db_sheet_name',
    'match_status',
    'matched_count',
    'matched_sheets',
    'name',
    'phone_number',
    'email',
    'address',
    'license',
    'prefecture',
    'campaign_id',
    'link_id',
    'channel',
    'destination_type',
    'tracking_url',
    'send_url',
    'final_message',
    'twilio_sid',
    'twilio_status',
    'error_message',
    'raw_json'
  ],
  PublicClickEvents: [
    'timestamp',
    'public_tracking_code',
    'clicked_path_key',
    'clicked_url',
    'lp_path',
    'link_id',
    'lookup_status',
    'clickbot_output_status'
  ]
};

const WRITABLE_SHEETS = Object.keys(HEADERS);

function getActiveSpreadsheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Active spreadsheet is unavailable.');
  return ss;
}

function getProps_() {
  return PropertiesService.getScriptProperties();
}

function getRequiredProp_(name) {
  const value = getProps_().getProperty(name);
  if (!value) throw new Error('Missing required setting.');
  return value;
}

function isSecretValid_(body) {
  return String(body.secret || '') === getRequiredProp_('TRACKING_SECRET');
}

function normalizePhone_(value) {
  return String(value || '')
    .replace(/[０-９]/g, function(char) {
      return String.fromCharCode(char.charCodeAt(0) - 0xfee0);
    })
    .replace(/\D/g, '');
}

function formatPhone_(value) {
  const normalized = normalizePhone_(value);
  if (!normalized) return { withZero: '', withoutZero: '' };
  if (normalized.charAt(0) === '0') {
    return { withZero: normalized, withoutZero: normalized.slice(1) };
  }
  return { withZero: '0' + normalized, withoutZero: normalized };
}

function phoneRegex_(digits) {
  return '^\\D*' + String(digits).split('').join('\\D*') + '\\D*$';
}

function json_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function withLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function getWritableSheet_(sheetName) {
  if (WRITABLE_SHEETS.indexOf(sheetName) === -1) {
    throw new Error('Write operation blocked.');
  }
  const ss = getActiveSpreadsheet_();
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }
  ensureHeaders_(sheet, HEADERS[sheetName]);
  return sheet;
}

function getClickbotSheet_() {
  const sheet = getActiveSpreadsheet_().getSheetByName(CLICKBOT_SHEET_NAME);
  if (!sheet) throw new Error('Clickbot sheet not found.');
  return sheet;
}

function readHeaders_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  return sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
}

function ensureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    return headers.slice();
  }

  const current = readHeaders_(sheet);
  const missing = headers.filter(function(header) {
    return current.indexOf(header) === -1;
  });
  if (missing.length) {
    sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
    return current.concat(missing);
  }
  return current;
}

function appendObjects_(sheetName, objects) {
  if (!objects || !objects.length) return;
  withLock_(function() {
    const sheet = getWritableSheet_(sheetName);
    const headers = ensureHeaders_(sheet, HEADERS[sheetName]);
    const values = objects.map(function(object) {
      return headers.map(function(header) {
        return object[header] == null ? '' : object[header];
      });
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
  });
}

function setupLogSheets() {
  WRITABLE_SHEETS.forEach(function(sheetName) {
    getWritableSheet_(sheetName);
  });
  getClickbotSheet_();
}

function doGet() {
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    '<body style="font-family:sans-serif;padding:24px;line-height:1.7;">OK</body></html>'
  );
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!isSecretValid_(body)) throw new Error('Unauthorized');

    if (body.action === 'lookup') {
      return json_({ ok: true, results: {} });
    }
    if (body.action === 'recordLinkIndexBatch') {
      recordLinkIndexBatch_(body.rows || []);
      return json_({ ok: true });
    }
    if (body.action === 'recordSendLogsBatch') {
      recordSendLogsBatch_(body.rows || []);
      return json_({ ok: true });
    }
    if (body.action === 'recordPublicClick') {
      recordPublicClick_(body);
      return json_({ ok: true });
    }
    throw new Error('Unknown action');
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return json_({ ok: false, error: 'GAS request failed' });
  }
}

function recordLinkIndexBatch_(rows) {
  const sanitized = rows.map(sanitizeLinkIndexRow_).filter(function(row) {
    return row.public_tracking_code && row.phone_number;
  });
  appendObjects_('LinkIndex', sanitized);
}

function sanitizeLinkIndexRow_(row) {
  const phone = formatPhone_(row.phone_number || row.raw_input_phone);
  return {
    created_at: row.created_at || new Date(),
    candidate_key: row.candidate_key || '',
    candidate_no: '',
    db_sheet_key: '',
    db_sheet_name: '',
    match_status: 'not_looked_up',
    matched_count: '',
    matched_sheets: '',
    link_id: row.link_id || '',
    campaign_id: row.campaign_id || '',
    channel: row.channel || '',
    destination_type: row.destination_type || '',
    tracking_url: '',
    lp_url: row.lp_url || '',
    public_tracking_code: row.public_tracking_code || '',
    send_url: row.send_url || '',
    final_message: '',
    name: '',
    phone_number: phone.withZero,
    phone_without_leading_zero: phone.withoutZero,
    email: '',
    address: '',
    license: '',
    age: '',
    gender: '',
    station: '',
    prefecture: '',
    applied_at: '',
    apply_media: '',
    apply_route: '',
    status: '',
    raw_input_phone: phone.withZero,
    raw_input_message: ''
  };
}

function recordSendLogsBatch_(rows) {
  const sanitized = rows.map(function(row) {
    const phone = formatPhone_(row.phone_number || row.raw_input_phone);
    return {
      timestamp: row.timestamp || new Date(),
      candidate_key: row.candidate_key || '',
      candidate_no: '',
      db_sheet_name: '',
      match_status: '',
      matched_count: '',
      matched_sheets: '',
      name: '',
      phone_number: phone.withZero,
      email: '',
      address: '',
      license: '',
      prefecture: '',
      campaign_id: row.campaign_id || '',
      link_id: row.link_id || '',
      channel: row.channel || '',
      destination_type: row.destination_type || '',
      tracking_url: '',
      send_url: row.send_url || '',
      final_message: '',
      twilio_sid: row.twilio_sid || '',
      twilio_status: row.twilio_status || '',
      error_message: row.error_message || '',
      raw_json: ''
    };
  });
  appendObjects_('SendLogs', sanitized);
}

function recordPublicClick_(body) {
  const linkRecord = findLinkByPublicCode_(body.public_tracking_code);
  const clickedPathKey = buildClickedPathKeyForOutput_(linkRecord, body);
  let lookupStatus = 'link_not_found';
  let outputStatus = 'skipped';

  if (linkRecord && clickedPathKey) {
    const candidate = lookupCandidateByPhone_(linkRecord.phone_number || linkRecord.raw_input_phone);
    lookupStatus = candidate.found ? 'matched' : 'unmatched';
    appendClickbotRow_(linkRecord, candidate, clickedPathKey);
    outputStatus = 'output';
  }

  appendObjects_('PublicClickEvents', [{
    timestamp: new Date(),
    public_tracking_code: body.public_tracking_code || '',
    clicked_path_key: clickedPathKey || '',
    clicked_url: body.clicked_url || '',
    lp_path: body.lp_path || '',
    link_id: linkRecord ? linkRecord.link_id : '',
    lookup_status: lookupStatus,
    clickbot_output_status: outputStatus
  }]);
}

function buildClickedPathKeyForOutput_(linkRecord, body) {
  const fromSendUrl = linkRecord ? pathKeyFromUrl_(linkRecord.send_url) : '';
  return sanitizePathKey_(fromSendUrl || body.clicked_path_key || '');
}

function pathKeyFromUrl_(url) {
  if (!url) return '';
  const withoutHost = String(url).replace(/^https?:\/\/[^/]+/i, '');
  const withoutQuery = withoutHost.split('?')[0].split('#')[0];
  return sanitizePathKey_(withoutQuery);
}

function sanitizePathKey_(value) {
  return String(value || '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function findLinkByPublicCode_(publicTrackingCode) {
  if (!publicTrackingCode) return null;
  const sheet = getWritableSheet_('LinkIndex');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const headers = ensureHeaders_(sheet, HEADERS.LinkIndex);
  const publicCodeIndex = headers.indexOf('public_tracking_code') + 1;
  const sendUrlIndex = headers.indexOf('send_url') + 1;

  let cell = null;
  if (publicCodeIndex > 0) {
    cell = sheet
      .getRange(2, publicCodeIndex, lastRow - 1, 1)
      .createTextFinder(String(publicTrackingCode))
      .matchEntireCell(true)
      .findNext();
  }
  if (!cell && sendUrlIndex > 0) {
    cell = sheet
      .getRange(2, sendUrlIndex, lastRow - 1, 1)
      .createTextFinder('/' + String(publicTrackingCode))
      .findNext();
  }
  if (!cell) return null;

  const rowValues = sheet.getRange(cell.getRow(), 1, 1, headers.length).getDisplayValues()[0];
  return rowToObject_(headers, rowValues);
}

function rowToObject_(headers, row) {
  const object = {};
  headers.forEach(function(header, index) {
    object[header] = row[index] || '';
  });
  return object;
}

function lookupCandidateByPhone_(phoneValue) {
  const phone = formatPhone_(phoneValue);
  const patterns = [phone.withZero, phone.withoutZero]
    .filter(function(value, index, array) {
      return value && array.indexOf(value) === index;
    })
    .map(phoneRegex_);

  if (!patterns.length) return { found: false, phone_number: phone.withZero, address: '', name: '' };

  const ss = getActiveSpreadsheet_();
  let selected = null;
  DB_SHEETS.forEach(function(definition) {
    if (selected && selected.priority <= definition.priority) return;
    const sheet = ss.getSheetByName(definition.name);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    if (lastRow < DATA_START_ROW) return;
    const phoneRange = sheet.getRange(DATA_START_ROW, DB_COL_PHONE, lastRow - DATA_START_ROW + 1, 1);
    for (let i = 0; i < patterns.length; i += 1) {
      const cell = phoneRange
        .createTextFinder(patterns[i])
        .useRegularExpression(true)
        .matchEntireCell(true)
        .findNext();
      if (!cell) continue;
      const rowValues = sheet
        .getRange(cell.getRow(), DB_COL_CANDIDATE_NO, 1, DB_COL_NAME - DB_COL_CANDIDATE_NO + 1)
        .getDisplayValues()[0];
      const foundPhone = formatPhone_(rowValues[DB_COL_PHONE - DB_COL_CANDIDATE_NO]);
      selected = {
        found: true,
        priority: definition.priority,
        candidate_key: definition.key + '_' + (rowValues[0] || ''),
        candidate_no: rowValues[0] || '',
        phone_number: foundPhone.withZero || phone.withZero,
        address: rowValues[DB_COL_ADDRESS - DB_COL_CANDIDATE_NO] || '',
        name: rowValues[DB_COL_NAME - DB_COL_CANDIDATE_NO] || ''
      };
      break;
    }
  });

  if (selected) {
    delete selected.priority;
    return selected;
  }

  return { found: false, phone_number: phone.withZero, address: '', name: '' };
}

function appendClickbotRow_(linkRecord, candidate, clickedPathKey) {
  const phone = formatPhone_(candidate.phone_number || linkRecord.phone_number || linkRecord.raw_input_phone);
  const row = [
    phone.withZero,
    candidate.address || '',
    candidate.name || '',
    clickedPathKey
  ];
  withLock_(function() {
    const sheet = getClickbotSheet_();
    const nextRow = findNextClickbotOutputRow_(sheet);
    sheet.getRange(nextRow, 1, 1, row.length).setValues([row]);
  });
}

function findNextClickbotOutputRow_(sheet) {
  const firstOutputRow = 4;
  const lastRow = Math.max(sheet.getLastRow(), firstOutputRow);
  const values = sheet.getRange(firstOutputRow, 1, lastRow - firstOutputRow + 1, 4).getDisplayValues();
  for (let i = 0; i < values.length; i += 1) {
    const isEmpty = values[i].every(function(value) {
      return String(value || '').trim() === '';
    });
    if (isEmpty) return firstOutputRow + i;
  }
  return lastRow + 1;
}
