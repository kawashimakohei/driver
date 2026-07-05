require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const path = require("path");
const twilio = require("twilio");

const app = express();
const PORT = process.env.PORT || 3000;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const TRACKING_SECRET = process.env.TRACKING_SECRET || "";
const GAS_WEBAPP_URL = process.env.GAS_WEBAPP_URL || "";
const LOG_GAS_POST_URL = process.env.LOG_GAS_POST_URL || GAS_WEBAPP_URL;

const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function normalizePhone(value) {
  const halfWidth = String(value || "").replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0)
  );
  return halfWidth.replace(/\D/g, "");
}

function formatPhone(value) {
  const normalized = normalizePhone(value);
  if (!normalized) return { withZero: "", withoutZero: "" };
  if (normalized.startsWith("0")) {
    return { withZero: normalized, withoutZero: normalized.slice(1) };
  }
  return { withZero: `0${normalized}`, withoutZero: normalized };
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\s/g, "");
  return `https://${raw.replace(/\s/g, "")}`;
}

function buildCampaignIdFromLpUrl(lpUrl) {
  const normalized = normalizeUrl(lpUrl);
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    const path = parsed.pathname.replace(/^\/|\/$/g, "").replace(/[^a-zA-Z0-9]+/g, "_");
    return [parsed.hostname.replace(/^www\./, ""), path || "root"].join("_");
  } catch (error) {
    return normalized.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  }
}

function buildPublicTrackingCode(lpUrl) {
  const normalized = normalizeUrl(lpUrl);
  let prefix = "x";
  try {
    const parsed = new URL(normalized);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] || parsed.hostname;
    const first = (last.match(/[a-zA-Z0-9]/) || ["x"])[0].toLowerCase();
    prefix = first;
  } catch (error) {
    const first = (normalized.match(/[a-zA-Z0-9]/) || ["x"])[0].toLowerCase();
    prefix = first;
  }
  return `${prefix}${crypto.randomInt(10000, 100000)}`;
}

function appendTrackingCodeToUrl(lpUrl, publicTrackingCode) {
  const normalized = normalizeUrl(lpUrl);
  if (!normalized || !publicTrackingCode) return "";
  const [withoutHash, hash = ""] = normalized.split("#");
  const [withoutQuery, query = ""] = withoutHash.split("?");
  const base = withoutQuery.endsWith("/") ? withoutQuery : `${withoutQuery}/`;
  return `${base}${encodeURIComponent(publicTrackingCode)}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
}

function signTrackingUrl(candidateKey, campaignId, linkId, channel, destinationType) {
  const source = [candidateKey, campaignId, linkId, channel, destinationType].join("|");
  return crypto.createHmac("sha256", TRACKING_SECRET).update(source).digest("hex");
}

function buildAuthToken() {
  return crypto
    .createHmac("sha256", TRACKING_SECRET || "local-admin-cookie")
    .update(`admin:${ADMIN_PASSWORD}`)
    .digest("hex");
}

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf("=");
      if (index >= 0) acc[decodeURIComponent(part.slice(0, index))] = decodeURIComponent(part.slice(index + 1));
      return acc;
    }, {});
}

function isAuthenticated(req) {
  if (!ADMIN_PASSWORD) return false;
  return parseCookies(req).admin_auth === buildAuthToken();
}

function requireAdmin(req, res, next) {
  if (isAuthenticated(req)) return next();
  return res.redirect("/admin");
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function parsePastedRows(input) {
  const lines = String(input || "")
    .split(/\r?\n/)
    .filter((line) => line.trim());

  const rows = [];
  for (const line of lines) {
    const delimiter = line.includes("\t") ? "\t" : ",";
    const parts = delimiter === "\t" ? line.split("\t").map((value) => value.trim()) : parseCsvLine(line);
    while (parts.length > 1 && parts[parts.length - 1] === "") {
      parts.pop();
    }
    const phone = (parts.shift() || "").trim();
    const message = parts.join(delimiter).trim();
    const looksLikeHeader = /電話|phone/i.test(phone) && /文面|message|本文|送信内容/i.test(message);
    if (looksLikeHeader) continue;
    rows.push({ rawInputPhone: phone, rawInputMessage: message });
  }
  return rows;
}

function createLinkId() {
  const now = new Date();
  const ymd = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("");
  return `lnk_${ymd}_${crypto.randomBytes(4).toString("hex")}`;
}

function buildTrackingUrl({ candidateKey, campaignId, linkId, channel, destinationType }) {
  const sig = signTrackingUrl(candidateKey, campaignId, linkId, channel, destinationType);
  const params = new URLSearchParams({
    k: candidateKey,
    cid: campaignId,
    l: linkId,
    ch: channel,
    d: destinationType,
    sig
  });
  return `${GAS_WEBAPP_URL}?${params.toString()}`;
}

function applyUrlToMessage(message, url) {
  if (String(message).includes("{{url}}")) {
    return String(message).replaceAll("{{url}}", url);
  }
  return `${message}\n${url}`;
}

async function sleepAfterSend() {
  const ms = 100 + Math.floor(Math.random() * 201);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postToGas(action, payload) {
  if (!LOG_GAS_POST_URL) {
    throw new Error("LOG_GAS_POST_URL or GAS_WEBAPP_URL is not configured.");
  }
  const response = await fetch(LOG_GAS_POST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, secret: TRACKING_SECRET, ...payload })
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`GAS returned non-JSON response: ${text.slice(0, 300)}`);
  }
  if (!response.ok || !json.ok) {
    throw new Error(json.error || `GAS request failed with status ${response.status}`);
  }
  return json;
}

function getPublicUrl(req) {
  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "https").split(",")[0];
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  return `${proto}://${host}${req.originalUrl}`;
}

