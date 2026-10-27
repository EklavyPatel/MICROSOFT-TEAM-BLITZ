import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
export function openDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, created INTEGER NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS expired_rooms (code TEXT PRIMARY KEY, forget_after INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY, room TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      session TEXT NOT NULL, nickname TEXT NOT NULL, joined INTEGER NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, host INTEGER NOT NULL DEFAULT 0,
      UNIQUE(room, session)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS one_host ON participants(room) WHERE host = 1;
    CREATE INDEX IF NOT EXISTS participant_room ON participants(room, active, joined);
    CREATE TABLE IF NOT EXISTS plans (room TEXT PRIMARY KEY REFERENCES rooms(code) ON DELETE CASCADE,
      show TEXT NOT NULL, watch_at TEXT, note TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS votes (participant TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
      answer TEXT NOT NULL CHECK(answer IN ('yes','no')));
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, room TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
      participant TEXT NOT NULL REFERENCES participants(id), text TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS messages_room ON messages(room, created, id);
    CREATE TABLE IF NOT EXISTS quizzes (id TEXT PRIMARY KEY, room TEXT NOT NULL UNIQUE REFERENCES rooms(code) ON DELETE CASCADE,
      questions TEXT NOT NULL, answer_key TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS submissions (participant TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      quiz TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE, answers TEXT NOT NULL, points INTEGER NOT NULL,
      PRIMARY KEY(participant, quiz));
    CREATE TABLE IF NOT EXISTS announcements (room TEXT PRIMARY KEY REFERENCES rooms(code) ON DELETE CASCADE,
      text TEXT NOT NULL, published INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS screens (room TEXT PRIMARY KEY REFERENCES rooms(code) ON DELETE CASCADE,
      id TEXT NOT NULL UNIQUE, title TEXT NOT NULL, url TEXT NOT NULL, duration REAL NOT NULL,
      position REAL NOT NULL DEFAULT 0, playing INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL, finished INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS attendance (participant TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      screen TEXT NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
      seconds REAL NOT NULL DEFAULT 0, heartbeat INTEGER, PRIMARY KEY(participant, screen));
    CREATE TABLE IF NOT EXISTS watch_awards (participant TEXT PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
      points INTEGER NOT NULL DEFAULT 5, awarded INTEGER NOT NULL);
    PRAGMA user_version = 1;
  `);
  return db;
}
export function transaction(db, callback) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = callback(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function cleanup(db, now) {
  transaction(db, () => {
    db.prepare('INSERT OR IGNORE INTO expired_rooms SELECT code, expires + ? FROM rooms WHERE expires <= ?').run(7 * 86400000, now);
    db.prepare('DELETE FROM rooms WHERE expires <= ?').run(now);
    db.prepare('DELETE FROM expired_rooms WHERE forget_after <= ?').run(now);
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now);
  });
}
