import { createHash } from 'node:crypto';
export const limitError = (message = '请求较多，请稍后再试', retryAfter = 60) => Object.assign(new Error(message), { status: 429, retryAfter });
export function createRateLimiter(database, { maxKeys = 10000, clock = Date.now } = {}) {
  const windows = new Map(); let cleanup = 0;
  return async (scope, limit, milliseconds) => {
    if (!Number.isSafeInteger(limit) || limit < 1) throw limitError();
    const now = clock(), expires = new Date((Math.floor(now / milliseconds) + 1) * milliseconds);
    const retryAfter = Math.max(1, Math.ceil((expires.getTime() - now) / 1000));
    const key = createHash('sha256').update(scope).digest('hex');
    if (database.configured) {
      const result = await database.query(`INSERT INTO api_rate_windows(key,count,expires_at) VALUES($1,1,$2)
        ON CONFLICT(key) DO UPDATE SET
        count=CASE WHEN api_rate_windows.expires_at<=now() THEN 1 ELSE api_rate_windows.count+1 END,
        expires_at=CASE WHEN api_rate_windows.expires_at<=now() THEN EXCLUDED.expires_at ELSE api_rate_windows.expires_at END
        WHERE api_rate_windows.expires_at<=now() OR api_rate_windows.count<$3 RETURNING count`, [key, expires, limit]);
      if (!result.rows.length) throw limitError(undefined, retryAfter);
      if (now - cleanup > 60000) { cleanup = now; await database.query('DELETE FROM api_rate_windows WHERE expires_at<now()'); }
      return;
    }
    for (const [id, value] of windows) if (value.expires <= now) windows.delete(id);
    const current = windows.get(key);
    if ((!current && windows.size >= maxKeys) || (current?.count || 0) >= limit) throw limitError(undefined, retryAfter);
    windows.set(key, { count: (current?.count || 0) + 1, expires: expires.getTime() });
  };
}
