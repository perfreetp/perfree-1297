import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || './data/culture_center.db';

const db = new Database(path.resolve(dbPath));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('数据库连接成功');

export const run = (sql: string, params: any[] = []): number => {
  const stmt = db.prepare(sql);
  const result = stmt.run(...params);
  return Number(result.lastInsertRowid);
};

export const get = <T = any>(sql: string, params: any[] = []): T | undefined => {
  const stmt = db.prepare(sql);
  const row = stmt.get(...params);
  return row as T | undefined;
};

export const all = <T = any>(sql: string, params: any[] = []): T[] => {
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params);
  return rows as T[];
};

export const exec = (sql: string): void => {
  db.exec(sql);
};

export { db };
export default db;
