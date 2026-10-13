import { randomUUID } from 'node:crypto';
import { requestIp, boundedResponse } from './http.mjs';
import { createRateLimiter, limitError } from './rate-limit.mjs';
export const usageDate = () => new Date().toISOString().slice(0, 10);
const integer = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('额度配置必须是非负整数');
  return n;
};
export function createUsageService(database, identityService, env = process.env) {
  const rate = createRateLimiter(database), memory = new Map(), active = { tts: 0, ai: 0 };
  const localPaid = !database.configured && env.ALLOW_LOCAL_PAID_SERVICES === 'true';
  const settings = {
    tts: { requests: integer(env.TTS_GLOBAL_DAILY_UPSTREAM_LIMIT, 5000), units: integer(env.TTS_GLOBAL_DAILY_CHARACTER_LIMIT, 50000), familyUnits: integer(env.TTS_FAMILY_DAILY_CHARACTER_LIMIT, 10000), concurrent: integer(env.TTS_GLOBAL_CONCURRENCY, 3) },
    ai: { requests: integer(env.AI_GLOBAL_DAILY_LIMIT, 500), units: integer(env.AI_GLOBAL_DAILY_TOKEN_LIMIT, 200000), familyUnits: integer(env.AI_FAMILY_DAILY_TOKEN_LIMIT, 30000), concurrent: integer(env.AI_GLOBAL_CONCURRENCY, 2) },
  };
  const reserve = async (capability, scopes, requests, units = 0, lease = false) => {
    const date = usageDate();
    if (!Number.isSafeInteger(requests) || requests < 0 || !Number.isSafeInteger(units) || units < 0) throw new Error('预算参数无效');
    if (!database.configured) {
      for (const key of memory.keys()) if (!key.startsWith(date + ':')) memory.delete(key);
      if (memory.size > 10000) throw limitError();
      const entries = scopes.map(scope => {
        const key = `${date}:${capability}:${scope.id}`, current = memory.get(key) || { requests: 0, units: 0 };
        if (current.requests + requests > scope.requests || current.units + units > scope.units) throw limitError('今日服务预算已用完');
        return [key, { requests: current.requests + requests, units: current.units + units }];
      });
      if (lease && active[capability] >= settings[capability].concurrent) throw limitError('生成服务繁忙，请稍后再试', 2);
      for (const [key, value] of entries) memory.set(key, value);
      if (lease) active[capability]++;
      return async () => { if (lease) active[capability]--; };
    }
    const id = randomUUID();
    await database.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`lexue-budget:${capability}`]);
      if (lease) {
        await client.query('DELETE FROM upstream_leases WHERE expires_at<=now()');
        const result = await client.query('SELECT count(*)::int total FROM upstream_leases WHERE capability=$1', [capability]);
        if (result.rows[0].total >= settings[capability].concurrent) throw limitError('生成服务繁忙，请稍后再试', 2);
      }
      for (const scope of scopes) {
        await client.query('INSERT INTO service_budgets(usage_date,capability,scope_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [date, capability, scope.id]);
        const result = await client.query(`UPDATE service_budgets SET requests=requests+$4,units=units+$5
          WHERE usage_date=$1 AND capability=$2 AND scope_id=$3 AND requests+$4<=$6 AND units+$5<=$7 RETURNING requests`,
        [date, capability, scope.id, requests, units, scope.requests, scope.units]);
        if (!result.rows.length) throw limitError('今日服务预算已用完');
      }
      if (lease) await client.query("INSERT INTO upstream_leases(id,capability,expires_at) VALUES($1,$2,now()+interval '2 minutes')", [id, capability]);
    });
    return async () => { if (lease) await database.query('DELETE FROM upstream_leases WHERE id=$1', [id]); };
  };
  const assertPaid = async actor => {
    if (env.PAID_SERVICES_ENABLED === 'false') throw Object.assign(new Error('在线生成暂未开放'), { status: 403 });
    if (localPaid) return;
    if (env.PAID_SERVICES_ENABLED === 'false' || !database.configured || actor.type !== 'account') throw Object.assign(new Error('新音频和 AI 生成需要已启用的家庭账号；已有内容仍可使用'), { status: 403 });
    const result = await database.query('SELECT status,paid_enabled FROM families WHERE id=$1', [actor.familyId]);
    if (result.rows[0]?.status !== 'active' || result.rows[0]?.paid_enabled !== true) throw Object.assign(new Error('家庭账号尚未启用在线生成，请联系管理员'), { status: 403 });
  };
  const authorizeActor = async (actor, capability, { ip, background = false } = {}) => {
    if (capability === 'ai' || background) await assertPaid(actor);
    const subject = actor.type === 'account' ? `family:${actor.familyId}` : `device:${actor.deviceId}`;
    await rate(`${capability}:${subject}`, integer(env[capability === 'tts' ? 'TTS_PER_MINUTE_LIMIT' : 'AI_PER_MINUTE_LIMIT'], capability === 'tts' ? 30 : 5), 60000);
    await rate(`${capability}:global-minute`, capability === 'tts' ? 120 : 20, 60000);
    if (ip) await rate(`${capability}:ip:${ip}`, integer(env[capability === 'tts' ? 'TTS_IP_PER_MINUTE_LIMIT' : 'AI_IP_PER_MINUTE_LIMIT'], capability === 'tts' ? 60 : 10), 60000);
    let limit = integer(env[capability === 'tts' ? 'GUEST_TTS_DAILY_LIMIT' : 'GUEST_AI_DAILY_LIMIT'], capability === 'tts' ? 30 : 0);
    if (actor.type === 'account' && database.configured) {
      const result = await database.query('SELECT f.status,l.tts_daily_limit,l.ai_daily_limit FROM families f JOIN account_limits l ON l.family_id=f.id WHERE f.id=$1', [actor.familyId]);
      if (result.rows[0]?.status !== 'active') throw Object.assign(new Error('家庭账号已停用'), { status: 403 });
      limit = Number(result.rows[0][capability === 'tts' ? 'tts_daily_limit' : 'ai_daily_limit']);
    } else if (localPaid) limit = 100;
    await reserve(`${capability}-use`, [{ id: subject, requests: limit, units: 0 }, { id: 'global', requests: integer(env[capability === 'tts' ? 'TTS_GLOBAL_DAILY_REQUEST_LIMIT' : 'AI_GLOBAL_DAILY_LIMIT'], capability === 'tts' ? 10000 : 500), units: 0 }], 1);
    return actor;
  };
  const authorize = async (req, capability) => authorizeActor(await identityService.authenticate(req, { allowGuest: true }), capability, { ip: requestIp(req) });
  const record = async (actor, metrics) => {
    if (!database.configured) return;
    const allowed = ['tts_requests', 'tts_upstream', 'tts_cache_hits', 'tts_characters', 'tts_upstream_characters', 'ai_requests', 'ai_tokens'];
    const values = allowed.map(key => Math.max(0, Math.floor(Number(metrics[key] || 0))));
    const args = [usageDate(), actor.type === 'account' ? 'family' : 'device', actor.type === 'account' ? actor.familyId : actor.deviceId, actor.familyId || null, actor.deviceId || null, ...values];
    const update = allowed.map(key => `${key}=usage_daily.${key}+EXCLUDED.${key}`).join(','), globalUpdate = allowed.map(key => `${key}=global_usage_daily.${key}+EXCLUDED.${key}`).join(',');
    await database.transaction(async client => {
      await client.query(`INSERT INTO usage_daily(usage_date,scope_type,scope_id,family_id,device_id,${allowed.join(',')}) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT(usage_date,scope_type,scope_id) DO UPDATE SET ${update},updated_at=now()`, args);
      await client.query(`INSERT INTO global_usage_daily(usage_date,${allowed.join(',')}) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(usage_date) DO UPDATE SET ${globalUpdate},updated_at=now()`, [usageDate(), ...values]);
    });
  };
  const providerRequest = (actor, request) => async (url, init = {}) => {
    if (init.method !== 'POST') return boundedResponse(await request(url, init));
    const body = JSON.parse(init.body), capability = new URL(url).hostname === 'api.deepseek.com' ? 'ai' : 'tts';
    await assertPaid(actor);
    const units = capability === 'tts' ? String(body.input?.text || body.text || body.req_params?.text || '').length : Buffer.byteLength(JSON.stringify(body.messages)) + integer(body.max_tokens, 5000);
    if (!units) throw new Error('无法确定供应商请求预算');
    const config = settings[capability];
    const release = await reserve(capability, [
      { id: 'global', requests: config.requests, units: config.units },
      { id: `family:${actor.familyId || actor.deviceId}`, requests: config.requests, units: config.familyUnits },
    ], 1, units, true);
    try {
      await record(actor, capability === 'tts' ? { tts_upstream: 1, tts_upstream_characters: units } : { ai_requests: 1 });
      const response = await request(url, { ...init, signal: AbortSignal.any([...(init.signal ? [init.signal] : []), AbortSignal.timeout(100000)]) });
      return await boundedResponse(response);
    } finally { await release(); }
  };
  const audioRate = async req => { await rate('audio:global-minute', 180, 60000); await rate(`audio:ip:${requestIp(req)}`, integer(env.AUDIO_IP_PER_MINUTE_LIMIT, 60), 60000); };
  const reserveAudio = async (req, bytes, requests = 1) => reserve('audio', [
    { id: 'global', requests: integer(env.AUDIO_GLOBAL_DAILY_REQUEST_LIMIT, 10000), units: integer(env.AUDIO_GLOBAL_DAILY_BYTE_LIMIT, 1073741824) },
    { id: `ip:${requestIp(req)}`, requests: integer(env.AUDIO_IP_DAILY_REQUEST_LIMIT, 1000), units: integer(env.AUDIO_IP_DAILY_BYTE_LIMIT, 104857600) },
  ], requests, bytes);
  const reserveStories = actor => reserve('story', [{ id: `family:${actor.familyId}`, requests: integer(env.STORY_DAILY_GENERATION_LIMIT, 3), units: 0 }], 1);
  return { authenticate: req => identityService.authenticate(req, { allowGuest: true }), authorize, authorizeActor, assertPaid, providerRequest, record, rate, audioRate, reserveAudio, reserveStories };
}
