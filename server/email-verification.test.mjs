import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { PGlite } from '@electric-sql/pglite';
import { Readable } from 'node:stream';
import { schema } from './database.mjs';
import { createIdentityService } from './identity.mjs';
import { createVerificationMailer, resolveSmtpEndpoints } from './email-verification.mjs';

// 内存中的PostgreSQL引擎运行实际SQL与事务，绝不读取项目.env或连接现有数据库。
const env = { SESSION_SECRET: 'email-verification-test-secret-'.repeat(2) };
let pg, db, identity, mails;
const email = 'parent@example.test', password = 'original-password-123', deviceId = 'email-test-device-123456';
async function call(path, body, token) {
  const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  Object.assign(req, { url: `/api/auth/${path}`, method: body === undefined ? 'GET' : 'POST', socket: { remoteAddress: '198.51.100.22' },
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } });
  const res = { writeHead: vi.fn(), end: vi.fn() };
  await identity.handle(req, res, vi.fn());
  return { status: res.writeHead.mock.calls[0]?.[0], data: JSON.parse(res.end.mock.calls[0]?.[0] || '{}') };
}
async function verified(purpose = 'register', address = email) {
  expect((await call('email-code', { email: address, purpose })).status).toBe(200);
  const mail = mails.at(-1);
  expect(mail.code).toMatch(/^\d{6}$/);
  const result = await call('verify-email', { email: address, purpose, code: mail.code });
  expect(result.status).toBe(200);
  return result.data.verificationToken;
}
async function register() {
  return call('register', { email, password, deviceId, verificationToken: await verified() });
}
describe('家庭账号邮箱验证与密码找回', () => {
  beforeAll(async () => {
    pg = new PGlite(); await pg.exec(schema);
    db = { configured: true, query: (sql, args) => pg.query(sql, args),
      transaction: callback => pg.transaction(tx => callback({ query: (sql, args) => tx.query(sql, args) })) };
  }, 30000);
  afterAll(async () => { await pg?.close(); });
  beforeEach(async () => {
    await pg.exec('TRUNCATE families, devices, api_rate_windows, email_verifications CASCADE');
    mails = []; identity = createIdentityService(db, env, { sendVerificationMail: async mail => { mails.push(mail); } });
  });
  it('必须验证邮箱才能注册，凭证不能复用，正常注册可以登录', async () => {
    expect((await call('register', { email, password, deviceId })).status).toBe(400);
    const verificationToken = await verified('register', ' PARENT@example.test ');
    expect(mails[0].email).toBe(email);
    expect((await call('register', { email, password, deviceId, verificationToken })).status).toBe(201);
    expect((await call('register', { email, password, deviceId, verificationToken })).status).toBe(400);
    expect((await call('login', { email, password, deviceId })).status).toBe(200);
  });
  it('验证码错误5次后失效，错误次数持久化', async () => {
    await call('email-code', { email, purpose: 'register' });
    const code = mails[0].code, wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) expect((await call('verify-email', { email, purpose: 'register', code: wrong })).status).toBe(400);
    expect((await call('verify-email', { email, purpose: 'register', code })).status).toBe(400);
    expect((await pg.query('SELECT attempts FROM email_verifications')).rows[0].attempts).toBe(5);
  });
  it('重发冷却、旧验证码和旧凭证失效，过期验证码不能验证', async () => {
    const token = await verified();
    expect((await call('email-code', { email, purpose: 'register' })).status).toBe(429);
    await pg.exec("UPDATE email_verifications SET sent_at=now()-interval '61 seconds'");
    expect((await call('email-code', { email, purpose: 'register' })).status).toBe(200);
    expect((await call('register', { email, password, deviceId, verificationToken: token })).status).toBe(400);
    const code = mails.at(-1).code;
    await pg.exec("UPDATE email_verifications SET expires_at=now()-interval '1 second'");
    expect((await call('verify-email', { email, purpose: 'register', code })).status).toBe(400);
  });
  it('验证凭证绑定邮箱、用途和有效期，不能跨账号重置', async () => {
    const token = await verified();
    expect((await call('reset-password', { email, password, verificationToken: token })).status).toBe(400);
    expect((await call('register', { email: 'other@example.test', password, deviceId, verificationToken: token })).status).toBe(400);
    await pg.exec("UPDATE email_verifications SET expires_at=now()-interval '1 second'");
    expect((await call('register', { email, password, deviceId, verificationToken: token })).status).toBe(400);
    expect((await pg.query('SELECT * FROM families')).rows).toHaveLength(0);
  });
  it('重置后旧密码和旧会话失效，新密码能登录，凭证仅使用一次', async () => {
    const account = await register(); expect(account.status).toBe(201);
    const verificationToken = await verified('reset');
    const newPassword = 'new-password-12345';
    expect((await call('reset-password', { email, password: newPassword, verificationToken })).status).toBe(200);
    expect((await call('me', undefined, account.data.token)).status).toBe(401);
    expect((await call('login', { email, password, deviceId })).status).toBe(401);
    expect((await call('login', { email, password: newPassword, deviceId })).status).toBe(200);
    expect((await call('reset-password', { email, password, verificationToken })).status).toBe(400);
  });
  it('未注册邮箱找回统一提示但不发送；注册关闭时拒绝发送和注册验证', async () => {
    expect((await call('email-code', { email, purpose: 'reset' })).status).toBe(200);
    expect(mails).toHaveLength(0);
    identity = createIdentityService(db, { ...env, REGISTRATION_ENABLED: 'false' });
    expect((await call('email-code', { email, purpose: 'register' })).status).toBe(403);
    expect((await call('verify-email', { email, purpose: 'register', code: '123456' })).status).toBe(403);
  });
  it('发信失败清除未发送验证码，缺少授权码不允许发送', async () => {
    identity = createIdentityService(db, env, { sendVerificationMail: async () => { throw Object.assign(new Error('发送失败'), { status: 502 }); } });
    expect((await call('email-code', { email, purpose: 'register' })).status).toBe(502);
    expect((await pg.query('SELECT * FROM email_verifications')).rows).toHaveLength(0);
    await expect(createVerificationMailer({})({ email, code: '123456', purpose: 'register' })).rejects.toMatchObject({ status: 503 });
  });
});

