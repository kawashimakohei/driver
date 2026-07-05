const DB_SHEETS = [
  { name: '【閲覧用】', key: 'a', priority: 3 },
  { name: '【閲覧用】タクシー', key: 'b', priority: 2 },
  { name: '【閲覧用】スカウト', key: 'c', priority: 1 }
];

const WRITABLE_SHEETS = [
  'LinkIndex',
  'SendLogs',
  'ClickEvents',
  'AnswerEvents',
  'PastSMS_DB',
  'ImmediateCallQueue',
  'DBOutputLogs',
  'ImmediateCallOutputLogs',
  'PublicClickEvents'
];

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
    'phone_number',
    'name',
    'clicked_path_key',
    'public_tracking_code',
    'clicked_url',
    'lp_path',
    'candidate_key',
    'candidate_no',
    'raw_json'
  ],
  ClickEvents: [
    'timestamp',
    'event_type',
    'candidate_key',
    'candidate_no',
    'db_sheet_name',
    'name',
    'phone_number',
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
    'campaign_id',
    'link_id',
    'channel',
    'destination_type',
    'signature_valid',
    'raw_query'
  ],
  AnswerEvents: [
    'timestamp',
    'event_type',
    'answer',
    'candidate_key',
    'candidate_no',
    'db_sheet_name',
    'name',
    'phone_number',
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
    'campaign_id',
    'link_id',
    'channel',
    'signature_valid',
    'raw_query'
  ],
  DBOutputLogs: [
    'timestamp',
    'link_id',
    'event_type',
    'candidate_key',
    'phone_number',
    'campaign_id',
    'db_output_status'
  ],
  ImmediateCallOutputLogs: [
    'timestamp',
    'phone_number',
    'campaign_id',
    'link_id',
    'event_type',
    'output_status'
  ]
};

const HOT_ANSWERS = [
  'now',
  'good',
  'call_today',
  'call_tomorrow_am',
  'call_tomorrow_pm',
  'line'
];

const HOT_EVENT_TYPES = HOT_ANSWERS.map(function(answer) {
  return 'answer_' + answer;
});

const ANSWER_LABELS = {
  now: '今すぐ転職したい',
  good: '良い求人があれば話を聞きたい',
  view: '求人だけ見たい',
  later: '今は不要',
  stop: '配信停止したい',
  call_today: '今日中に電話してほしい',
  call_tomorrow_am: '明日の午前に電話してほしい',
  call_tomorrow_pm: '明日の午後に電話してほしい',
  line: 'まずはLINEで相談したい'
};

function getProps_() {
  return PropertiesService.getScriptProperties();
}

function getRequiredProp_(name) {
  const value = getProps_().getProperty(name);
  if (!value) throw new Error('Missing script property: ' + name);
  return value;
}

function getBoolProp_(name) {
  return String(getProps_().getProperty(name) || '').toLowerCase() === 'true';
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

function hmacHex_(source) {
  const secret = getRequiredProp_('TRACKING_SECRET');
  const bytes = Utilities.computeHmacSha256Signature(source, secret);
  return bytes
    .map(function(byte) {
      const v = byte < 0 ? byte + 256 : byte;
      return ('0' + v.toString(16)).slice(-2);
    })
    .join('');
}

function buildSignature_(candidateKey, campaignId, linkId, channel, destinationType) {
  return hmacHex_([candidateKey, campaignId, linkId, channel, destinationType].join('|'));
}

function isSignatureValid_(params) {
  if (!params.k || !params.cid || !params.l || !params.ch || !params.d || !params.sig) return false;
  const expected = buildSignature_(params.k, params.cid, params.l, params.ch, params.d);
  return String(params.sig) === expected;
}

function getWritableSheet_(sheetName) {
  if (!WRITABLE_SHEETS.includes(sheetName)) {
    throw new Error('Write operation blocked. Not a writable sheet: ' + sheetName);
  }

  const ss = SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty('LOG_SPREADSHEET_ID')
  );

  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Writable sheet not found: ' + sheetName);
  }

  return sheet;
}

