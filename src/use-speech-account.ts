import { useEffect, useState } from 'react';
import { loadCloudAccount } from './cloud';

// 确认登录状态前使用设备朗读，保证首次点击可以直接播放。
export function useSpeechAccount() {
  const [authenticated, setAuthenticated] = useState(false);
  useEffect(() => {
    let active = true;
    void loadCloudAccount().then(account => { if (active) setAuthenticated(account.authenticated); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return authenticated;
}
