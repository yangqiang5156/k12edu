import pg from 'pg';

const { Pool } = pg;

const schema = `
CREATE TABLE IF NOT EXISTS families (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS parent_users (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL DEFAULT '家长',
  is_admin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);
CREATE TABLE IF NOT EXISTS children (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name text NOT NULL,
  birth_year smallint,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS devices (
  id text PRIMARY KEY,
  family_id uuid REFERENCES families(id) ON DELETE SET NULL,
  label text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_ip text,
  user_agent text
);
CREATE TABLE IF NOT EXISTS account_limits (
  family_id uuid PRIMARY KEY REFERENCES families(id) ON DELETE CASCADE,
  tts_daily_limit integer NOT NULL DEFAULT 300,
  ai_daily_limit integer NOT NULL DEFAULT 20,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cloud_snapshots (
  child_id uuid PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
  version bigint NOT NULL DEFAULT 0,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS usage_daily (
  usage_date date NOT NULL,
  scope_type text NOT NULL CHECK (scope_type IN ('device', 'family')),
  scope_id text NOT NULL,
  family_id uuid REFERENCES families(id) ON DELETE CASCADE,
  device_id text REFERENCES devices(id) ON DELETE SET NULL,
  tts_requests integer NOT NULL DEFAULT 0,
  tts_upstream integer NOT NULL DEFAULT 0,
  tts_cache_hits integer NOT NULL DEFAULT 0,
  tts_characters bigint NOT NULL DEFAULT 0,
  tts_upstream_characters bigint NOT NULL DEFAULT 0,
  ai_requests integer NOT NULL DEFAULT 0,
  ai_tokens bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, scope_type, scope_id)
);
CREATE TABLE IF NOT EXISTS global_usage_daily (
  usage_date date PRIMARY KEY,
  tts_requests integer NOT NULL DEFAULT 0,
  tts_upstream integer NOT NULL DEFAULT 0,
  tts_cache_hits integer NOT NULL DEFAULT 0,
  tts_characters bigint NOT NULL DEFAULT 0,
  tts_upstream_characters bigint NOT NULL DEFAULT 0,
  ai_requests integer NOT NULL DEFAULT 0,
  ai_tokens bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS published_content_packs (
  id text NOT NULL,
  content_version text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  data jsonb NOT NULL,
  created_by uuid REFERENCES parent_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, content_version)
);
CREATE TABLE IF NOT EXISTS system_alerts (
  alert_key text PRIMARY KEY,
  kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('warning', 'critical')),
  message text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS family_stories (
  id uuid PRIMARY KEY,
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  child_id uuid NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  created_by uuid REFERENCES parent_users(id) ON DELETE SET NULL,
  title text NOT NULL,
  summary text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('kindergarten', 'primary-lower', 'primary-upper')),
  age_min smallint NOT NULL CHECK (age_min BETWEEN 3 AND 12),
  age_max smallint NOT NULL CHECK (age_max BETWEEN 3 AND 12),
  themes text[] NOT NULL DEFAULT '{}',
  paragraphs jsonb NOT NULL,
  duration_minutes smallint NOT NULL DEFAULT 5 CHECK (duration_minutes IN (3,5,8)),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','audio_queued','audio_generating','ready','published','failed','archived')),
  content_version text NOT NULL,
  audio_version text,
  audio_object_key text,
  audio_duration_seconds integer,
  audio_model text,
  audio_voice text,
  cues jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
CREATE TABLE IF NOT EXISTS story_audio_jobs (
  id uuid PRIMARY KEY,
  story_id uuid NOT NULL UNIQUE REFERENCES family_stories(id) ON DELETE CASCADE,
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES parent_users(id) ON DELETE SET NULL,
  device_id text REFERENCES devices(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','completed','failed')),
  completed_sentences integer NOT NULL DEFAULT 0,
  total_sentences integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS story_generation_daily (
  usage_date date NOT NULL DEFAULT current_date,
  family_id uuid NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  generations integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_date, family_id)
);
ALTER TABLE usage_daily ADD COLUMN IF NOT EXISTS tts_upstream_characters bigint NOT NULL DEFAULT 0;
ALTER TABLE global_usage_daily ADD COLUMN IF NOT EXISTS tts_upstream_characters bigint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_children_family ON children(family_id);
CREATE INDEX IF NOT EXISTS idx_devices_family ON devices(family_id);
CREATE INDEX IF NOT EXISTS idx_usage_family_date ON usage_daily(family_id, usage_date DESC);
CREATE INDEX IF NOT EXISTS idx_content_packs_status ON published_content_packs(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_family_stories_family ON family_stories(family_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_family_stories_child_status ON family_stories(child_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_story_audio_jobs_status ON story_audio_jobs(status, updated_at);
`;

export function createDatabase(env = process.env) {
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) {
    return {
      configured: false,
      query: async () => { const error = new Error('云端数据库尚未配置'); error.status = 503; throw error; },
      transaction: async () => { const error = new Error('云端数据库尚未配置'); error.status = 503; throw error; },
      health: async () => false,
      close: async () => undefined,
    };
  }
  const pool = new Pool({
    connectionString,
    max: Number(env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    ssl: env.DATABASE_SSL === 'true' ? { rejectUnauthorized: env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined,
  });
  return {
    configured: true,
    query: (text, values) => pool.query(text, values),
    transaction: async (callback) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await callback(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally { client.release(); }
    },
    health: async () => { try { await pool.query('SELECT 1'); return true; } catch { return false; } },
    close: () => pool.end(),
    initialize: () => pool.query(schema),
  };
}

export async function initializeDatabase(database, env = process.env) {
  if (!database.configured) {
    if (env.DATABASE_REQUIRED === 'true') throw new Error('DATABASE_REQUIRED=true，但未配置 DATABASE_URL');
    console.warn('未配置 PostgreSQL：仅可使用本地学习，云账号、同步和持久额度统计不可用');
    return;
  }
  await database.initialize();
  console.log('PostgreSQL 数据结构已就绪');
}
