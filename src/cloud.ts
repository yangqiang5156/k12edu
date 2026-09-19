import type { BackupEnvelopeV1 } from './types';

const TOKEN_KEY = 'lexue:access-token';
const DEVICE_KEY = 'lexue:device-id';
const CHILD_KEY = 'lexue:cloud-child';
const VERSION_PREFIX = 'lexue:cloud-version:';
const api = (path: string) => `${import.meta.env.BASE_URL}api${path}`;

export interface CloudChild { id: string; name: string; birthYear?: number; updatedAt?: string }
export interface CloudAccount {
  authenticated: boolean;
  deviceId: string;
  user?: { id: string; email: string; displayName: string; isAdmin: boolean };
  family?: { id: string; name: string };
  limits?: { ttsDaily: number; aiDaily: number };
  children?: CloudChild[];
}

function deviceId() {
  let value = localStorage.getItem(DEVICE_KEY);
  if (!value) { value = crypto.randomUUID(); localStorage.setItem(DEVICE_KEY, value); }
  return value;
}

function token() { return localStorage.getItem(TOKEN_KEY) || ''; }

async function guestSession() {
  const response = await fetch(api('/session/guest'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: deviceId() }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) throw new Error(data.error || '无法建立安全访问会话');
  localStorage.setItem(TOKEN_KEY, data.token);
  return data.token as string;
}

export async function ensureSession() {
  if (import.meta.env.MODE === 'test') return '';
  return token() || guestSession();
}

export async function authorizedFetch(input: RequestInfo | URL, init: RequestInit = {}, retry = true): Promise<Response> {
  if (import.meta.env.MODE === 'test') return fetch(input, init);
  const accessToken = await ensureSession();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(input, { ...init, headers });
  if (response.status === 401 && retry) {
    localStorage.removeItem(TOKEN_KEY);
    await guestSession();
    return authorizedFetch(input, init, false);
  }
  return response;
}

async function jsonRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await authorizedFetch(api(path), init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || '云端服务暂时不可用') as Error & { status?: number; data?: unknown };
    error.status = response.status; error.data = data; throw error;
  }
  return data as T;
}

export async function loadCloudAccount(): Promise<CloudAccount> {
  await ensureSession();
  return jsonRequest<CloudAccount>('/auth/me');
}

export async function registerFamily(email: string, password: string, childName: string) {
  const response = await fetch(api('/auth/register'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, childName, deviceId: deviceId() }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '注册失败');
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(CHILD_KEY, data.childId);
  localStorage.setItem(`${VERSION_PREFIX}${data.childId}`, '0');
  return data.account as CloudAccount;
}

export async function loginFamily(email: string, password: string) {
  const response = await fetch(api('/auth/login'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, deviceId: deviceId() }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '登录失败');
  localStorage.setItem(TOKEN_KEY, data.token);
  const account = data.account as CloudAccount;
  if (!localStorage.getItem(CHILD_KEY) && account.children?.[0]) localStorage.setItem(CHILD_KEY, account.children[0].id);
  return account;
}

export async function logoutFamily() {
  await authorizedFetch(api('/auth/logout'), { method: 'POST' }).catch(() => undefined);
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(CHILD_KEY);
  await guestSession();
}

export function currentCloudChildId() { return localStorage.getItem(CHILD_KEY); }
export function selectCloudChild(id: string) { localStorage.setItem(CHILD_KEY, id); }

export async function createCloudChild(name: string, birthYear?: number) {
  const result = await jsonRequest<{ child: CloudChild }>('/children', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, birthYear }),
  });
  localStorage.setItem(`${VERSION_PREFIX}${result.child.id}`, '0');
  return result.child;
}

export async function downloadCloudSnapshot(childId: string) {
  return jsonRequest<{ version: number; data: BackupEnvelopeV1 | null; updatedAt?: string }>(`/sync/${childId}`);
}

export async function uploadCloudSnapshot(childId: string, data: BackupEnvelopeV1) {
  const baseVersion = Number(localStorage.getItem(`${VERSION_PREFIX}${childId}`) || 0);
  const result = await jsonRequest<{ version: number; updatedAt: string }>(`/sync/${childId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseVersion, data }),
  });
  localStorage.setItem(`${VERSION_PREFIX}${childId}`, String(result.version));
  return result;
}

let syncTimer: number | undefined;
export function scheduleCloudUpload(data: BackupEnvelopeV1) {
  if (import.meta.env.MODE === 'test' || !currentCloudChildId()) return;
  if (syncTimer) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    const childId = currentCloudChildId();
    if (childId) void uploadCloudSnapshot(childId, data).catch(() => undefined);
  }, 2500);
}

export interface AdminOverview {
  families: { total: number; active: number };
  devices: { total: number; active7d: number };
  usage7d: { tts_requests: string; tts_upstream: string; tts_cache_hits: string; tts_upstream_characters: string; ai_requests: string; ai_tokens: string };
  estimatedCost7d: number;
  alerts: Array<{ alert_key: string; kind: string; severity: 'warning' | 'critical'; message: string; updated_at: string }>;
}
export interface AdminFamily {
  id: string; name: string; status: 'active' | 'blocked'; created_at: string;
  tts_daily_limit: number; ai_daily_limit: number; children: number; devices: number; tts_today: string; ai_today: string;
}
export const loadAdminOverview = () => jsonRequest<AdminOverview>('/admin/overview');
export const loadAdminFamilies = () => jsonRequest<{ families: AdminFamily[] }>('/admin/families');
export const updateAdminFamily = (id: string, changes: Partial<{ status: 'active' | 'blocked'; ttsDailyLimit: number; aiDailyLimit: number }>) => jsonRequest<{ ok: true }>(`/admin/families/${id}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes),
});
export interface AdminContentPack { id: string; content_version: string; title: string; status: 'active' | 'inactive'; created_at: string; updated_at: string }
export const loadAdminContentPacks = () => jsonRequest<{ packs: AdminContentPack[] }>('/admin/content-packs');
export const publishAdminContentPack = (pack: unknown) => jsonRequest<{ ok: true; id: string; contentVersion: string }>('/admin/content-packs', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pack }),
});
export const updateAdminContentPack = (pack: AdminContentPack, status: 'active' | 'inactive') => jsonRequest<{ ok: true }>(`/admin/content-packs/${encodeURIComponent(pack.id)}/${encodeURIComponent(pack.content_version)}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
});
export const exportFamilyData = () => jsonRequest<Record<string, unknown>>('/account/export');
export const deleteFamilyAccount = (password: string) => jsonRequest<{ deleted: true }>('/account', {
  method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
});
