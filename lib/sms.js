'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const OUTBOX = path.join(db.DATA_DIR, 'sms-outbox.log');
const LOCAL_TOKEN = 'invest-osmotr-local-gateway';

function normalizePhone(v) {
  let d = String(v || '').replace(/[^\d]/g, '');
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return d;
}

function prettyPhone(d) {
  const s = normalizePhone(d);
  if (s.length !== 11) return s;
  return `+${s[0]} ${s.slice(1, 4)} ${s.slice(4, 7)}-${s.slice(7, 9)}-${s.slice(9, 11)}`;
}

function gatewayConfig() {
  const provider = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  const url = String(process.env.SMS_GATEWAY_URL || '').trim();
  const token = String(process.env.SMS_GATEWAY_TOKEN || '').trim();
  if (provider === 'console') return { kind: 'console', provider: 'console', url: '', token };
  if (provider === 'smsru' || provider === 'sms.ru') {
    return {
      kind: 'smsru',
      provider: 'smsru',
      url: String(process.env.SMSRU_URL || 'https://sms.ru/sms/send').trim(),
      token: String(process.env.SMSRU_API_ID || '').trim(),
    };
  }
  if (provider === 'smsc' || provider === 'smsc.ru') {
    return {
      kind: 'smsc',
      provider: 'smsc',
      url: String(process.env.SMSC_URL || 'https://smsc.ru/sys/send.php').trim(),
      token: '',
      login: String(process.env.SMSC_LOGIN || '').trim(),
      password: String(process.env.SMSC_PASSWORD || '').trim(),
      sender: String(process.env.SMSC_SENDER || '').trim(),
    };
  }
  if (provider === 'http' || (!provider && url)) {
    return { kind: 'http', provider: provider === 'http' ? 'http' : 'http-gateway', url, token };
  }
  return {
    kind: 'local',
    provider: 'local',
    url: String(process.env.SMS_LOCAL_GATEWAY_URL || '').trim()
      || `http://127.0.0.1:${process.env.PORT || 4173}/api/sms/gateway`,
    token: token || LOCAL_TOKEN,
  };
}

function providerStatus() {
  const cfg = gatewayConfig();
  const labels = {
    local: 'встроенный HTTP-шлюз сервиса',
    http: 'внешний SMS-провайдер по HTTP',
    'http-gateway': 'внешний SMS-провайдер по HTTP',
    console: 'журнал сервера (console)',
    smsru: 'SMS.RU (sms.ru)',
    smsc: 'SMSC (smsc.ru)',
  };
  let reason = '';
  if (cfg.kind === 'smsru' && !cfg.token) reason = 'не задан SMSRU_API_ID';
  if (cfg.kind === 'smsc' && (!cfg.login || !cfg.password)) reason = 'не заданы SMSC_LOGIN и SMSC_PASSWORD';
  return {
    configured: !reason,
    provider: cfg.provider,
    mode: cfg.kind,
    url: cfg.kind === 'console' ? '' : cfg.url,
    label: labels[cfg.provider] || cfg.provider,
    reason,
  };
}

