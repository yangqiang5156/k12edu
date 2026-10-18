import { createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import { isIP } from 'node:net';

export const verificationError = () => Object.assign(new Error('验证码或验证凭证无效、已过期，请重新验证邮箱'), { status: 400 });
// 可选加密DNS仅用于本机代理虚拟DNS等环境，生产默认继续使用系统DNS。
export async function resolveSmtpEndpoints(env, request = fetch) {
  if (!env.SMTP_DNS_RESOLVER_URL?.trim()) return ['smtp.163.com'];
  const url = new URL(env.SMTP_DNS_RESOLVER_URL.trim());
  if (url.protocol !== 'https:') throw new Error('SMTP DNS解析器必须使用HTTPS');
  url.searchParams.set('name', 'smtp.163.com'); url.searchParams.set('type', 'A');
  const query = () => request(url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/dns-json' } });
  // 本地代理重连时可能出现瞬时超时；DNS查询可安全重试，邮件提交本身不重试。
  let response;
  try { response = await query(); } catch { response = await query(); }
  if (!response.ok) throw new Error('SMTP DNS解析失败');
  const data = await response.json();
  const addresses = [...new Set((data.Answer || []).filter(item => item.type === 1 && isIP(item.data) === 4).map(item => item.data))];
  if (data.Status !== 0 || !addresses.length) throw new Error('SMTP DNS解析未返回有效地址');
  return addresses.slice(0, 4);
}

function mailError(error) {
  const auth = error?.code === 'EAUTH';
  const message = auth ? '发信邮箱认证失败，请检查SMTP授权码或SMTP服务是否已开启'
    : '验证码邮件发送失败，请稍后重试或联系管理员检查邮件服务连接';
  return Object.assign(new Error(message), { status: auth ? 503 : 502, publicMessage: message });
}

export function createVerificationMailer(env) {
  const sender = 'zhilefang5156@163.com';
  return async ({ email, code, purpose }) => {
    if (!env.SMTP_AUTH_CODE?.trim()) throw Object.assign(new Error('邮箱验证码服务尚未配置'), { status: 503, publicMessage: '邮箱验证码服务尚未配置，请联系管理员' });
    let hosts;
    try { hosts = await resolveSmtpEndpoints(env); }
    catch { throw mailError(); }
    for (const [index, host] of hosts.entries()) {
      const transport = nodemailer.createTransport({
        host, port: 465, secure: true, tls: { servername: 'smtp.163.com' },
        auth: { user: sender, pass: env.SMTP_AUTH_CODE.trim() },
        connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000,
        disableFileAccess: true, disableUrlAccess: true,
      });
      try {
        await transport.sendMail({ from: { name: '乐学家长中心', address: sender }, to: email,
          subject: `乐学${purpose === 'register' ? '注册' : '重置密码'}验证码`,
          text: `您的6位邮箱验证码为：${code}\n验证码10分钟内有效，请勿向他人透露。如非本人操作，请忽略此邮件。`,
        });
        return;
      } catch (error) {
        // 只在连接/握手阶段失败时切换地址，避免邮件已提交后重试造成重复投递。
        const connecting = ['CONN', 'EHLO', 'STARTTLS'].includes(error.command);
        if (!connecting || index === hosts.length - 1) {
          console.warn('SMTP发信失败', { code: error.code, command: error.command, responseCode: error.responseCode });
          throw mailError(error);
        }
      } finally { transport.close(); }
    }
  };
}

export function createEmailVerification(database, secret, sendMail) {
  const digest = value => createHmac('sha256', secret).update(value).digest('hex');
  const codeHash = (email, purpose, code) => digest(`${email}:${purpose}:${code}`);
  return {
    async send(email, purpose) {
      const id = randomUUID(), code = String(randomInt(0, 1000000)).padStart(6, '0');
      await database.query('DELETE FROM email_verifications WHERE expires_at<=now()');
      const result = await database.query(`INSERT INTO email_verifications(email,purpose,id,code_hash,expires_at,sent_at)
        VALUES($1,$2,$3,NULL,now()+interval '10 minutes',now())
        ON CONFLICT(email,purpose) DO UPDATE SET id=EXCLUDED.id,code_hash=NULL,token_hash=NULL,attempts=0,
        expires_at=EXCLUDED.expires_at,sent_at=now()
        WHERE email_verifications.sent_at<=now()-interval '60 seconds' RETURNING id`, [email, purpose, id]);
      if (!result.rows.length) throw Object.assign(new Error('请等待60秒后再获取验证码'), { status: 429, retryAfter: 60 });
      try {
        await sendMail({ email, purpose, code });
        await database.query('UPDATE email_verifications SET code_hash=$1 WHERE email=$2 AND purpose=$3 AND id=$4', [codeHash(email, purpose, code), email, purpose, id]);
      } catch (error) {
        await database.query('DELETE FROM email_verifications WHERE email=$1 AND purpose=$2 AND id=$3', [email, purpose, id]);
        throw error;
      }
    },
    async verify(email, purpose, code) {
      if (!/^\d{6}$/.test(code)) throw verificationError();
      const result = await database.query(`UPDATE email_verifications SET attempts=attempts+1
        WHERE email=$1 AND purpose=$2 AND expires_at>now() AND attempts<5 AND code_hash IS NOT NULL AND token_hash IS NULL
        RETURNING id,code_hash`, [email, purpose]);
      const row = result.rows[0], actual = codeHash(email, purpose, code);
      if (!row || !timingSafeEqual(Buffer.from(row.code_hash), Buffer.from(actual))) throw verificationError();
      const token = randomBytes(32).toString('base64url');
      const verified = await database.query(`UPDATE email_verifications SET token_hash=$1,code_hash=NULL
        WHERE email=$2 AND purpose=$3 AND id=$4 AND code_hash=$5 AND token_hash IS NULL RETURNING id`, [digest(token), email, purpose, row.id, actual]);
      if (!verified.rows.length) throw verificationError();
      return token;
    },
    async consume(client, email, purpose, token) {
      if (typeof token !== 'string' || token.length > 128 || !token) throw verificationError();
      const result = await client.query(`DELETE FROM email_verifications
        WHERE email=$1 AND purpose=$2 AND token_hash=$3 AND expires_at>now() RETURNING id`, [email, purpose, digest(token)]);
      if (!result.rows.length) throw verificationError();
    },
  };
}
