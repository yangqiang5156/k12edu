import { createRateLimiter } from './rate-limit.mjs';
import { randomUUID } from 'node:crypto';
import { apiError, readJson, requestIp, sendJson } from './http.mjs';
import { bearerToken, createAccessToken, hashPassword, verifyAccessToken, verifyPassword } from './security.mjs';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const devicePattern = /^[a-zA-Z0-9_-]{16,100}$/;
const cleanText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function validateContentPack(pack) {
  if (!pack || pack.schemaVersion !== 1 || !cleanText(pack.id, 100) || !/^[a-zA-Z0-9._-]+$/.test(pack.id)
    || !cleanText(pack.title, 120) || !cleanText(pack.contentVersion, 60) || !Array.isArray(pack.items) || !pack.items.length || pack.items.length > 5000) {
    const error = new Error('内容包格式无效，需包含合法 id、标题、版本和1–5000条内容'); error.status = 400; throw error;
  }
  const ids = new Set();
  for (const item of pack.items) {
    if (!item || !cleanText(item.id, 120) || !cleanText(item.title, 200) || !cleanText(item.module, 20) || !cleanText(item.kind, 30) || ids.has(item.id)) {
      const error = new Error('内容包中存在缺少字段或重复 id 的内容'); error.status = 400; throw error;
    }
    ids.add(item.id);
  }
  return pack;
}

function publicChild(row) {
  return { id: row.id, name: row.name, birthYear: row.birth_year ?? undefined, updatedAt: row.updated_at };
}

