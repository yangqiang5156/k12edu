export type CloudAuthMode = 'login' | 'register' | 'reset';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateCloudCredentials(mode: CloudAuthMode, email: string, password: string): string | undefined {
  const error = validateCloudEmail(email);
  if (error) return error;
  if (!password) return '请输入密码';
  if (mode !== 'login' && password.length < 10) return mode === 'reset' ? '新密码至少需要10个字符' : '注册密码至少需要10个字符';
  if (password.length > 128) return '密码不能超过128个字符';
  return undefined;
}

export function validateCloudEmail(email: string): string | undefined {
  if (!email.trim()) return '请输入家长邮箱';
  if (email.trim().length > 254 || !emailPattern.test(email.trim())) return '请输入有效的家长邮箱';
  return undefined;
}
