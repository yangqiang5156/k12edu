import './load-env.mjs';
import { createDatabase, initializeDatabase } from './database.mjs';
const args = process.argv.slice(2);
const email = args[args.indexOf('--email') + 1];
const changes = args.filter(arg => ['--admin', '--no-admin', '--paid', '--no-paid'].includes(arg));
if (!args.includes('--email') || !email?.includes('@') || !changes.length || (args.includes('--admin') && args.includes('--no-admin')) || (args.includes('--paid') && args.includes('--no-paid'))) {
  throw new Error('用法：node server/manage-access.mjs --email 已注册邮箱 [--admin|--no-admin] [--paid|--no-paid]');
}
const db = createDatabase();
try {
  await initializeDatabase(db);
  await db.transaction(async client => {
    const result = await client.query('SELECT id,family_id FROM parent_users WHERE email=$1 FOR UPDATE', [email.toLowerCase()]);
    const user = result.rows[0];
    if (!user) throw new Error('邮箱未注册');
    if (args.includes('--admin') || args.includes('--no-admin')) await client.query('UPDATE parent_users SET is_admin=$1 WHERE id=$2', [args.includes('--admin'), user.id]);
    if (args.includes('--paid') || args.includes('--no-paid')) await client.query('UPDATE families SET paid_enabled=$1,updated_at=now() WHERE id=$2', [args.includes('--paid'), user.family_id]);
  });
  console.log('账号权限已更新');
} finally { await db.close(); }
