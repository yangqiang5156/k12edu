export type CloudAuthMode = 'login' | 'register';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCloudCredentials(mode: CloudAuthMode, email: string, password: string): string | undefined {
  if (!email.trim()) return '请输入家长邮箱';
  if (!emailPattern.test(email.trim())) return '请输入有效的家长邮箱';
  if (!password) return '请输入密码';
  if (mode === 'register' && password.length < 10) return '注册密码至少需要10个字符';
  if (password.length > 128) return '密码不能超过128个字符';
  return undefined;
}