function getClickedPathKey(pathValue) {
  return String(pathValue || "")
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/+/g, "-");
}

async function recordPublicClick(req, publicTrackingCode) {
  if (!publicTrackingCode || !LOG_GAS_POST_URL || !TRACKING_SECRET) return;
  const clickedPathKey = getClickedPathKey(req.path);
  try {
    await postToGas("recordPublicClick", {
      public_tracking_code: publicTrackingCode,
      clicked_path_key: clickedPathKey,
      clicked_url: getPublicUrl(req),
      lp_path: req.path
    });
  } catch (error) {
    console.warn(`Public click logging failed: ${error.message}`);
  }
}

async function lookupCandidates(rows) {
  const phones = [...new Set(rows.map((row) => normalizePhone(row.rawInputPhone)).filter(Boolean))];
  if (!phones.length) return {};
  const result = await postToGas("lookup", { phones });
  return result.results || {};
}

function buildUnmatchedCandidate(normalizedPhone) {
  const phone = formatPhone(normalizedPhone);
  return {
    candidate_key: `unmatched_${sha256(normalizedPhone).slice(0, 16)}`,
    candidate_no: "",
    db_sheet_key: "",
    db_sheet_name: "",
    match_status: "unmatched",
    matched_count: 0,
    matched_sheets: "",
    name: "",
    phone_number: phone.withZero,
    phone_without_leading_zero: phone.withoutZero,
    email: "",
    address: "",
    license: "",
    age: "",
    gender: "",
    station: "",
    prefecture: "",
    applied_at: "",
    apply_media: "",
    apply_route: "",
    status: ""
  };
}