function setupLogSheets() {
  const ss = SpreadsheetApp.openById(getRequiredProp_('LOG_SPREADSHEET_ID'));
  WRITABLE_SHEETS.forEach(function(sheetName) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    const headers = HEADERS[sheetName];
    if (headers) {
      ensureHeaders_(sheet, headers);
    }
  });
}

function ensureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    return;
  }
  const current = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0];
  const missing = headers.filter(function(header) {
    return current.indexOf(header) === -1;
  });
  if (!missing.length) return;
  sheet.getRange(1, current.length + 1, 1, missing.length).setValues([missing]);
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

function appendObjects_(sheetName, headers, objects) {
  if (!objects || !objects.length) return;
  withLock_(function() {
    const sheet = getWritableSheet_(sheetName);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
    }
    const values = objects.map(function(object) {
      return headers.map(function(header) {
        return object[header] == null ? '' : object[header];
      });
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
  });
}

function appendRows_(sheetName, rows) {
  if (!rows || !rows.length) return;
  withLock_(function() {
    const sheet = getWritableSheet_(sheetName);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  });
}

function json_(payload) {
  const output = ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
  return output;
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.secret !== getRequiredProp_('TRACKING_SECRET')) {
      throw new Error('Unauthorized');
    }
    if (body.action === 'lookup') {
      return json_({ ok: true, results: lookupCandidates_(body.phones || []) });
    }
    if (body.action === 'recordLinkIndexBatch') {
      appendObjects_('LinkIndex', HEADERS.LinkIndex, body.rows || []);
      return json_({ ok: true });
    }
    if (body.action === 'recordSendLogsBatch') {
      appendObjects_('SendLogs', HEADERS.SendLogs, body.rows || []);
      return json_({ ok: true });
    }
    if (body.action === 'recordPublicClick') {
      recordPublicClick_(body);
      return json_({ ok: true });
    }
    throw new Error('Unknown action: ' + body.action);
  } catch (error) {
    return json_({ ok: false, error: error.message });
  }
}

function recordPublicClick_(body) {
  const linkRecord = findLinkByPublicCode_(body.public_tracking_code);
  const payload = {
    timestamp: new Date(),
    phone_number: linkRecord ? linkRecord.phone_number : '',
    name: linkRecord ? linkRecord.name : '',
    clicked_path_key: body.clicked_path_key || '',
    public_tracking_code: body.public_tracking_code || '',
    clicked_url: body.clicked_url || '',
    lp_path: body.lp_path || '',
    candidate_key: linkRecord ? linkRecord.candidate_key : '',
    candidate_no: linkRecord ? linkRecord.candidate_no : '',
    raw_json: JSON.stringify(body)
  };
  appendObjects_('PublicClickEvents', HEADERS.PublicClickEvents, [payload]);
}

function lookupCandidates_(phones) {
  const targets = {};
  phones.forEach(function(phone) {
    const normalized = normalizePhone_(phone);
    if (normalized) targets[normalized] = [];
  });
  const keys = Object.keys(targets);
  if (!keys.length) return {};

  const dbSs = SpreadsheetApp.openById(getRequiredProp_('DB_SPREADSHEET_ID'));      // 読み取り専用
  const results = {};

  DB_SHEETS.forEach(function(definition) {
    const sheet = dbSs.getSheetByName(definition.name);
    if (!sheet) return;
    const lastRow = sheet.getLastRow();
    const lastColumn = sheet.getLastColumn();
    if (lastRow < 5 || lastColumn < 4) return;
    const values = sheet.getRange(5, 1, lastRow - 4, lastColumn).getDisplayValues();
    values.forEach(function(row) {
      const normalized = normalizePhone_(row[3]);
      if (!targets[normalized]) return;
      const phone = formatPhone_(row[3]);
      targets[normalized].push({
        candidate_key: definition.key + '_' + row[2],
        candidate_no: row[2] || '',
        db_sheet_key: definition.key,
        db_sheet_name: definition.name,
        priority: definition.priority,
        name: row[5] || '',
        phone_number: phone.withZero,
        phone_without_leading_zero: phone.withoutZero,
        email: row[9] || '',
        address: row[4] || '',
        license: row[10] || '',
        age: row[11] || '',
        gender: row[12] || '',
        station: row[19] || '',
        prefecture: row[22] || '',
        applied_at: row[23] || '',
        apply_media: row[24] || '',
        apply_route: row[25] || '',
        status: row[26] || ''
      });
    });
  });

  keys.forEach(function(normalized) {
    const matches = targets[normalized] || [];
    if (!matches.length) return;
    matches.sort(function(a, b) {
      return a.priority - b.priority;
    });
    const selected = matches[0];
    selected.match_status = 'matched';
    selected.matched_count = matches.length;
    selected.matched_sheets = matches.map(function(match) { return match.db_sheet_name; }).join(',');
    delete selected.priority;
    results[normalized] = selected;
  });

  return results;
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.mode === 'answer') {
    return handleAnswer_(params);
  }
  return handleClick_(params);
}

