const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, '../data/volog.db');
let _sqlDb = null;
let db = null;

function saveDb() {
  if (!_sqlDb) return;
  const data = _sqlDb.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

setInterval(() => { if (_sqlDb) saveDb(); }, 10000);

function wrapDb(sqlDb) {
  return {
    prepare(sql) {
      return {
        run(...params) {
          sqlDb.run(sql, params);
          const rows = sqlDb.exec('SELECT last_insert_rowid() as id');
          const lastInsertRowid = rows[0] ? rows[0].values[0][0] : 0;
          saveDb();
          return { lastInsertRowid, changes: 1 };
        },
        get(...params) {
          const stmt = sqlDb.prepare(sql);
          stmt.bind(params);
          if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
          stmt.free();
          return undefined;
        },
        all(...params) {
          const results = [];
          const stmt = sqlDb.prepare(sql);
          stmt.bind(params);
          while (stmt.step()) results.push(stmt.getAsObject());
          stmt.free();
          return results;
        }
      };
    },
    exec(sql) { return sqlDb.exec(sql); },
    pragma() {},
    close() { sqlDb.close(); }
  };
}

async function initDb() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    _sqlDb = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    _sqlDb = new SQL.Database();
  }
  _sqlDb.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      avatar_color TEXT DEFAULT '#2e7d4f',
      is_admin INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      system TEXT DEFAULT 'D&D 5e',
      cover_color TEXT DEFAULT '#1e1b4b',
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      number INTEGER DEFAULT 1,
      title TEXT,
      date TEXT,
      raw_notes TEXT,
      summary TEXT,
      narrative TEXT,
      ai_generated INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      campaign_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      role TEXT DEFAULT 'pj',
      description TEXT,
      notes TEXT,
      avatar_letter TEXT,
      avatar_color TEXT DEFAULT '#2e7d4f'
    );
    CREATE TABLE IF NOT EXISTS session_characters (
      session_id INTEGER, character_id INTEGER,
      PRIMARY KEY (session_id, character_id)
    );
    CREATE TABLE IF NOT EXISTS api_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token TEXT UNIQUE NOT NULL,
      label TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vtt_rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      campaign_id INTEGER,
      grid_size INTEGER DEFAULT 50,
      system TEXT,
      map_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS vtt_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      x INTEGER DEFAULT 0,
      y INTEGER DEFAULT 0,
      color TEXT DEFAULT '#4aab72',
      hp INTEGER,
      hp_max INTEGER,
      img_url TEXT,
      width INTEGER DEFAULT 50,
      height INTEGER DEFAULT 50,
      initiative INTEGER DEFAULT 0,
      is_visible INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS vtt_maps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      filename TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sw_characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      assigned_user_id INTEGER,
      campaign_id INTEGER,
      name TEXT NOT NULL,
      race TEXT,
      concept TEXT,
      rank TEXT DEFAULT 'Novice',
      agilite INTEGER DEFAULT 6,
      astuce INTEGER DEFAULT 6,
      esprit INTEGER DEFAULT 6,
      force INTEGER DEFAULT 6,
      vigueur INTEGER DEFAULT 6,
      system TEXT DEFAULT 'Savage Worlds',
      skills TEXT DEFAULT '[]',
      edges TEXT DEFAULT '[]',
      hindrances TEXT DEFAULT '[]',
      gear TEXT DEFAULT '[]',
      powers TEXT DEFAULT '[]',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);


  // Migrations
  const migrations = [
    "ALTER TABLE cpr_characters ADD COLUMN role TEXT DEFAULT 'Solo'",
    "ALTER TABLE vtt_rooms ADD COLUMN system TEXT",
    "ALTER TABLE sw_characters ADD COLUMN assigned_user_id INTEGER",
    "ALTER TABLE sw_characters ADD COLUMN system TEXT DEFAULT 'Savage Worlds'",
    "ALTER TABLE sw_characters ADD COLUMN skills TEXT DEFAULT '[]'",
    "ALTER TABLE sw_characters ADD COLUMN edges TEXT DEFAULT '[]'",
    "ALTER TABLE sw_characters ADD COLUMN hindrances TEXT DEFAULT '[]'",
    "ALTER TABLE sw_characters ADD COLUMN gear TEXT DEFAULT '[]'",
    "ALTER TABLE sw_characters ADD COLUMN powers TEXT DEFAULT '[]'",
    "ALTER TABLE sw_characters ADD COLUMN notes TEXT",
    "ALTER TABLE sw_characters ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP",
  ];
  for (const sql of migrations) {
    try { _sqlDb.run(sql); } catch(e) {}
  }

  db = wrapDb(_sqlDb);
  saveDb();
  return db;
}

function getDb() {
  if (!db) throw new Error('DB non initialisée');
  return db;
}

module.exports = { getDb, initDb };