function prepareRows({ pastedRows, lookupResults, campaignId, lpUrl, channel, destinationType, requireMessage = true }) {
  return pastedRows.map((row, index) => {
    const normalizedPhone = normalizePhone(row.rawInputPhone);
    const normalizedLpUrl = normalizeUrl(lpUrl);
    const errors = [];
    if (!normalizedLpUrl) errors.push("LP URLが空です");
    if (!normalizedPhone) errors.push("電話番号が空です");
    if (requireMessage && !row.rawInputMessage) errors.push("送信文面が空です");
    if (!GAS_WEBAPP_URL) errors.push("GAS_WEBAPP_URLが未設定です");
    if (!TRACKING_SECRET) errors.push("TRACKING_SECRETが未設定です");

    const matched = lookupResults[normalizedPhone];
    const candidate = matched || (normalizedPhone ? buildUnmatchedCandidate(normalizedPhone) : buildUnmatchedCandidate(""));
    const linkId = createLinkId();
    const publicTrackingCode = buildPublicTrackingCode(normalizedLpUrl);
    const sendUrl = appendTrackingCodeToUrl(normalizedLpUrl, publicTrackingCode);
    const trackingUrl = buildTrackingUrl({
      candidateKey: candidate.candidate_key,
      campaignId,
      linkId,
      channel,
      destinationType
    });
    const finalMessage = row.rawInputMessage ? applyUrlToMessage(row.rawInputMessage, sendUrl) : sendUrl;

    return {
      row_no: index + 1,
      errors,
      raw_input_phone: row.rawInputPhone,
      raw_input_message: row.rawInputMessage,
      normalized_phone: normalizedPhone,
      candidate_key: candidate.candidate_key,
      candidate_no: candidate.candidate_no || "",
      db_sheet_key: candidate.db_sheet_key || "",
      db_sheet_name: candidate.db_sheet_name || "",
      match_status: candidate.match_status || "matched",
      matched_count: Number(candidate.matched_count || 0),
      matched_sheets: candidate.matched_sheets || "",
      link_id: linkId,
      campaign_id: campaignId,
      lp_url: normalizedLpUrl,
      public_tracking_code: publicTrackingCode,
      channel,
      destination_type: destinationType,
      tracking_url: trackingUrl,
      send_url: sendUrl,
      final_message: finalMessage,
      message_length: [...finalMessage].length,
      name: candidate.name || "",
      phone_number: candidate.phone_number || formatPhone(normalizedPhone).withZero,
      phone_without_leading_zero: candidate.phone_without_leading_zero || formatPhone(normalizedPhone).withoutZero,
      email: candidate.email || "",
      address: candidate.address || "",
      license: candidate.license || "",
      age: candidate.age || "",
      gender: candidate.gender || "",
      station: candidate.station || "",
      prefecture: candidate.prefecture || "",
      applied_at: candidate.applied_at || "",
      apply_media: candidate.apply_media || "",
      apply_route: candidate.apply_route || "",
      status: candidate.status || ""
    };
  });
}

function toLinkIndexRow(row) {
  return {
    created_at: new Date().toISOString(),
    candidate_key: row.candidate_key,
    candidate_no: row.candidate_no,
    db_sheet_key: row.db_sheet_key,
    db_sheet_name: row.db_sheet_name,
    match_status: row.match_status,
    matched_count: row.matched_count,
    matched_sheets: row.matched_sheets,
    link_id: row.link_id,
    campaign_id: row.campaign_id,
    channel: row.channel,
    destination_type: row.destination_type,
    tracking_url: row.tracking_url,
    lp_url: row.lp_url,
    public_tracking_code: row.public_tracking_code,
    send_url: row.send_url,
    final_message: row.final_message,
    name: row.name,
    phone_number: row.phone_number,
    phone_without_leading_zero: row.phone_without_leading_zero,
    email: row.email,
    address: row.address,
    license: row.license,
    age: row.age,
    gender: row.gender,
    station: row.station,
    prefecture: row.prefecture,
    applied_at: row.applied_at,
    apply_media: row.apply_media,
    apply_route: row.apply_route,
    status: row.status,
    raw_input_phone: row.raw_input_phone,
    raw_input_message: row.raw_input_message
  };
}