function handleClick_(params) {
  const signatureValid = isSignatureValid_(params);
  const linkRecord = findLinkById_(params.l);
  const merged = mergeLinkAndParams_(linkRecord, params);

  appendObjects_('ClickEvents', HEADERS.ClickEvents, [{
    timestamp: new Date(),
    event_type: linkRecord ? 'click' : 'click_link_not_found',
    candidate_key: merged.candidate_key,
    candidate_no: merged.candidate_no,
    db_sheet_name: merged.db_sheet_name,
    name: merged.name,
    phone_number: merged.phone_number,
    email: merged.email,
    address: merged.address,
    license: merged.license,
    age: merged.age,
    gender: merged.gender,
    station: merged.station,
    prefecture: merged.prefecture,
    applied_at: merged.applied_at,
    apply_media: merged.apply_media,
    apply_route: merged.apply_route,
    status: merged.status,
    campaign_id: params.cid || merged.campaign_id,
    link_id: params.l || merged.link_id,
    channel: params.ch || merged.channel,
    destination_type: params.d || merged.destination_type,
    signature_valid: signatureValid,
    raw_query: JSON.stringify(params)
  }]);

  if (!signatureValid) {
    return invalidHtml_('リンクが無効です');
  }

  if (!linkRecord || params.d === 'track') {
    return clickReceivedHtml_();
  }

  if (getBoolProp_('OUTPUT_CLICK_TO_DB')) {
    maybeOutputPastSms_('click', merged);
  }
  if (getBoolProp_('OUTPUT_CLICK_TO_IMMEDIATE_CALL')) {
    maybeOutputImmediateCall_('click', merged);
  }

  return redirect_(buildDestinationUrl_(params));
}

function handleAnswer_(params) {
  const signatureValid = isSignatureValid_(params);
  const linkRecord = findLinkById_(params.l);
  const merged = mergeLinkAndParams_(linkRecord, params);
  const answer = params.ans || '';
  const eventType = 'answer_' + answer;

  appendObjects_('AnswerEvents', HEADERS.AnswerEvents, [{
    timestamp: new Date(),
    event_type: linkRecord ? eventType : 'answer_link_not_found',
    answer: answer,
    candidate_key: merged.candidate_key,
    candidate_no: merged.candidate_no,
    db_sheet_name: merged.db_sheet_name,
    name: merged.name,
    phone_number: merged.phone_number,
    email: merged.email,
    address: merged.address,
    license: merged.license,
    age: merged.age,
    gender: merged.gender,
    station: merged.station,
    prefecture: merged.prefecture,
    applied_at: merged.applied_at,
    apply_media: merged.apply_media,
    apply_route: merged.apply_route,
    status: merged.status,
    campaign_id: params.cid || merged.campaign_id,
    link_id: params.l || merged.link_id,
    channel: params.ch || merged.channel,
    signature_valid: signatureValid,
    raw_query: JSON.stringify(params)
  }]);

  if (!signatureValid || !linkRecord) {
    return invalidHtml_('回答を確認できませんでした');
  }

  if (HOT_ANSWERS.includes(answer)) {
    maybeOutputPastSms_(eventType, merged);
    maybeOutputImmediateCall_(eventType, merged);
    notifySlack_(answer, merged);
  }

  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="font-family:sans-serif;padding:24px;line-height:1.7;">' +
    '<h1>回答を受け付けました</h1><p>ご回答ありがとうございます。</p>' +
    '</body></html>'
  );
}

