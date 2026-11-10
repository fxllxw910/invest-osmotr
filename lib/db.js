'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const PHOTOS_DIR = path.join(DATA_DIR, 'photos');

let cache = null;

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
}

function load() {
  if (cache) return cache;
  ensureDirs();
  try {
    cache = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    cache = { users: [], sessions: [], objects: [], tasks: [], seq: { user: 0, object: 0, task: 0 } };
  }
  cache.users ||= [];
  cache.sessions ||= [];
  cache.objects ||= [];
  cache.tasks ||= [];
  cache.notifications ||= [];
  cache.sms ||= [];
  cache.smsReceipts ||= [];
  cache.seq ||= { user: 0, object: 0, task: 0 };
  return cache;
}

let writeTimer = null;

function save() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const db = load();
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }, 20);
}

function saveSync() {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  const db = load();
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function nextId(kind) {
  const db = load();
  db.seq[kind] = (db.seq[kind] || 0) + 1;
  return db.seq[kind];
}

module.exports = { load, save, saveSync, nextId, DATA_DIR, PHOTOS_DIR, ensureDirs };