function toSendLogRow(row, sendResult) {
  return {
    timestamp: new Date().toISOString(),
    candidate_key: row.candidate_key,
    candidate_no: row.candidate_no,
    db_sheet_name: row.db_sheet_name,
    match_status: row.match_status,
    matched_count: row.matched_count,
    matched_sheets: row.matched_sheets,
    name: row.name,
    phone_number: row.phone_number,
    email: row.email,
    address: row.address,
    license: row.license,
    prefecture: row.prefecture,
    campaign_id: row.campaign_id,
    link_id: row.link_id,
    channel: row.channel,
    destination_type: row.destination_type,
    tracking_url: row.tracking_url,
    send_url: row.send_url,
    final_message: row.final_message,
    twilio_sid: sendResult.twilio_sid || "",
    twilio_status: sendResult.twilio_status || "",
    error_message: sendResult.error_message || "",
    raw_json: sendResult.raw_json || ""
  };
}

async function sendOneSms(row) {
  if (row.errors.length) {
    return { twilio_status: "skipped", error_message: row.errors.join(" / ") };
  }
  if (row.channel !== "sms") {
    return { twilio_status: "skipped", error_message: "MVP送信はsmsのみ対応です" };
  }
  if (!twilioClient || !process.env.TWILIO_FROM_NUMBER) {
    return { twilio_status: "error", error_message: "Twilio環境変数が未設定です" };
  }
  try {
    const message = await twilioClient.messages.create({
      from: process.env.TWILIO_FROM_NUMBER,
      to: row.phone_number,
      body: row.final_message
    });
    await sleepAfterSend();
    return {
      twilio_sid: message.sid || "",
      twilio_status: message.status || "sent",
      raw_json: JSON.stringify(message)
    };
  } catch (error) {
    await sleepAfterSend();
    return {
      twilio_status: "error",
      error_message: error.message,
      raw_json: JSON.stringify({ code: error.code, status: error.status, moreInfo: error.moreInfo })
    };
  }
}

function renderAdmin(res, options = {}) {
  res.render("admin", {
    authenticated: options.authenticated,
    adminConfigured: Boolean(ADMIN_PASSWORD),
    gasConfigured: Boolean(GAS_WEBAPP_URL && LOG_GAS_POST_URL && TRACKING_SECRET),
    senderPhone: process.env.TWILIO_FROM_NUMBER || "",
    form: options.form || {
      lp_url: "",
      destination_type: "track",
      channel: "sms",
      pasted_rows: ""
    },
    results: options.results || [],
    warnings: options.warnings || [],
    mode: options.mode || ""
  });
}

app.get("/", (req, res) => res.redirect("/admin"));

app.get("/admin", (req, res) => {
  renderAdmin(res, { authenticated: isAuthenticated(req) });
});