function findLinkById_(linkId) {
  if (!linkId) return null;
  const sheet = getWritableSheet_('LinkIndex');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(1, 1, lastRow, HEADERS.LinkIndex.length).getDisplayValues();
  const headers = values[0];
  const linkIndex = headers.indexOf('link_id');
  for (let i = values.length - 1; i >= 1; i--) {
    if (values[i][linkIndex] === linkId) {
      return rowToObject_(headers, values[i]);
    }
  }
  return null;
}

function findLinkByPublicCode_(publicTrackingCode) {
  if (!publicTrackingCode) return null;
  const sheet = getWritableSheet_('LinkIndex');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(1, 1, lastRow, sheet.getLastColumn()).getDisplayValues();
  const headers = values[0];
  const publicCodeIndex = headers.indexOf('public_tracking_code');
  const sendUrlIndex = headers.indexOf('send_url');
  for (let i = values.length - 1; i >= 1; i--) {
    const publicCodeMatch = publicCodeIndex >= 0 && values[i][publicCodeIndex] === publicTrackingCode;
    const sendUrlMatch = sendUrlIndex >= 0 && values[i][sendUrlIndex].indexOf('/' + publicTrackingCode) >= 0;
    if (publicCodeMatch || sendUrlMatch) {
      return rowToObject_(headers, values[i]);
    }
  }
  return null;
}

function rowToObject_(headers, row) {
  const object = {};
  headers.forEach(function(header, index) {
    object[header] = row[index] || '';
  });
  return object;
}

function mergeLinkAndParams_(linkRecord, params) {
  const record = linkRecord || {};
  return {
    candidate_key: record.candidate_key || params.k || '',
    candidate_no: record.candidate_no || '',
    db_sheet_name: record.db_sheet_name || '',
    name: record.name || '',
    phone_number: record.phone_number || '',
    phone_without_leading_zero: record.phone_without_leading_zero || formatPhone_(record.phone_number).withoutZero,
    email: record.email || '',
    address: record.address || '',
    license: record.license || '',
    age: record.age || '',
    gender: record.gender || '',
    station: record.station || '',
    prefecture: record.prefecture || '',
    applied_at: record.applied_at || '',
    apply_media: record.apply_media || '',
    apply_route: record.apply_route || '',
    status: record.status || '',
    campaign_id: record.campaign_id || params.cid || '',
    link_id: record.link_id || params.l || '',
    channel: record.channel || params.ch || '',
    destination_type: record.destination_type || params.d || ''
  };
}

function buildDestinationUrl_(params) {
  const props = getProps_();
  let baseUrl = '';
  if (params.d === 'call') {
    baseUrl = props.getProperty('CALL_LP_URL');
  } else if (params.d === 'jobs') {
    baseUrl = props.getProperty('JOBS_URL');
  } else {
    baseUrl = props.getProperty('REPLY_LP_URL');
  }
  if (!baseUrl) return props.getProperty('REPLY_LP_URL') || '';
  const query = [
    ['k', params.k],
    ['cid', params.cid],
    ['l', params.l],
    ['ch', params.ch],
    ['d', params.d],
    ['sig', params.sig]
  ].map(function(pair) {
    return encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair[1] || '');
  }).join('&');
  return baseUrl + (baseUrl.indexOf('?') >= 0 ? '&' : '?') + query;
}

function redirect_(url) {
  if (!url) return invalidHtml_('遷移先URLが設定されていません');
  const escaped = String(url).replace(/"/g, '&quot;');
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta http-equiv="refresh" content="0;url=' + escaped + '"></head>' +
    '<body><script>window.top.location.href="' + escaped + '";</script></body></html>'
  );
}

