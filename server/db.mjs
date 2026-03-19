import dotenv from 'dotenv';
import { resolve } from 'node:path';
import pg from 'pg';

dotenv.config({ path: resolve(process.cwd(), '.env.server') });
dotenv.config();

const { Pool } = pg;

function shouldUseSsl(connectionString) {
  const explicit = String(process.env.DB_SSL || '').trim().toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  if (!connectionString) return false;
  return /supabase\.(co|net)/i.test(connectionString);
}

function buildDbConfig() {
  const connectionString = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || '';
  const max = Number(process.env.DB_POOL_MAX || 10);
  const ssl = shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined;

  if (connectionString) {
    return {
      connectionString,
      max,
      ...(ssl ? { ssl } : {})
    };
  }

  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'postgres',
    max,
    ...(ssl ? { ssl } : {})
  };
}

function toPgQuery(sql, params) {
  const values = Array.isArray(params) ? params : [];
  if (!values.length) return { text: sql, values };
  let index = 0;
  const text = sql.replace(/\?/g, () => `$${++index}`);
  return { text, values };
}

function createDbPool() {
  const pool = new Pool(buildDbConfig());
  return {
    async query(sql, params) {
      const { text, values } = toPgQuery(sql, params);
      const result = await pool.query(text, values);
      return [result.rows];
    },
    async end() {
      await pool.end();
    }
  };
}

export { createDbPool, toPgQuery };
