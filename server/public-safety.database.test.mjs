import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDatabase, initializeDatabase } from './database.mjs';
import { createIdentityService } from './identity.mjs';
import { createUsageService } from './usage.mjs';
import { createRateLimiter } from './rate-limit.mjs';
import { createStoryService } from './story-service.mjs';
import { createStoryAudio } from './story-audio.mjs';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';

// 只能指向独立测试数据库：每例都会清空数据。不会读取项目 .env。
const connection = process.env.SECURITY_TEST_DATABASE_URL;
const suite = connection ? describe : describe.skip;
const env = { SESSION_SECRET: 'security-test-secret-'.repeat(3), ADMIN_EMAILS: 'admin@example.test' };
async function call(middleware, url, body, token, method = body === undefined ? 'GET' : 'POST') {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  Object.assign(req, { url, method, socket: { remoteAddress: '198.51.100.10' }, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  const res = Object.assign(new EventEmitter(), { writeHead: vi.fn(), end: vi.fn() });
  await middleware(req, res, vi.fn());
  return { status: res.writeHead.mock.calls[0]?.[0], data: JSON.parse(res.end.mock.calls[0]?.[0] || '{}') };
}
let db, identity, actor, token, childId;
suite('真实PostgreSQL安全集成（独立临时数据库）', () => {
  beforeAll(async () => {
    if (!/lexue_security_test/.test(connection)) throw new Error('测试数据库名称必须包含 lexue_security_test');
    db = createDatabase({ DATABASE_URL: connection }); await initializeDatabase(db);
  });
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.query('TRUNCATE families,devices,api_rate_windows,service_budgets,upstream_leases,global_usage_daily CASCADE');
    identity = createIdentityService(db, env);
    const registered = await call(identity.handle, '/api/auth/register', { email: 'admin@example.test', password: 'test-password-123456', deviceId: 'database-test-device-12345' });
    expect(registered.status).toBe(201);
    token = registered.data.token; childId = registered.data.childId;
    actor = await identity.authenticate({ headers: { authorization: `Bearer ${token}` } });
  });
  it('配置管理员邮箱也不会被注册者获得管理员权限；新家庭没有生成权限', async () => {
    expect(actor.isAdmin).toBe(false);
    const me = await identity.me(actor); expect(me.family.paidEnabled).toBe(false);
    const usage = createUsageService(db, identity, env);
    await expect(usage.assertPaid(actor)).rejects.toMatchObject({ status: 403 });
    expect((await call(identity.handle, '/api/admin/families', undefined, token)).status).toBe(403);
  });
  it('家庭注册邮箱仅管理员可查询，撤销管理员权限后立即拒绝访问', async () => {
    const denied = await call(identity.handle, '/api/admin/families', undefined, token);
    expect(denied.status).toBe(403);
    expect(JSON.stringify(denied.data)).not.toContain('admin@example.test');
    await db.query('UPDATE parent_users SET is_admin=true WHERE id=$1', [actor.userId]);
    const result = await call(identity.handle, '/api/admin/families', undefined, token);
    expect(result.status).toBe(200);
    expect(result.data.families).toHaveLength(1);
    expect(result.data.families[0]).toMatchObject({ id: actor.familyId, registration_email: 'admin@example.test' });
    await db.query('UPDATE parent_users SET is_admin=false WHERE id=$1', [actor.userId]);
    expect((await call(identity.handle, '/api/admin/families', undefined, token)).status).toBe(403);
  });
  it('两套服务并发争抢每日最后一次额度仅一个通过', async () => {
    await db.query('UPDATE account_limits SET tts_daily_limit=1');
    const first = createUsageService(db, identity, env), second = createUsageService(db, identity, env);
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).authorizeActor(actor, 'tts')));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected').every(r => r.reason.status === 429)).toBe(true);
    const rows = await db.query("SELECT requests FROM service_budgets WHERE capability='tts-use'");
    expect(Number(rows.rows[0].requests)).toBe(1);
  });
  it('多实例共用分钟窗口，数据库原子更新不能被并发绕过', async () => {
    const one = createRateLimiter(db), two = createRateLimiter(db);
    const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => (i % 2 ? one : two)('integration', 3, 60000)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(3);
  });
  it('实际供应商请求失败仍计费，跨实例预算不重置', async () => {
    await db.query('UPDATE families SET paid_enabled=true');
    const configuration = { ...env, TTS_GLOBAL_DAILY_UPSTREAM_LIMIT: '1' };
    const upstream = vi.fn().mockRejectedValue(new Error('network failed'));
    const post = { method: 'POST', body: JSON.stringify({ input: { text: '你好' } }) };
    await expect(createUsageService(db, identity, configuration).providerRequest(actor, upstream)('https://tts.example.com', post)).rejects.toThrow('network failed');
    await expect(createUsageService(db, identity, configuration).providerRequest(actor, upstream)('https://tts.example.com', post)).rejects.toMatchObject({ status: 429 });
    expect(upstream).toHaveBeenCalledTimes(1);
    const result = await db.query('SELECT tts_upstream,tts_upstream_characters FROM global_usage_daily');
    expect(result.rows[0]).toMatchObject({ tts_upstream: 1, tts_upstream_characters: '2' });
  });
  it('跨实例供应商并发租约限制生效并可释放', async () => {
    await db.query('UPDATE families SET paid_enabled=true');
    let done; const pending = new Promise(resolve => { done = resolve; });
    const upstream = vi.fn().mockImplementationOnce(() => pending).mockResolvedValue(new Response('ok'));
    const config = { ...env, TTS_GLOBAL_CONCURRENCY: '1' };
    const one = createUsageService(db, identity, config), two = createUsageService(db, identity, config);
    const post = { method: 'POST', body: JSON.stringify({ input: { text: '你好' } }) };
    const first = one.providerRequest(actor, upstream)('https://tts.example.com', post);
    await vi.waitFor(() => expect(upstream).toHaveBeenCalledTimes(1));
    await expect(two.providerRequest(actor, upstream)('https://tts.example.com', post)).rejects.toMatchObject({ status: 429 });
    done(new Response('ok')); await first;
    await expect(two.providerRequest(actor, upstream)('https://tts.example.com', post)).resolves.toBeInstanceOf(Response);
  });
  it('手工保存的故事也需要配音准入，并发提交只入队一个', async () => {
    const usage = createUsageService(db, identity, env);
    const stories = createStoryService({ database: { ...db, pool: { connect: async () => null } }, identity, usage, audioCache: {}, storage: {}, env });
    const id = randomUUID();
    await db.query(`INSERT INTO family_stories(id,family_id,child_id,created_by,title,summary,stage,age_min,age_max,themes,paragraphs,duration_minutes,content_version)
      VALUES($1,$2,$3,$4,'故事','简介','kindergarten',3,5,'{}','["故事"]',3,'v1')`, [id, actor.familyId, childId, actor.userId]);
    expect((await call(stories.handle, `/api/stories/family/${id}/audio`, {}, token)).status).toBe(403);
    await db.query('UPDATE families SET paid_enabled=true');
    const results = await Promise.all(Array.from({ length: 3 }, () => call(stories.handle, `/api/stories/family/${id}/audio`, {}, token)));
    expect(results.filter(r => r.status === 202)).toHaveLength(1);
    expect(results.filter(r => r.status === 409)).toHaveLength(2);
    expect((await db.query("SELECT count(*)::int total FROM story_audio_jobs WHERE status='queued'")).rows[0].total).toBe(1);
  });
  it('家庭试听票据随退出失效，不能使用旧链接访问OSS', async () => {
    const storage = { enabled: true, head: vi.fn() }, usage = createUsageService(db, identity, env);
    const audio = createStoryAudio({ database: db, identity, storage, usage, env });
    const link = audio.urlFor({ id: randomUUID(), audio_object_key: 'private-key' }, actor);
    const url = new URL(link.replace('/lexue/', '/'), 'http://localhost');
    await call(identity.handle, '/api/auth/logout', {}, token);
    await expect(audio.handle({ headers: {}, method: 'HEAD' }, {}, url)).rejects.toMatchObject({ status: 401 });
    expect(storage.head).not.toHaveBeenCalled();
  });
});
