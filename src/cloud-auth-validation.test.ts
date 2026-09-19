import { describe, expect, it } from 'vitest';
import { validateCloudCredentials } from './cloud-auth-validation';

describe('家庭账号表单校验', () => {
  it('注册时明确提示密码至少10个字符', () => {
    expect(validateCloudCredentials('register', 'parent@example.com', '12345678')).toBe('注册密码至少需要10个字符');
  });

  it('登录时允许提交历史短密码，由服务端验证', () => {
    expect(validateCloudCredentials('login', 'parent@example.com', '12345678')).toBeUndefined();
  });

  it('提交前提示缺失或错误的邮箱和密码', () => {
    expect(validateCloudCredentials('login', '', 'password')).toBe('请输入家长邮箱');
    expect(validateCloudCredentials('login', 'parent', 'password')).toBe('请输入有效的家长邮箱');
    expect(validateCloudCredentials('login', 'parent@example.com', '')).toBe('请输入密码');
  });
});