export function createIdentityService(database, env = process.env) {
  const configuredSecret = env.SESSION_SECRET?.trim();
  if ((database.configured || env.DATABASE_REQUIRED === 'true') && (!configuredSecret || configuredSecret.length < 32)) {
    throw new Error('生产环境必须配置至少32字符的 SESSION_SECRET');
  }
  const secret = configuredSecret || randomUUID() + randomUUID();
  if (!env.SESSION_SECRET) console.warn('未配置 SESSION_SECRET，本次重启后已有会话会失效');
  const guestLifetime = Math.min(30, Math.max(1, Number(env.GUEST_SESSION_DAYS || 7))) * 86400;
  const accountLifetime = Math.min(30, Math.max(1, Number(env.ACCOUNT_SESSION_DAYS || 14))) * 86400;
  const rate = createRateLimiter(database);
  const sessions = new Map();
  const checkAuthRate = (req, action, limit) => rate(`auth:${action}:${requestIp(req)}`, limit, 15 * 60_000);
  const tokenFor = async (identity) => {
    const lifetime = identity.type === 'account' ? accountLifetime : guestLifetime;
    const sessionId = randomUUID();
    const expires = new Date(Date.now() + lifetime * 1000);
    if (database.configured) {
      await database.query('DELETE FROM access_sessions WHERE expires_at<now()');
      await database.query("DELETE FROM access_sessions WHERE id IN (SELECT id FROM access_sessions WHERE device_id=$1 ORDER BY expires_at DESC OFFSET 4)", [identity.deviceId]);
      await database.query('INSERT INTO access_sessions(id,user_id,device_id,expires_at) VALUES($1,$2,$3,$4)', [sessionId, identity.userId || null, identity.deviceId, expires]);
    } else {
      for (const [id, end] of sessions) if (end < Date.now()) sessions.delete(id);
      if (sessions.size >= 10000) throw Object.assign(new Error('会话数量达到上限'), { status: 429 });
      sessions.set(sessionId, expires.getTime());
    }
    return createAccessToken({ ...identity, sessionId }, secret, lifetime);
  };

  const authenticate = async (req, options = {}) => {
    const payload = verifyAccessToken(bearerToken(req), secret);
    if (!payload || !['guest', 'account'].includes(payload.type)) {
      const error = new Error('登录状态已失效，请刷新后重试'); error.status = 401; throw error;
    }
    if (!options.allowGuest && payload.type !== 'account') {
      const error = new Error('请先登录家长账号'); error.status = 401; throw error;
    }
    if (!payload.sessionId) throw Object.assign(new Error('请重新登录'), { status: 401 });
    if (!database.configured) {
      if ((sessions.get(payload.sessionId) || 0) <= Date.now()) throw Object.assign(new Error('会话已失效'), { status: 401 });
      return payload;
    }
    const session = await database.query('SELECT id FROM access_sessions WHERE id=$1 AND device_id=$2 AND user_id IS NOT DISTINCT FROM $3 AND expires_at>now()', [payload.sessionId, payload.deviceId, payload.userId || null]);
    if (!session.rows[0]) throw Object.assign(new Error('会话已失效，请重新登录'), { status: 401 });
    const result = payload.type === 'account'
      ? await database.query(`SELECT u.id, u.family_id, u.email, u.is_admin, f.status family_status, d.status device_status
          FROM parent_users u JOIN families f ON f.id=u.family_id
          LEFT JOIN devices d ON d.id=$2 WHERE u.id=$1`, [payload.userId, payload.deviceId])
      : await database.query('SELECT id, status device_status, family_id FROM devices WHERE id=$1', [payload.deviceId]);
    const row = result.rows[0];
    if (!row || row.device_status === 'blocked' || row.family_status === 'blocked') {
      const error = new Error('当前账号或设备已停用'); error.status = 403; throw error;
    }
    return { ...payload, isAdmin: Boolean(row.is_admin), familyId: payload.type === 'account' ? row.family_id : undefined };
  };

  const registerDevice = async (deviceId, req, familyId = null) => {
    if (!devicePattern.test(deviceId)) { const error = new Error('设备标识无效'); error.status = 400; throw error; }
    if (!database.configured) return;
    await database.query(`INSERT INTO devices(id, family_id, last_ip, user_agent)
      VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET
      family_id=COALESCE(EXCLUDED.family_id, devices.family_id), last_seen_at=now(), last_ip=EXCLUDED.last_ip, user_agent=EXCLUDED.user_agent`,
    [deviceId, familyId, requestIp(req), cleanText(req.headers['user-agent'], 500)]);
  };

  const me = async (identity) => {
    if (identity.type !== 'account') return { authenticated: false, deviceId: identity.deviceId };
    const userResult = await database.query(`SELECT u.id, u.email, u.display_name, u.is_admin, f.id family_id, f.name family_name,
      f.paid_enabled, l.tts_daily_limit, l.ai_daily_limit FROM parent_users u JOIN families f ON f.id=u.family_id
      JOIN account_limits l ON l.family_id=f.id WHERE u.id=$1`, [identity.userId]);
    if (!userResult.rows[0]) { const error = new Error('账号不存在'); error.status = 401; throw error; }
    const row = userResult.rows[0];
    const children = await database.query('SELECT * FROM children WHERE family_id=$1 ORDER BY created_at', [row.family_id]);
    return {
      authenticated: true,
      user: { id: row.id, email: row.email, displayName: row.display_name, isAdmin: row.is_admin },
      family: { id: row.family_id, name: row.family_name, paidEnabled: row.paid_enabled },
      limits: { ttsDaily: row.tts_daily_limit, aiDaily: row.ai_daily_limit },
      children: children.rows.map(publicChild),
      deviceId: identity.deviceId,
    };
  };

  const handle = async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const path = url.pathname;
    if (!path.startsWith('/api/session') && !path.startsWith('/api/auth') && !path.startsWith('/api/children') && !path.startsWith('/api/sync') && !path.startsWith('/api/admin') && !path.startsWith('/api/account') && !path.startsWith('/api/content-packs')) return next();
    try {
      if (path === '/api/session/guest' && req.method === 'POST') {
        await checkAuthRate(req, 'guest', 120);
        await rate('auth:global-guests', Number(env.GUEST_GLOBAL_DAILY_SESSION_LIMIT || 10000), 86400000);
        const body = await readJson(req, 4096);
        const deviceId = cleanText(body.deviceId, 100);
        await registerDevice(deviceId, req);
        const identity = { type: 'guest', deviceId };
        return sendJson(res, 200, { token: await tokenFor(identity), expiresIn: guestLifetime, identity });
      }
      if (path === '/api/auth/register' && req.method === 'POST') {
        await checkAuthRate(req, 'register', 10);
        await rate('auth:global-register', Number(env.REGISTRATION_GLOBAL_DAILY_LIMIT || 200), 86400000);
        if (!database.configured) { const error = new Error('家庭账号服务尚未配置'); error.status = 503; throw error; }
        if (env.REGISTRATION_ENABLED === 'false') { const error = new Error('新账号注册暂未开放'); error.status = 403; throw error; }
        const body = await readJson(req, 16 * 1024);
        const email = cleanText(body.email, 254).toLowerCase();
        const password = typeof body.password === 'string' ? body.password : '';
        const childName = cleanText(body.childName, 20) || '乐乐';
        const displayName = cleanText(body.displayName, 40) || '家长';
        const deviceId = cleanText(body.deviceId, 100);
        if (!emailPattern.test(email)) { const error = new Error('请输入有效邮箱'); error.status = 400; throw error; }
        if (password.length < 10 || password.length > 128) { const error = new Error('密码需为10–128个字符'); error.status = 400; throw error; }
        if (!devicePattern.test(deviceId)) { const error = new Error('设备标识无效'); error.status = 400; throw error; }
        const familyId = randomUUID(); const userId = randomUUID(); const childId = randomUUID();
        const passwordHash = await hashPassword(password);
        try {
          await database.transaction(async (client) => {
            await client.query('INSERT INTO families(id,name) VALUES($1,$2)', [familyId, `${childName}的家庭`]);
            await client.query('INSERT INTO parent_users(id,family_id,email,password_hash,display_name,is_admin) VALUES($1,$2,$3,$4,$5,$6)', [userId, familyId, email, passwordHash, displayName, false]);
            await client.query('INSERT INTO children(id,family_id,name) VALUES($1,$2,$3)', [childId, familyId, childName]);
            await client.query('INSERT INTO account_limits(family_id,tts_daily_limit,ai_daily_limit) VALUES($1,$2,$3)', [familyId, Number(env.ACCOUNT_TTS_DAILY_LIMIT || 300), Number(env.ACCOUNT_AI_DAILY_LIMIT || 20)]);
            await client.query(`INSERT INTO devices(id,family_id,last_ip,user_agent) VALUES($1,$2,$3,$4)
              ON CONFLICT(id) DO UPDATE SET family_id=EXCLUDED.family_id,last_seen_at=now(),last_ip=EXCLUDED.last_ip,user_agent=EXCLUDED.user_agent`, [deviceId, familyId, requestIp(req), cleanText(req.headers['user-agent'], 500)]);
          });
        } catch (error) {
          if (error.code === '23505') { error.status = 409; error.message = '该邮箱已经注册'; }
          throw error;
        }
        const identity = { type: 'account', userId, familyId, deviceId };
        return sendJson(res, 201, { token: await tokenFor(identity), expiresIn: accountLifetime, identity, childId, account: await me(identity) });
      }
      if (path === '/api/auth/login' && req.method === 'POST') {
        await checkAuthRate(req, 'login', 20);
        await rate('auth:global-login', 120, 60000);
        const body = await readJson(req, 8192);
        const email = cleanText(body.email, 254).toLowerCase();
        const password = typeof body.password === 'string' ? body.password : '';
        const deviceId = cleanText(body.deviceId, 100);
        if (!devicePattern.test(deviceId)) { const error = new Error('设备标识无效'); error.status = 400; throw error; }
        const result = await database.query(`SELECT u.*, f.status family_status FROM parent_users u JOIN families f ON f.id=u.family_id WHERE u.email=$1`, [email]);
        const user = result.rows[0];
        if (!user || !await verifyPassword(password, user.password_hash)) { const error = new Error('邮箱或密码不正确'); error.status = 401; throw error; }
        if (user.family_status !== 'active') { const error = new Error('家庭账号已停用'); error.status = 403; throw error; }
        await registerDevice(deviceId, req, user.family_id);
        await database.query('UPDATE parent_users SET last_login_at=now() WHERE id=$1', [user.id]);
        const identity = { type: 'account', userId: user.id, familyId: user.family_id, deviceId };
        return sendJson(res, 200, { token: await tokenFor(identity), expiresIn: accountLifetime, identity, account: await me(identity) });
      }
      if (path === '/api/auth/me' && req.method === 'GET') {
        const identity = await authenticate(req, { allowGuest: true });
        return sendJson(res, 200, await me(identity));
      }
      if (path === '/api/auth/logout' && req.method === 'POST') {
        const actor = await authenticate(req, { allowGuest: true });
        if (database.configured) await database.query('DELETE FROM access_sessions WHERE id=$1', [actor.sessionId]);
        else sessions.delete(actor.sessionId);
        return sendJson(res, 200, { ok: true });
      }

      const publicPackMatch = path.match(/^\/api\/content-packs(?:\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+))?$/);
      if (publicPackMatch && req.method === 'GET') {
        await authenticate(req, { allowGuest: true });
        if (publicPackMatch[1]) {
          const result = await database.query(`SELECT data,updated_at FROM published_content_packs WHERE id=$1 AND content_version=$2 AND status='active'`, [publicPackMatch[1], publicPackMatch[2]]);
          if (!result.rows[0]) { const error = new Error('内容包不存在或已下架'); error.status = 404; throw error; }
          return sendJson(res, 200, { pack: result.rows[0].data, updatedAt: result.rows[0].updated_at });
        }
        const result = await database.query(`SELECT id,content_version,title,updated_at FROM published_content_packs WHERE status='active' ORDER BY updated_at DESC LIMIT 200`);
        return sendJson(res, 200, { packs: result.rows.map(row => ({ id: row.id, contentVersion: row.content_version, title: row.title, updatedAt: row.updated_at })) });
      }

      const identity = await authenticate(req);
      if (path === '/api/account/export' && req.method === 'GET') {
        const [family, users, children, snapshots, limits, usage] = await Promise.all([
          database.query('SELECT id,name,status,created_at,updated_at FROM families WHERE id=$1', [identity.familyId]),
          database.query('SELECT id,email,display_name,is_admin,created_at,last_login_at FROM parent_users WHERE family_id=$1', [identity.familyId]),
          database.query('SELECT id,name,birth_year,created_at,updated_at FROM children WHERE family_id=$1', [identity.familyId]),
          database.query('SELECT s.child_id,s.version,s.data,s.updated_at FROM cloud_snapshots s JOIN children c ON c.id=s.child_id WHERE c.family_id=$1', [identity.familyId]),
          database.query('SELECT tts_daily_limit,ai_daily_limit,updated_at FROM account_limits WHERE family_id=$1', [identity.familyId]),
          database.query('SELECT * FROM usage_daily WHERE family_id=$1 ORDER BY usage_date DESC', [identity.familyId]),
        ]);
        return sendJson(res, 200, { exportedAt: new Date().toISOString(), family: family.rows[0], users: users.rows, children: children.rows, snapshots: snapshots.rows, limits: limits.rows[0], usage: usage.rows });
      }
      if (path === '/api/account' && req.method === 'DELETE') {
        const body = await readJson(req, 8192);
        const result = await database.query('SELECT password_hash FROM parent_users WHERE id=$1 AND family_id=$2', [identity.userId, identity.familyId]);
        if (!result.rows[0] || !await verifyPassword(String(body.password || ''), result.rows[0].password_hash)) { const error = new Error('密码不正确，未注销账号'); error.status = 401; throw error; }
        await database.query('DELETE FROM families WHERE id=$1', [identity.familyId]);
        return sendJson(res, 200, { deleted: true });
      }
      if (path === '/api/children' && req.method === 'POST') {
        const body = await readJson(req, 4096);
        const name = cleanText(body.name, 20);
        const birthYear = body.birthYear === undefined ? null : Number(body.birthYear);
        if (!name) { const error = new Error('请输入孩子昵称'); error.status = 400; throw error; }
        if (birthYear !== null && (!Number.isInteger(birthYear) || birthYear < 2010 || birthYear > new Date().getFullYear())) { const error = new Error('出生年份无效'); error.status = 400; throw error; }
        const id = randomUUID();
        await database.transaction(async client => {
          await client.query('SELECT id FROM families WHERE id=$1 FOR UPDATE', [identity.familyId]);
          const count = await client.query('SELECT count(*)::int total FROM children WHERE family_id=$1', [identity.familyId]);
          if (count.rows[0].total >= 10) throw Object.assign(new Error('每个家庭最多创建10个孩子档案'), { status: 409 });
          await client.query('INSERT INTO children(id,family_id,name,birth_year) VALUES($1,$2,$3,$4)', [id, identity.familyId, name, birthYear]);
        });
        return sendJson(res, 201, { child: { id, name, birthYear } });
      }
      const syncMatch = path.match(/^\/api\/sync\/([0-9a-f-]{36})$/i);
      if (syncMatch) {
        await rate(`sync:${identity.familyId}`, 60, 60_000);
        const childId = syncMatch[1];
        const child = await database.query('SELECT id FROM children WHERE id=$1 AND family_id=$2', [childId, identity.familyId]);
        if (!child.rows[0]) { const error = new Error('孩子档案不存在'); error.status = 404; throw error; }
        if (req.method === 'GET') {
          const result = await database.query('SELECT version,data,updated_at FROM cloud_snapshots WHERE child_id=$1', [childId]);
          const row = result.rows[0];
          return sendJson(res, 200, row ? { version: Number(row.version), data: row.data, updatedAt: row.updated_at } : { version: 0, data: null });
        }
        if (req.method === 'PUT') {
          const body = await readJson(req, Number(env.SYNC_MAX_BYTES || 5 * 1024 * 1024));
          if (!Number.isInteger(body.baseVersion) || body.baseVersion < 0 || body.data?.app !== 'lexue-workbench' || body.data?.schemaVersion !== 1 || !body.data?.data) {
            const error = new Error('同步数据格式无效'); error.status = 400; throw error;
          }
          const result = await database.query(`INSERT INTO cloud_snapshots(child_id,version,data) VALUES($1,1,$2)
            ON CONFLICT(child_id) DO UPDATE SET version=cloud_snapshots.version+1,data=EXCLUDED.data,updated_at=now()
            WHERE cloud_snapshots.version=$3 RETURNING version,updated_at`, [childId, body.data, body.baseVersion]);
          if (!result.rows[0]) {
            const latest = await database.query('SELECT version,updated_at FROM cloud_snapshots WHERE child_id=$1', [childId]);
            return sendJson(res, 409, { error: '云端已有较新的数据，请先下载或确认后覆盖', latestVersion: Number(latest.rows[0]?.version || 0), updatedAt: latest.rows[0]?.updated_at });
          }
          return sendJson(res, 200, { version: Number(result.rows[0].version), updatedAt: result.rows[0].updated_at });
        }
      }

      if (!identity.isAdmin) { const error = new Error('需要管理员权限'); error.status = 403; throw error; }
      if (path === '/api/admin/overview' && req.method === 'GET') {
        const [families, devices, usage, alerts] = await Promise.all([
          database.query("SELECT count(*)::int total,count(*) FILTER (WHERE status='active')::int active FROM families"),
          database.query("SELECT count(*)::int total,count(*) FILTER (WHERE last_seen_at >= now()-interval '7 days')::int active7d FROM devices"),
          database.query(`SELECT COALESCE(sum(tts_requests),0)::bigint tts_requests,COALESCE(sum(tts_upstream),0)::bigint tts_upstream,
            COALESCE(sum(tts_cache_hits),0)::bigint tts_cache_hits,COALESCE(sum(tts_upstream_characters),0)::bigint tts_upstream_characters,COALESCE(sum(ai_requests),0)::bigint ai_requests,
            COALESCE(sum(ai_tokens),0)::bigint ai_tokens FROM global_usage_daily WHERE usage_date >= current_date-6`),
          database.query('SELECT alert_key,kind,severity,message,created_at,updated_at FROM system_alerts WHERE active=true ORDER BY updated_at DESC LIMIT 20'),
        ]);
        const summary = usage.rows[0];
        const estimatedCost7d = Number(summary.tts_upstream_characters || 0) / 10_000 * Number(env.TTS_10K_CHARACTERS_ESTIMATED_COST || 0)
          + Number(summary.ai_tokens || 0) / 1_000_000 * Number(env.AI_MILLION_TOKEN_ESTIMATED_COST || 0);
        return sendJson(res, 200, { families: families.rows[0], devices: devices.rows[0], usage7d: summary, estimatedCost7d, alerts: alerts.rows });
      }
      if (path === '/api/admin/families' && req.method === 'GET') {
        const result = await database.query(`SELECT f.id,f.name,f.status,f.paid_enabled,f.created_at,l.tts_daily_limit,l.ai_daily_limit,
          (SELECT count(*)::int FROM children c WHERE c.family_id=f.id) children,
          (SELECT count(*)::int FROM devices d WHERE d.family_id=f.id) devices,
          COALESCE((SELECT sum(u.tts_requests) FROM usage_daily u WHERE u.family_id=f.id AND u.usage_date=(now() AT TIME ZONE 'UTC')::date),0)::bigint tts_today,
          COALESCE((SELECT sum(u.ai_requests) FROM usage_daily u WHERE u.family_id=f.id AND u.usage_date=(now() AT TIME ZONE 'UTC')::date),0)::bigint ai_today
          FROM families f JOIN account_limits l ON l.family_id=f.id ORDER BY f.created_at DESC LIMIT 200`);
        return sendJson(res, 200, { families: result.rows });
      }
      if (path === '/api/admin/content-packs' && req.method === 'GET') {
        const result = await database.query('SELECT id,content_version,title,status,created_at,updated_at FROM published_content_packs ORDER BY updated_at DESC LIMIT 200');
        return sendJson(res, 200, { packs: result.rows });
      }
      if (path === '/api/admin/content-packs' && req.method === 'POST') {
        const body = await readJson(req, Number(env.CONTENT_PACK_MAX_BYTES || 5 * 1024 * 1024));
        const pack = validateContentPack(body.pack);
        await database.query(`INSERT INTO published_content_packs(id,content_version,title,status,data,created_by) VALUES($1,$2,$3,'active',$4,$5)
          ON CONFLICT(id,content_version) DO UPDATE SET title=EXCLUDED.title,status='active',data=EXCLUDED.data,created_by=EXCLUDED.created_by,updated_at=now()`,
        [pack.id, pack.contentVersion, pack.title, pack, identity.userId]);
        return sendJson(res, 201, { ok: true, id: pack.id, contentVersion: pack.contentVersion });
      }
      const packMatch = path.match(/^\/api\/admin\/content-packs\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)$/);
      if (packMatch && req.method === 'PATCH') {
        const body = await readJson(req, 2048);
        if (!['active', 'inactive'].includes(body.status)) { const error = new Error('内容包状态无效'); error.status = 400; throw error; }
        const result = await database.query('UPDATE published_content_packs SET status=$1,updated_at=now() WHERE id=$2 AND content_version=$3 RETURNING id', [body.status, packMatch[1], packMatch[2]]);
        if (!result.rows[0]) { const error = new Error('内容包版本不存在'); error.status = 404; throw error; }
        return sendJson(res, 200, { ok: true });
      }
      const familyMatch = path.match(/^\/api\/admin\/families\/([0-9a-f-]{36})$/i);
      if (familyMatch && req.method === 'PATCH') {
        const body = await readJson(req, 4096);
        const familyId = familyMatch[1];
        if (body.status !== undefined && !['active', 'blocked'].includes(body.status)) { const error = new Error('账号状态无效'); error.status = 400; throw error; }
        if (body.paidEnabled !== undefined && typeof body.paidEnabled !== 'boolean') throw Object.assign(new Error('生成权限格式无效'), { status: 400 });
        for (const key of ['ttsDailyLimit', 'aiDailyLimit']) if (body[key] !== undefined && (!Number.isInteger(body[key]) || body[key] < 0 || body[key] > 10000)) throw Object.assign(new Error('额度需为0至10000的整数'), { status: 400 });
        await database.transaction(async (client) => {
          if (body.paidEnabled !== undefined) await client.query('UPDATE families SET paid_enabled=$1,updated_at=now() WHERE id=$2', [body.paidEnabled, familyId]);
          if (body.status !== undefined) await client.query('UPDATE families SET status=$1,updated_at=now() WHERE id=$2', [body.status, familyId]);
          if (body.ttsDailyLimit !== undefined || body.aiDailyLimit !== undefined) await client.query(`UPDATE account_limits SET
            tts_daily_limit=COALESCE($1,tts_daily_limit),ai_daily_limit=COALESCE($2,ai_daily_limit),updated_at=now() WHERE family_id=$3`,
          [body.ttsDailyLimit === undefined ? null : Math.max(0, Math.floor(Number(body.ttsDailyLimit))), body.aiDailyLimit === undefined ? null : Math.max(0, Math.floor(Number(body.aiDailyLimit))), familyId]);
        });
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 405, { error: '不支持的请求' });
    } catch (error) { return apiError(res, error); }
  };

  return { handle, authenticate, me, tokenFor };
}