it('邮件使用指定163账号、SSL和授权码，只发送6位验证码', async () => {
  const sendMail = vi.fn().mockResolvedValue({ accepted: [email] });
  const transport = vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail, close: vi.fn() });
  try {
    await createVerificationMailer({ SMTP_AUTH_CODE: 'test-authorization-code' })({ email, code: '012345', purpose: 'reset' });
    expect(transport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.163.com', port: 465, secure: true,
      auth: { user: 'zhilefang5156@163.com', pass: 'test-authorization-code' } }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: { name: '乐学家长中心', address: 'zhilefang5156@163.com' }, to: email,
      subject: '乐学重置密码验证码', text: expect.stringContaining('012345') }));
  } finally { transport.mockRestore(); }
});

it('加密DNS每次查询动态地址，固定邮件域名，拒绝无地址和非HTTPS解析器', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ Status: 0, Answer: [
    { type: 5, data: 'alias.example' }, { type: 1, data: '103.129.252.45' }, { type: 1, data: 'invalid' },
  ] })));
  expect(await resolveSmtpEndpoints({}, request)).toEqual(['smtp.163.com']);
  expect(request).not.toHaveBeenCalled();
  expect(await resolveSmtpEndpoints({ SMTP_DNS_RESOLVER_URL: 'https://dns.example/resolve' }, request)).toEqual(['103.129.252.45']);
  const url = request.mock.calls[0][0];
  expect(url.searchParams.get('name')).toBe('smtp.163.com');
  await expect(resolveSmtpEndpoints({ SMTP_DNS_RESOLVER_URL: 'http://dns.example/resolve' }, request)).rejects.toThrow('HTTPS');
  request.mockResolvedValue(new Response(JSON.stringify({ Status: 2 })));
  await expect(resolveSmtpEndpoints({ SMTP_DNS_RESOLVER_URL: 'https://dns.example/resolve' }, request)).rejects.toThrow('有效地址');
});

it('连接失败可切换地址，保持证书域名校验，认证失败不重试且不泄露凭据', async () => {
  const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ Status: 0,
    Answer: [{ type: 1, data: '220.197.33.205' }, { type: 1, data: '103.129.252.45' }] })));
  const first = { sendMail: vi.fn().mockRejectedValue(Object.assign(new Error('connection'), { code: 'ESOCKET', command: 'CONN' })), close: vi.fn() };
  const second = { sendMail: vi.fn().mockResolvedValue({}), close: vi.fn() };
  const transport = vi.spyOn(nodemailer, 'createTransport').mockReturnValueOnce(first).mockReturnValueOnce(second);
  const config = { SMTP_AUTH_CODE: 'private-code', SMTP_DNS_RESOLVER_URL: 'https://dns.example/resolve' };
  try {
    await createVerificationMailer(config)({ email, code: '012345', purpose: 'reset' });
    expect(transport).toHaveBeenNthCalledWith(2, expect.objectContaining({ host: '103.129.252.45', secure: true, tls: { servername: 'smtp.163.com' } }));
    expect(first.close).toHaveBeenCalled(); expect(second.close).toHaveBeenCalled();
    transport.mockClear(); transport.mockReturnValue({ sendMail: vi.fn().mockRejectedValue(Object.assign(new Error('private-code'), { code: 'EAUTH', command: 'AUTH PLAIN' })), close: vi.fn() });
    await expect(createVerificationMailer(config)({ email, code: '012345', purpose: 'reset' })).rejects.toMatchObject({ status: 503, publicMessage: expect.stringContaining('认证失败') });
    expect(transport).toHaveBeenCalledOnce();
  } finally { request.mockRestore(); transport.mockRestore(); }
});
