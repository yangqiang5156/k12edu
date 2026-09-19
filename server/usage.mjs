import { requestIp } from './http.mjs';

const dateKey = () => new Date().toISOString().slice(0, 10);
const minuteWindows = new Map();

function integer(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : fallback;
}

export function createUsageService(database, identityService, env = process.env) {
  const minuteLimit = (capability) => integer(env[capability === 'tts' ? 'TTS_PER_MINUTE_LIMIT' : 'AI_PER_MINUTE_LIMIT'], capability === 'tts' ? 30 : 5);
  const ipMinuteLimit = (capability) => integer(env[capability === 'tts' ? 'TTS_IP_PER_MINUTE_LIMIT' : 'AI_IP_PER_MINUTE_LIMIT'], capability === 'tts' ? 60 : 10);
  const guestDaily = (capability) => integer(env[capability === 'tts' ? 'GUEST_TTS_DAILY_LIMIT' : 'GUEST_AI_DAILY_LIMIT'], capability === 'tts' ? 30 : 0);
  const globalDaily = (capability) => integer(env[capability === 'tts' ? 'TTS_GLOBAL_DAILY_UPSTREAM_LIMIT' : 'AI_GLOBAL_DAILY_LIMIT'], capability === 'tts' ? 5000 : 500);

  const authorize = async (req, capability) => {
    const identity = await identityService.authenticate(req, { allowGuest: true });
    if (capability === 'ai' && identity.type !== 'account') {
      const error = new Error('AI 新增资料仅向已登录家长开放'); error.status = 401; throw error;
    }
    const subject = identity.type === 'account' ? `family:${identity.familyId}` : `device:${identity.deviceId}`;
    const now = Date.now();
    for (const [minuteKey, limit] of [[`${capability}:${subject}`, minuteLimit(capability)], [`${capability}:ip:${requestIp(req)}`, ipMinuteLimit(capability)]]) {
      const current = minuteWindows.get(minuteKey);
      const window = !current || now - current.startedAt >= 60_000 ? { startedAt: now, count: 0 } : current;
      if (window.count >= limit) { const error = new Error('请求较多，请稍后再试'); error.status = 429; throw error; }
      window.count += 1; minuteWindows.set(minuteKey, window);
    }
    if (!database.configured) return identity;
    let limit = guestDaily(capability);
    if (identity.type === 'account') {
      const result = await database.query(`SELECT f.status,l.tts_daily_limit,l.ai_daily_limit FROM families f JOIN account_limits l ON l.family_id=f.id WHERE f.id=$1`, [identity.familyId]);
      const row = result.rows[0];
      if (!row || row.status !== 'active') { const error = new Error('家庭账号已停用'); error.status = 403; throw error; }
      limit = capability === 'tts' ? row.tts_daily_limit : row.ai_daily_limit;
    }
    const scopeType = identity.type === 'account' ? 'family' : 'device';
    const scopeId = identity.type === 'account' ? identity.familyId : identity.deviceId;
    const result = await database.query(`SELECT ${capability === 'tts' ? 'tts_requests' : 'ai_requests'} used FROM usage_daily WHERE usage_date=current_date AND scope_type=$1 AND scope_id=$2`, [scopeType, scopeId]);
    if (Number(result.rows[0]?.used || 0) >= limit) { const error = new Error(capability === 'tts' ? '今天的在线朗读额度已用完，明天会自动恢复' : '今天的 AI 生成额度已用完，明天会自动恢复'); error.status = 429; throw error; }
    return identity;
  };

  const assertGlobalBudget = async (capability) => {
    if (!database.configured) return;
    const column = capability === 'tts' ? 'tts_upstream' : 'ai_requests';
    const result = await database.query(`SELECT ${column} used FROM global_usage_daily WHERE usage_date=current_date`);
    if (Number(result.rows[0]?.used || 0) >= globalDaily(capability)) {
      const message = capability === 'tts' ? '在线朗读上游调用达到今日硬上限' : 'AI 生成达到今日硬上限';
      await database.query(`INSERT INTO system_alerts(alert_key,kind,severity,message) VALUES($1,$2,'critical',$3)
        ON CONFLICT(alert_key) DO UPDATE SET active=true,message=EXCLUDED.message,updated_at=now()`, [`${dateKey()}:${capability}:global-limit`, `${capability}_global_limit`, message]);
      const error = new Error(capability === 'tts' ? '今日在线朗读服务额度暂时用完' : '今日智能生成服务额度暂时用完'); error.status = 503; throw error;
    }
  };

  const record = async (identity, metrics) => {
    if (!database.configured) return;
    const allowed = ['tts_requests', 'tts_upstream', 'tts_cache_hits', 'tts_characters', 'tts_upstream_characters', 'ai_requests', 'ai_tokens'];
    const values = Object.fromEntries(allowed.map((key) => [key, Math.max(0, Math.floor(Number(metrics[key] || 0)))]));
    const scopeType = identity.type === 'account' ? 'family' : 'device';
    const scopeId = identity.type === 'account' ? identity.familyId : identity.deviceId;
    const parameters = [dateKey(), scopeType, scopeId, identity.familyId || null, identity.deviceId,
      ...allowed.map((key) => values[key])];
    const update = allowed.map((key) => `${key}=usage_daily.${key}+EXCLUDED.${key}`).join(',');
    const globalUpdate = allowed.map((key) => `${key}=global_usage_daily.${key}+EXCLUDED.${key}`).join(',');
    await database.transaction(async (client) => {
      await client.query(`INSERT INTO usage_daily(usage_date,scope_type,scope_id,family_id,device_id,${allowed.join(',')})
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(usage_date,scope_type,scope_id) DO UPDATE SET ${update},updated_at=now()`, parameters);
      await client.query(`INSERT INTO global_usage_daily(usage_date,${allowed.join(',')}) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(usage_date) DO UPDATE SET ${globalUpdate},updated_at=now()`, [dateKey(), ...allowed.map((key) => values[key])]);
    });
  };

  return { authorize, assertGlobalBudget, record };
}
