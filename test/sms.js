'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'invest-osmotr-sms-'));

const sms = require('../lib/sms');

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL: ' + msg);
    failures++;
    return false;
  }
  console.log('ok   ' + msg);
  return true;
}

function reload(env) {
  for (const k of Object.keys(process.env)) {
    if (/^(SMS_|SMSRU_|SMSC_)/.test(k)) delete process.env[k];
  }
  Object.assign(process.env, env);
  delete require.cache[require.resolve('../lib/sms')];
  return require('../lib/sms');
}

function mockServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (b) => { body += b.toString(); });
      req.on('end', () => {
        const reply = handler(body, req);
        res.writeHead(reply.status || 200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(reply.body));
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: 'http://127.0.0.1:' + srv.address().port }));
  });
}

(async () => {
  // ---------------------------------------------------------------- SMS.RU ok
  let seen = '';
  let m = await mockServer((body) => {
    seen = body;
    return { body: { status: 'OK', sms: { '79514476815': { status: 'OK', sms_id: '1000000000000000123' } } } };
  });
  let client = reload({ SMS_PROVIDER: 'smsru', SMSRU_API_ID: 'API-ID-TEST', SMSRU_URL: m.url });
  assert(client.providerStatus().mode === 'smsru', 'smsru provider is selected');
  assert(client.providerStatus().configured, 'smsru is configured when API id is present');
  let msg = await client.send({ to: '+7 951 447-68-15', text: 'Тест SMS.RU', taskId: 1, kind: 'task' });
  assert(msg.status === 'sent', 'smsru message is reported as sent');
  assert(msg.receiptId === '1000000000000000123', 'smsru receipt id is stored');
  const params = new URLSearchParams(seen);
  assert(params.get('api_id') === 'API-ID-TEST', 'smsru request carries the API id');
  assert(params.get('to') === '79514476815', 'smsru request carries the normalized phone');
  assert(params.get('msg') === 'Тест SMS.RU', 'smsru request carries the message text');
  assert(params.get('json') === '1', 'smsru request asks for JSON');
  m.srv.close();

  // ------------------------------------------------------------ SMS.RU error
  m = await mockServer(() => ({
    body: { status: 'ERROR', status_code: '201', status_text: 'Недостаточно средств' },
  }));
  client = reload({ SMS_PROVIDER: 'smsru', SMSRU_API_ID: 'API-ID-TEST', SMSRU_URL: m.url });
  msg = await client.send({ to: '+7 951 447-68-15', text: 'Тест', kind: 'task' });
  assert(msg.status === 'failed', 'smsru rejection marks the message as failed');
  assert(/Недостаточно средств/.test(msg.error), 'smsru rejection text is kept');
  m.srv.close();

  // ---------------------------------------------------------------- SMSC ok
  seen = '';
  m = await mockServer((body) => {
    seen = body;
    return { body: { id: 42, cnt: 1 } };
  });
  client = reload({
    SMS_PROVIDER: 'smsc',
    SMSC_LOGIN: 'invest',
    SMSC_PASSWORD: 'secret',
    SMSC_SENDER: 'INVEST',
    SMSC_URL: m.url,
  });
  assert(client.providerStatus().mode === 'smsc', 'smsc provider is selected');
  msg = await client.send({ to: '89514476815', text: 'Тест SMSC', kind: 'submitted' });
  assert(msg.status === 'sent' && msg.receiptId === '42', 'smsc message is sent with its id as receipt');
  const sp = new URLSearchParams(seen);
  assert(sp.get('login') === 'invest' && sp.get('psw') === 'secret', 'smsc request carries credentials');
  assert(sp.get('phones') === '79514476815', 'smsc request carries the normalized phone');
  assert(sp.get('mes') === 'Тест SMSC', 'smsc request carries the message text');
  assert(sp.get('charset') === 'utf-8' && sp.get('fmt') === '3', 'smsc request asks for UTF-8 JSON');
  assert(sp.get('sender') === 'INVEST', 'smsc request carries the sender name');
  m.srv.close();

  // -------------------------------------------------------------- SMSC error
  m = await mockServer(() => ({ body: { error: 'Неверный логин или пароль', error_code: 2 } }));
  client = reload({ SMS_PROVIDER: 'smsc', SMSC_LOGIN: 'invest', SMSC_PASSWORD: 'bad', SMSC_URL: m.url });
  msg = await client.send({ to: '79514476815', text: 'Тест', kind: 'task' });
  assert(msg.status === 'failed' && /Неверный логин/.test(msg.error), 'smsc error text is kept');
  m.srv.close();

  // --------------------------------------------------- missing configuration
  client = reload({ SMS_PROVIDER: 'smsru' });
  assert(!client.providerStatus().configured, 'smsru without API id is reported as not configured');
  assert(/SMSRU_API_ID/.test(client.providerStatus().reason), 'missing SMSRU_API_ID is named');
  msg = await client.send({ to: '79514476815', text: 'Тест', kind: 'task' });
  assert(msg.status === 'failed' && /SMSRU_API_ID/.test(msg.error),
    'sending without SMSRU_API_ID fails with an explicit reason');

  client = reload({ SMS_PROVIDER: 'smsc' });
  msg = await client.send({ to: '79514476815', text: 'Тест', kind: 'task' });
  assert(msg.status === 'failed' && /SMSC_LOGIN/.test(msg.error), 'sending without SMSC credentials fails explicitly');

  // ------------------------------------------------------------- local mode
  client = reload({ SMS_PROVIDER: 'local' });
  assert(client.providerStatus().mode === 'local', 'local mode stays available for demos');

  console.log('');
  if (failures) {
    console.error(failures + ' TEST(S) FAILED');
    process.exit(1);
  }
  console.log('SMS TESTS PASSED');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
