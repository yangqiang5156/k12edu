import { randomUUID } from 'node:crypto';

const origin = process.env.LEXUE_SMOKE_URL || 'http://127.0.0.1:4174';
const email = process.env.LEXUE_SMOKE_EMAIL || `smoke-${Date.now()}@example.com`;
const password = `Smoke-${randomUUID()}-Password`;
const deviceId = randomUUID();

async function request(path, init = {}, token) {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${origin}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} ${response.status}: ${data.error || '请求失败'}`);
  return data;
}

async function expectStatus(path, init, token, expected) {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${origin}${path}`, { ...init, headers });
  if (response.status !== expected) throw new Error(`${path} 应返回 ${expected}，实际为 ${response.status}`);
}

const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const guest = await request('/api/session/guest', json({ deviceId }));
if (!guest.token) throw new Error('匿名设备会话未返回 token');
await expectStatus('/api/content/generate', json({ prompt: '测试' }), guest.token, 401);
await expectStatus('/api/tts', json({ text: '测试', language: 'zh' }), undefined, 401);

const registration = await request('/api/auth/register', json({ email, password, childName: '测试孩子', deviceId }));
if (!registration.token || !registration.childId) throw new Error('注册未返回账号或孩子档案');
const token = registration.token;

const me = await request('/api/auth/me', {}, token);
if (!me.authenticated || !me.user?.isAdmin || me.children?.length !== 1) throw new Error('账号信息或管理员权限不正确');

const backup = {
  schemaVersion: 1, app: 'lexue-workbench', exportedAt: new Date().toISOString(),
  data: { settings: { childName: '测试孩子' }, content: [], plans: [], completions: [], ledger: [], pet: { id: 'current' }, redemptions: [], reports: [], contentPacks: [], rewardDefinitions: [], learningEvents: [] },
};
const uploaded = await request(`/api/sync/${registration.childId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseVersion: 0, data: backup }) }, token);
if (uploaded.version !== 1) throw new Error('首次云同步版本不正确');
await expectStatus(`/api/sync/${registration.childId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseVersion: 0, data: backup }) }, token, 409);
const downloaded = await request(`/api/sync/${registration.childId}`, {}, token);
if (downloaded.version !== 1 || downloaded.data?.data?.settings?.childName !== '测试孩子') throw new Error('云端恢复数据不一致');

const secondChild = await request('/api/children', json({ name: '第二个孩子' }), token);
if (!secondChild.child?.id) throw new Error('多孩子档案创建失败');

const overview = await request('/api/admin/overview', {}, token);
const families = await request('/api/admin/families', {}, token);
if (!overview.families?.total || !families.families?.length) throw new Error('运营管理数据为空');
await request(`/api/admin/families/${me.family.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ttsDailyLimit: 300, aiDailyLimit: 20 }) }, token);

const pack = { schemaVersion: 1, id: 'smoke-pack', title: '冒烟测试内容包', contentVersion: '1.0.0', items: [{ id: 'smoke-item', module: 'math', kind: 'math-choice', title: '测试题' }] };
await request('/api/admin/content-packs', json({ pack }), token);
const publicPacks = await request('/api/content-packs', {}, guest.token);
if (!publicPacks.packs?.some(item => item.id === pack.id)) throw new Error('发布的内容包未出现在公开列表');
await request(`/api/admin/content-packs/${pack.id}/${pack.contentVersion}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'inactive' }) }, token);
await expectStatus(`/api/content-packs/${pack.id}/${pack.contentVersion}`, {}, guest.token, 404);
await request(`/api/admin/content-packs/${pack.id}/${pack.contentVersion}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) }, token);

const exported = await request('/api/account/export', {}, token);
if (exported.family?.id !== me.family.id || !exported.snapshots?.length) throw new Error('家庭数据导出不完整');

const deleteDeviceId = randomUUID();
const deletePassword = `Delete-${randomUUID()}-Password`;
const disposable = await request('/api/auth/register', json({ email: `delete-${Date.now()}@example.com`, password: deletePassword, childName: '待注销', deviceId: deleteDeviceId }));
await request('/api/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: deletePassword }) }, disposable.token);
await expectStatus('/api/auth/me', {}, disposable.token, 403);

const login = await request('/api/auth/login', json({ email, password, deviceId }));
if (!login.token) throw new Error('登录未返回 token');

console.log(JSON.stringify({ ok: true, email, familyId: me.family.id, childId: registration.childId, cloudVersion: downloaded.version, adminFamilies: families.families.length, contentPack: pack.id, accountDeletion: true }, null, 2));