app.post("/admin/login", (req, res) => {
  if (!ADMIN_PASSWORD || req.body.password !== ADMIN_PASSWORD) {
    return renderAdmin(res, {
      authenticated: false,
      warnings: ["パスワードが違うか、ADMIN_PASSWORDが未設定です。"]
    });
  }
  res.setHeader("Set-Cookie", `admin_auth=${encodeURIComponent(buildAuthToken())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
  return res.redirect("/admin");
});

app.post("/admin/logout", (req, res) => {
  res.setHeader("Set-Cookie", "admin_auth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  res.redirect("/admin");
});

async function handleAdminAction(req, res, mode) {
  const form = {
    lp_url: normalizeUrl(req.body.lp_url || req.body.campaign_id || ""),
    destination_type: String(req.body.destination_type || "track").trim(),
    channel: String(req.body.channel || "sms").trim(),
    pasted_rows: String(req.body.pasted_rows || "")
  };
  const warnings = [];
  let results = [];

  try {
    const pastedRows = parsePastedRows(form.pasted_rows);
    if (!pastedRows.length) warnings.push("貼り付けデータが空です。");
    const lookupResults = mode === "generate" || mode === "send" ? {} : await lookupCandidates(pastedRows);
    results = prepareRows({
      pastedRows,
      lookupResults,
      campaignId: buildCampaignIdFromLpUrl(form.lp_url),
      lpUrl: form.lp_url,
      channel: form.channel,
      destinationType: form.destination_type,
      requireMessage: true
    });

    if (mode === "generate") {
      const linkRows = results.filter((row) => !row.errors.length).map(toLinkIndexRow);
      if (linkRows.length) {
        try {
          await postToGas("recordLinkIndexBatch", { rows: linkRows });
        } catch (error) {
          warnings.push(`LinkIndex保存に失敗しました。リンク生成自体は完了しています: ${error.message}`);
        }
      }
    }

    if (mode === "send") {
      const linkRows = results.filter((row) => !row.errors.length).map(toLinkIndexRow);
      if (linkRows.length) {
        try {
          await postToGas("recordLinkIndexBatch", { rows: linkRows });
        } catch (error) {
          warnings.push(`LinkIndex保存に失敗しました。SMS送信は継続します: ${error.message}`);
        }
      }

      const sendLogs = [];
      for (const row of results) {
        const sendResult = await sendOneSms(row);
        row.twilio_sid = sendResult.twilio_sid || "";
        row.twilio_status = sendResult.twilio_status || "";
        row.send_error_message = sendResult.error_message || "";
        sendLogs.push(toSendLogRow(row, sendResult));
      }

      try {
        await postToGas("recordSendLogsBatch", { rows: sendLogs });
      } catch (error) {
        warnings.push(`SendLogs保存に失敗しました。送信結果を画面で確認してください: ${error.message}`);
      }
    }
  } catch (error) {
    warnings.push(error.message);
  }

  return renderAdmin(res, {
    authenticated: true,
    form,
    results,
    warnings,
    mode
  });
}

app.post("/admin/generate", requireAdmin, (req, res) => handleAdminAction(req, res, "generate"));
app.post("/admin/dry-run", requireAdmin, (req, res) => handleAdminAction(req, res, "dry-run"));
app.post("/admin/send", requireAdmin, (req, res) => handleAdminAction(req, res, "send"));

function buildAnswerUrl(query, answer) {
  const params = new URLSearchParams({
    mode: "answer",
    k: query.k || "",
    cid: query.cid || "",
    l: query.l || "",
    ch: query.ch || "",
    d: query.d || "",
    ans: answer,
    sig: query.sig || ""
  });
  return `${GAS_WEBAPP_URL}?${params.toString()}`;
}

app.get("/lp/reply", (req, res) => {
  res.render("reply_lp", {
    gasConfigured: Boolean(GAS_WEBAPP_URL),
    answers: [
      ["now", "今すぐ転職したい"],
      ["good", "良い求人があれば話を聞きたい"],
      ["view", "求人だけ見たい"],
      ["later", "今は不要"],
      ["stop", "配信停止したい"]
    ].map(([value, label]) => ({ value, label, url: buildAnswerUrl(req.query, value) }))
  });
});

app.get("/lp/call", (req, res) => {
  res.render("call_lp", {
    gasConfigured: Boolean(GAS_WEBAPP_URL),
    answers: [
      ["call_today", "今日中に電話してほしい"],
      ["call_tomorrow_am", "明日の午前に電話してほしい"],
      ["call_tomorrow_pm", "明日の午後に電話してほしい"],
      ["line", "まずはLINEで相談したい"],
      ["later", "今は不要"]
    ].map(([value, label]) => ({ value, label, url: buildAnswerUrl(req.query, value) }))
  });
});

function renderDriverConciergeBLp(req, res, publicTrackingCode) {
  const clickedPathKey = getClickedPathKey(req.path);
  const jobsUrl = `https://driver-concierge.jp/b/form/?utm_campaign=${encodeURIComponent(clickedPathKey)}`;
  res.render("lp_b", {
    publicTrackingCode: publicTrackingCode || "",
    clickedPathKey,
    jobsUrl
  });
}

app.get(["/b", "/b/"], (req, res) => {
  renderDriverConciergeBLp(req, res, "");
});

app.get("/b/:publicTrackingCode", async (req, res) => {
  await recordPublicClick(req, req.params.publicTrackingCode);
  renderDriverConciergeBLp(req, res, req.params.publicTrackingCode);
});

app.listen(PORT, () => {
  console.log(`Past lead SMS tracking MVP listening on port ${PORT}`);
});
