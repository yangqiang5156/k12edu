import { describe, expect, it } from 'vitest';
import { isPinResetAnswerCorrect, pickPinResetChallenge, PIN_RESET_CHALLENGES } from './pin-challenges';

describe('家长密码重置数学验证', () => {
  it('题库包含多道六年级数学题，并可稳定抽取', () => {
    expect(PIN_RESET_CHALLENGES.length).toBeGreaterThanOrEqual(5);
    expect(pickPinResetChallenge(() => 0)).toEqual(PIN_RESET_CHALLENGES[0]);
    expect(pickPinResetChallenge(() => 0.999)).toEqual(PIN_RESET_CHALLENGES.at(-1));
  });

  it('只有正确答案可以通过验证', () => {
    const challenge = PIN_RESET_CHALLENGES[0];
    expect(isPinResetAnswerCorrect(challenge, ' 80 ')).toBe(true);
    expect(isPinResetAnswerCorrect(challenge, '81')).toBe(false);
  });
});