function gatewayTokenMatches(given) {
  const expected = String(process.env.SMS_GATEWAY_TOKEN || '').trim() || LOCAL_TOKEN;
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

async function deliver(msg) {
  const cfg = gatewayConfig();
  if (cfg.kind === 'console') {
    console.log(`[sms → ${msg.toPretty}] ${msg.text}`);
    return { status: 'sent', provider: 'console', receiptId: 'console-' + msg.id, error: '' };
  }
  if (cfg.kind === 'smsru') return deliverSmsRu(cfg, msg);
  if (cfg.kind === 'smsc') return deliverSmsc(cfg, msg);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sms-token': cfg.token,
      },
      body: JSON.stringify({
        messageId: msg.id,
        to: msg.to,
        text: msg.text,
        taskId: msg.taskId,
        kind: msg.kind,
      }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      return {
        status: 'failed',
        provider: cfg.provider,
        receiptId: '',
        error: data.error || 'Шлюз ответил HTTP ' + res.status,
      };
    }
    return {
      status: 'sent',
      provider: cfg.provider,
      receiptId: data.receiptId || null,
      error: '',
    };
  } catch (e) {
    return {
      status: 'failed',
      provider: cfg.provider,
      receiptId: '',
      error: e && e.name === 'AbortError' ? 'Шлюз не ответил за 8 секунд' : String((e && e.message) || e),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function deliverSmsRu(cfg, msg) {
  if (!cfg.token) {
    return { status: 'failed', provider: 'smsru', receiptId: '', error: 'не задан SMSRU_API_ID' };
  }
  const params = new URLSearchParams({
    api_id: cfg.token,
    to: msg.to,
    msg: msg.text,
    json: '1',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    const entry = data && data.sms && Object.values(data.sms)[0];
    if (data && data.status === 'OK') {
      const ok = entry && entry.status === 'OK';
      return {
        status: ok ? 'sent' : 'failed',
        provider: 'smsru',
        receiptId: (entry && entry.sms_id) || null,
        error: ok ? '' : (entry && entry.status_text) || 'SMS.RU отклонил сообщение',
      };
    }
    return {
      status: 'failed',
      provider: 'smsru',
      receiptId: '',
      error: (data && data.status_text) || 'SMS.RU ответил HTTP ' + res.status,
    };
  } catch (e) {
    return {
      status: 'failed',
      provider: 'smsru',
      receiptId: '',
      error: e && e.name === 'AbortError' ? 'SMS.RU не ответил за 10 секунд' : String((e && e.message) || e),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function deliverSmsc(cfg, msg) {
  if (!cfg.login || !cfg.password) {
    return { status: 'failed', provider: 'smsc', receiptId: '', error: 'не заданы SMSC_LOGIN и SMSC_PASSWORD' };
  }
  const params = new URLSearchParams({
    login: cfg.login,
    psw: cfg.password,
    phones: msg.to,
    mes: msg.text,
    fmt: '3',
    charset: 'utf-8',
  });
  if (cfg.sender) params.set('sender', cfg.sender);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (data && data.id) {
      return { status: 'sent', provider: 'smsc', receiptId: String(data.id), error: '' };
    }
    return {
      status: 'failed',
      provider: 'smsc',
      receiptId: '',
      error: (data && data.error) || (data && data.error_code ? 'SMSC код ' + data.error_code : 'SMSC ответил HTTP ' + res.status),
    };
  } catch (e) {
    return {
      status: 'failed',
      provider: 'smsc',
      receiptId: '',
      error: e && e.name === 'AbortError' ? 'SMSC не ответил за 10 секунд' : String((e && e.message) || e),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function send({ to, text, taskId, kind }) {
  const phone = normalizePhone(to);
  const store = db.load();
  const msg = {
    id: (store.sms.length || 0) + 1,
    to: phone,
    toPretty: prettyPhone(phone),
    text,
    taskId: taskId || null,
    kind: kind || 'link',
    status: 'sending',
    provider: gatewayConfig().provider,
    receiptId: null,
    error: '',
    at: new Date().toISOString(),
    deliveredAt: null,
  };
  store.sms.push(msg);
  db.save();

  const result = await deliver(msg);
  Object.assign(msg, result);
  msg.deliveredAt = result.status === 'sent' ? new Date().toISOString() : null;

  db.save();
  try {
    fs.appendFileSync(
      OUTBOX,
      `[${msg.at}] ${msg.toPretty} (${msg.status}, ${msg.provider}${msg.receiptId ? ', ' + msg.receiptId : ''})\n${text}\n${'-'.repeat(60)}\n`,
      'utf8'
    );
  } catch {}
  return msg;
}

function acceptAtGateway({ to, text, messageId, taskId, kind }) {
  const phone = normalizePhone(to);
  if (phone.length !== 11) return { ok: false, error: 'Некорректный номер получателя' };
  if (!String(text || '').trim()) return { ok: false, error: 'Пустой текст сообщения' };
  const store = db.load();
  store.smsReceipts ||= [];
  const receipt = {
    id: store.smsReceipts.length + 1,
    messageId: messageId || null,
    taskId: taskId || null,
    kind: kind || 'link',
    to: phone,
    toPretty: prettyPhone(phone),
    text: String(text),
    acceptedAt: new Date().toISOString(),
  };
  store.smsReceipts.push(receipt);
  db.save();
  return { ok: true, receiptId: 'gw-' + receipt.id, acceptedAt: receipt.acceptedAt };
}

function notify(store, userId, { title, text, kind = 'info', taskId = null }) {
  const n = {
    id: store.notifications.length + 1,
    userId,
    title,
    text,
    kind,
    taskId,
    read: false,
    at: new Date().toISOString(),
  };
  store.notifications.push(n);
  return n;
}

function unreadCount(store, userId) {
  return store.notifications.filter((n) => n.userId === userId && !n.read).length;
}

module.exports = {
  send,
  notify,
  unreadCount,
  normalizePhone,
  prettyPhone,
  providerStatus,
  gatewayConfig,
  gatewayTokenMatches,
  acceptAtGateway,
  OUTBOX,
};
