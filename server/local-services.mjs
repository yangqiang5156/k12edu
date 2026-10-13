import { trustedClientIp } from './edge-security.mjs';
import { createDatabase } from './database.mjs';
import { createIdentityService } from './identity.mjs';
import { createTtsMiddleware } from './tts.mjs';
import { createContentGeneratorMiddleware } from './content-generator.mjs';
import { createUsageService } from './usage.mjs';

// 本地预览使用独立访客会话，不访问部署配置中的云数据库。
export function createLocalServices(env, request = fetch) {
  const localEnv = { ...env, DATABASE_URL: '', DATABASE_REQUIRED: 'false',
    SESSION_SECRET: env.SESSION_SECRET ? `${env.SESSION_SECRET}:local-development` : undefined };
  const database = createDatabase(localEnv);
  const identity = createIdentityService(database, localEnv);
  const usage = createUsageService(database, identity, localEnv);
  const tts = createTtsMiddleware(localEnv, request, { usage });
  const content = createContentGeneratorMiddleware(localEnv, request, { usage });
  return (req, res, next) => { req.clientIp = trustedClientIp(req, { TRUSTED_PROXY_IPS: 'none' }); return identity.handle(req, res, () => content(req, res, () => tts(req, res, next))); };
}
