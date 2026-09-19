import { createHash, createHmac, randomBytes, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const encode = (value) => Buffer.from(value).toString('base64url');
const decode = (value) => Buffer.from(value, 'base64url').toString('utf8');

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function createAccessToken(payload, secret, lifetimeSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const body = encode(JSON.stringify({ ...payload, iat: now, exp: now + lifetimeSeconds }));
  const signature = createHmac('sha256', secret).update(`lx1.${body}`).digest('base64url');
  return `lx1.${body}.${signature}`;
}

export function verifyAccessToken(token, secret) {
  if (typeof token !== 'string') return undefined;
  const [version, body, signature] = token.split('.');
  if (version !== 'lx1' || !body || !signature) return undefined;
  const expected = createHmac('sha256', secret).update(`lx1.${body}`).digest();
  let received;
  try { received = Buffer.from(signature, 'base64url'); } catch { return undefined; }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return undefined;
  try {
    const payload = JSON.parse(decode(body));
    if (!payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return undefined;
    return payload;
  } catch { return undefined; }
}

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, cost, saltText, hashText] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || cost !== '16384' || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, 'base64url');
    const actual = Buffer.from(await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length, { N: 16384, r: 8, p: 1 }));
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch { return false; }
}

export function bearerToken(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}
