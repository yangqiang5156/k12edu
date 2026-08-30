import { useState } from 'react';
import { hashPin, randomSalt } from '../db';
import { isPinResetAnswerCorrect, pickPinResetChallenge } from '../pin-challenges';
import type { ParentSettings } from '../types';

interface Props {
  settings: ParentSettings;
  onSaveSettings: (settings: ParentSettings) => Promise<void>;
  onUnlock: () => void;
  onClose: () => void;
}

export function PinGate({ settings, onSaveSettings, onUnlock, onClose }: Props) {
  const [mode, setMode] = useState<'verify' | 'challenge' | 'reset'>('verify');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [challenge] = useState(() => pickPinResetChallenge());
  const [challengeAnswer, setChallengeAnswer] = useState('');
  const [error, setError] = useState('');
  const isSetup = !settings.pinHash;

  const submit = async () => {
    if (!/^\d{4}$/.test(pin)) return setError('请输入4位数字');
    if (isSetup) {
      if (pin !== confirmPin) return setError('两次输入不一致');
      const salt = randomSalt();
      await onSaveSettings({ ...settings, pinSalt: salt, pinHash: await hashPin(pin, salt) });
      onUnlock();
      return;
    }
    const hash = await hashPin(pin, settings.pinSalt!);
    if (hash !== settings.pinHash) return setError('口令不对，请再试一次');
    onUnlock();
  };

  const checkChallenge = () => {
    if (!isPinResetAnswerCorrect(challenge, challengeAnswer)) {
      setError('答案不正确，请再认真算一算');
      return;
    }
    setError('');
    setPin('');
    setConfirmPin('');
    setMode('reset');
  };

  const resetPin = async () => {
    if (!/^\d{4}$/.test(pin)) return setError('新密码必须是4位数字');
    if (pin !== confirmPin) return setError('两次输入的新密码不一致');
    const salt = randomSalt();
    await onSaveSettings({ ...settings, pinSalt: salt, pinHash: await hashPin(pin, salt) });
    onUnlock();
  };

  const startReset = () => {
    setError('');
    setChallengeAnswer('');
    setMode('challenge');
  };

  return (
    <div className="modal-backdrop">
      <section className="pin-card" role="dialog" aria-modal="true">
        <button className="icon-button pin-close" onClick={onClose}>×</button>
        <div className="parent-icon">{mode === 'challenge' ? '🧮' : mode === 'reset' ? '🔐' : '👨‍👩‍👦'}</div>
        {mode === 'verify' && <>
          <h2>{isSetup ? '设置家长密码' : '家长验证'}</h2>
          <p>{isSetup ? '用4位数字保护任务和奖励设置。' : '请输入4位数字密码进入家长中心。'}</p>
          <input className="pin-input" aria-label="家长密码" value={pin} maxLength={4} inputMode="numeric" type="password" placeholder="••••" onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          {isSetup && <input className="pin-input" aria-label="确认家长密码" value={confirmPin} maxLength={4} inputMode="numeric" type="password" placeholder="再次输入" onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))} />}
          {error && <span className="form-error">{error}</span>}
          <button className="primary-button" onClick={submit}>{isSetup ? '保存并进入' : '进入家长中心'}</button>
          {!isSetup && <button className="pin-reset-link" onClick={startReset}>忘记密码？通过数学题重置</button>}
          <small>密码只用于防止孩子误触。</small>
        </>}

        {mode === 'challenge' && <>
          <h2>先完成一道数学题</h2>
          <p>回答正确后，才可以设置新的家长密码。</p>
          <div className="pin-math-question">{challenge.question}</div>
          <input className="challenge-input" aria-label="数学题答案" value={challengeAnswer} inputMode="decimal" placeholder="请输入答案" onChange={(event) => setChallengeAnswer(event.target.value.replace(/[^\d.\-/]/g, ''))} />
          {error && <span className="form-error">{error}</span>}
          <button className="primary-button" onClick={checkChallenge}>提交答案</button>
          <button className="pin-reset-link" onClick={() => { setError(''); setMode('verify'); }}>返回密码验证</button>
        </>}

        {mode === 'reset' && <>
          <h2>设置新的家长密码</h2>
          <p>数学题回答正确，请输入两次新的4位数字密码。</p>
          <input className="pin-input" aria-label="新家长密码" value={pin} maxLength={4} inputMode="numeric" type="password" placeholder="新密码" onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} />
          <input className="pin-input" aria-label="确认新家长密码" value={confirmPin} maxLength={4} inputMode="numeric" type="password" placeholder="再次输入" onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, ''))} />
          {error && <span className="form-error">{error}</span>}
          <button className="primary-button" onClick={resetPin}>保存新密码并进入</button>
        </>}
      </section>
    </div>
  );
}
