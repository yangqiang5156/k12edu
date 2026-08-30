export interface PinResetChallenge {
  question: string;
  answer: string;
}

export const PIN_RESET_CHALLENGES: PinResetChallenge[] = [
  { question: '一个数的 3/5 是 48，这个数是多少？', answer: '80' },
  { question: '解方程：x ÷ 4 + 7 = 19，x 等于多少？', answer: '48' },
  { question: '甲、乙两数的比是 3∶5，两数之和是 64，甲数是多少？', answer: '24' },
  { question: '一件商品原价 240 元，打八五折后是多少元？', answer: '204' },
  { question: '2.5 ×（12 − 4.8）的结果是多少？', answer: '18' },
  { question: '一个长方形长 15 厘米、宽 8 厘米，它的面积是多少平方厘米？', answer: '120' }
];

export function pickPinResetChallenge(random = Math.random): PinResetChallenge {
  return PIN_RESET_CHALLENGES[Math.floor(random() * PIN_RESET_CHALLENGES.length)];
}

export function isPinResetAnswerCorrect(challenge: PinResetChallenge, answer: string): boolean {
  return answer.trim() === challenge.answer;
}
