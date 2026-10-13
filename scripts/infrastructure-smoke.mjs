import '../server/load-env.mjs';
import { randomUUID } from 'node:crypto';
import OSS from 'ali-oss';
import pg from 'pg';

const { Pool } = pg;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`缺少 ${name}`);
  return value;
}

async function checkDatabase() {
  const pool = new Pool({
    connectionString: required('DATABASE_URL'),
    max: 1,
    ssl: process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : false
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('CREATE TEMP TABLE lexue_smoke_test(id text PRIMARY KEY, value text NOT NULL)');
    await client.query('INSERT INTO lexue_smoke_test(id,value) VALUES($1,$2)', ['write-check', 'ok']);
    const result = await client.query('SELECT value, current_database() database, current_user username, current_setting($1) version FROM lexue_smoke_test WHERE id=$2', ['server_version', 'write-check']);
    if (result.rows[0]?.value !== 'ok') throw new Error('数据库临时写入校验失败');
    await client.query('ROLLBACK');
    return { database: result.rows[0].database, username: result.rows[0].username, version: result.rows[0].version };
  } finally {
    client.release();
    await pool.end();
  }
}

async function checkOss() {
  const client = new OSS({
    region: required('OSS_REGION'),
    bucket: required('OSS_BUCKET'),
    accessKeyId: required('OSS_ACCESS_KEY_ID'),
    accessKeySecret: required('OSS_ACCESS_KEY_SECRET'),
    endpoint: process.env.OSS_ENDPOINT?.trim() || undefined,
    internal: process.env.OSS_INTERNAL === 'true',
    secure: true
  });
  const prefix = (process.env.OSS_TTS_PREFIX?.trim() || 'lexue/tts/').replace(/^\/+|\/+$/g, '');
  const key = `${prefix}/healthchecks/${randomUUID()}.txt`;
  const marker = `lexue-oss-smoke-${randomUUID()}`;
  let uploaded = false;
  try {
    await client.put(key, Buffer.from(marker));
    uploaded = true;
    const result = await client.get(key);
    if (Buffer.from(result.content).toString() !== marker) throw new Error('OSS 读取内容与写入内容不一致');
    return { readWrite: true, keyPrefix: `${prefix}/` };
  } finally {
    if (uploaded) await client.delete(key);
  }
}

const [database, oss] = await Promise.all([checkDatabase(), checkOss()]);
console.log(JSON.stringify({ ok: true, database, oss }, null, 2));