function invalidHtml_(message) {
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="font-family:sans-serif;padding:24px;line-height:1.7;">' +
    '<h1>' + message + '</h1><p>URLを確認してください。</p>' +
    '</body></html>'
  );
}

function clickReceivedHtml_() {
  return HtmlService.createHtmlOutput(
    '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
    '<body style="font-family:sans-serif;padding:24px;line-height:1.7;">' +
    '<h1>クリックを記録しました</h1><p>ご確認ありがとうございます。</p>' +
    '</body></html>'
  );
}

function maybeOutputPastSms_(eventType, record) {
  if (!HOT_EVENT_TYPES.includes(eventType) && eventType !== 'click') return;
  withLock_(function() {
    if (existsDbOutputLog_(record.link_id, eventType)) return;
    const source = record.apply_route || record.campaign_id || 'past_sms';
    const phone = formatPhone_(record.phone_number);
    appendRowsWithoutLock_('PastSMS_DB', [[
      new Date(),
      source,
      record.name || '',
      phone.withoutZero,
      '',
      record.address || '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      phone.withZero
    ]]);
    appendRowsWithoutLock_('DBOutputLogs', [[
      new Date(),
      record.link_id || '',
      eventType,
      record.candidate_key || '',
      phone.withZero,
      record.campaign_id || '',
      'output'
    ]]);
  });
}

function maybeOutputImmediateCall_(eventType, record) {
  if (!HOT_EVENT_TYPES.includes(eventType) && eventType !== 'click') return;
  withLock_(function() {
    const phone = formatPhone_(record.phone_number);
    if (existsImmediateCallLog_(phone.withZero, record.campaign_id, eventType)) return;
    const source = record.apply_route || record.campaign_id || 'past_sms';
    appendRowsWithoutLock_('ImmediateCallQueue', [[
      phone.withZero,
      record.address || '',
      record.name || '',
      source
    ]]);
    appendRowsWithoutLock_('ImmediateCallOutputLogs', [[
      new Date(),
      phone.withZero,
      record.campaign_id || '',
      record.link_id || '',
      eventType,
      'output'
    ]]);
  });
}

function appendRowsWithoutLock_(sheetName, rows) {
  const sheet = getWritableSheet_(sheetName);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function existsDbOutputLog_(linkId, eventType) {
  const sheet = getWritableSheet_('DBOutputLogs');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.DBOutputLogs.length).getDisplayValues();
  return values.some(function(row) {
    return row[1] === linkId && row[2] === eventType;
  });
}

function existsImmediateCallLog_(phoneNumber, campaignId, eventType) {
  const sheet = getWritableSheet_('ImmediateCallOutputLogs');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.ImmediateCallOutputLogs.length).getDisplayValues();
  return values.some(function(row) {
    return row[1] === phoneNumber && row[2] === campaignId && row[4] === eventType;
  });
}

function notifySlack_(answer, record) {
  const webhookUrl = getProps_().getProperty('SLACK_WEBHOOK_URL');
  if (!webhookUrl) return;
  const text = [
    '【掘り起こし反応あり】',
    '氏名：' + (record.name || ''),
    '電話番号：' + (formatPhone_(record.phone_number).withZero || ''),
    '住所：' + (record.address || ''),
    'メアド：' + (record.email || ''),
    '免許：' + (record.license || ''),
    '都道府県：' + (record.prefecture || ''),
    '応募媒体：' + (record.apply_media || ''),
    '応募経路：' + (record.apply_route || ''),
    '回答：' + (ANSWER_LABELS[answer] || answer),
    'キャンペーン：' + (record.campaign_id || ''),
    'チャネル：' + (record.channel || ''),
    'candidate_key：' + (record.candidate_key || ''),
    'link_id：' + (record.link_id || '')
  ].join('\n');
  UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text: text }),
    muteHttpExceptions: true
  });
}
