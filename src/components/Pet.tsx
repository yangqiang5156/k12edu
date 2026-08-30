import { useState } from 'react';
import { petLevel } from '../logic';
import type { ParentSettings, PetState, Wallet } from '../types';

const PETS = {
  stella: { name: '星黛露', ears: 'star', color: '#b69af0', accent: '#8c72d8' },
  archie: { name: '阿奇', ears: 'round', color: '#efb56f', accent: '#bc764d' },
  marie: { name: '玛丽猫', ears: 'point', color: '#fff2ec', accent: '#e78ba6' }
} as const;

interface Props {
  pet: PetState;
  wallet: Wallet;
  settings: ParentSettings;
  onFeed: () => void;
}

export function Pet({ pet, wallet, settings, onFeed }: Props) {
  const [bouncing, setBouncing] = useState(false);
  const info = PETS[pet.selected];
  const level = petLevel(wallet.xp);
  const interact = () => {
    setBouncing(true);
    window.setTimeout(() => setBouncing(false), settings.reduceMotion ? 50 : 700);
  };

  return (
    <section className="pet-card">
      <div className="pet-copy">
        <span className="eyebrow">我的学习伙伴</span>
        <strong>{info.name} · Lv.{level}</strong>
        <span className="pet-message">{pet.mood > 75 ? '今天也要开心学习呀！' : '摸摸我，再喂我一点吧～'}</span>
        <div className="xp-track"><i style={{ width: `${wallet.xp % 100}%` }} /></div>
        <small>再有 {100 - (wallet.xp % 100 || 0)} 经验升级外观</small>
      </div>
      <button className={`pet-button ${bouncing ? 'is-bouncing' : ''}`} aria-label={`和${info.name}互动`} onClick={interact}>
        <svg viewBox="0 0 160 170" role="img">
          {info.ears === 'round' && <><circle cx="42" cy="42" r="30" fill={info.accent}/><circle cx="118" cy="42" r="30" fill={info.accent}/></>}
          {info.ears === 'point' && <><path d="M24 67L38 10l39 42" fill={info.accent}/><path d="M136 67L122 10 83 52" fill={info.accent}/></>}
          {info.ears === 'star' && <><path d="M17 58L28 22l21 22 23-12-8 42" fill={info.accent}/><path d="M143 58l-11-36-21 22-23-12 8 42" fill={info.accent}/></>}
          <ellipse cx="80" cy="93" rx="60" ry="64" fill={info.color}/>
          <ellipse cx="58" cy="86" rx="7" ry="10" fill="#433a5d"/><ellipse cx="103" cy="86" rx="7" ry="10" fill="#433a5d"/>
          <circle cx="55" cy="83" r="2.5" fill="white"/><circle cx="100" cy="83" r="2.5" fill="white"/>
          <path d="M73 108q8 10 16 0" fill="none" stroke="#433a5d" strokeWidth="5" strokeLinecap="round"/>
          <circle cx="45" cy="106" r="8" fill="#f2a4b4" opacity=".55"/><circle cx="115" cy="106" r="8" fill="#f2a4b4" opacity=".55"/>
          {level >= 2 && <path d="M52 32l8-15 9 15 16-2-10 13 7 15-17-5-13 11 1-17-14-9z" fill="#ffd861"/>}
        </svg>
        <span className="tap-hint">点点我</span>
      </button>
      <button className="feed-button" onClick={onFeed} disabled={wallet.foodHalfUnits < 2}>🥕 喂食 -1 粮</button>
    </section>
  );
}
