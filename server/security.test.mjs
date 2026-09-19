import { describe, expect, it } from 'vitest';
import { createAccessToken, hashPassword, verifyAccessToken, verifyPassword } from './security.mjs';

describe('账号安全工具', () => {
  it('签名会话可验证且篡改后失效', () => {
    const secret = 'a'.repeat(48);
    const token = createAccessToken({ type: 'guest', deviceId: 'device-1234567890' }, secret, 60);
    expect(verifyAccessToken(token, secret)).toMatchObject({ type: 'guest', deviceId: 'device-1234567890' });
    expect(verifyAccessToken(`${token}x`, secret)).toBeUndefined();
    expect(verifyAccessToken(token, 'b'.repeat(48))).toBeUndefined();
  });

  it('使用带盐 scrypt 保存家长密码', async () => {
    const stored = await hashPassword('correct-horse-battery');
    expect(stored).toMatch(/^scrypt\$16384\$/);
    await expect(verifyPassword('correct-horse-battery', stored)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', stored)).resolves.toBe(false);
  });
});
