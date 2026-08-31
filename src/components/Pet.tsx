import { useState } from 'react';
import { petLevel } from '../logic';
import type { ParentSettings, PetState, Wallet } from '../types';

const PETS = {
  stella: { name: '小兔子', ears: 'rabbit', color: '#d4c1f5', accent: '#8f75d2' },
  archie: { name: '阿奇', ears: 'round', color: '#efb56f', accent: '#bc764d' },
  marie: { name: '玛丽猫', ears: 'point', color: '#fff2ec', accent: '#e78ba6' }
} as const;

interface Props {
  pet: PetState;
  wallet: Wallet;
  settings: ParentSettings;
  feeding: boolean;
  feedAnimation: number;
  onFeed: () => Promise<void>;
}

export function Pet({ pet, wallet, settings, feeding, feedAnimation, onFeed }: Props) {
  const [bouncing, setBouncing] = useState(false);
  const info = PETS[pet.selected];
  const level = petLevel(wallet.xp);
  const interact = () => {
    setBouncing(true);
    window.setTimeout(() => setBouncing(false), settings.reduceMotion ? 50 : 700);
  };

  return (
    <section className={`pet-card ${feeding ? 'is-feeding' : ''}`}>
      <div className="pet-copy">
        <span className="eyebrow">我的学习伙伴</span>
        <strong>{info.name} · Lv.{level}</strong>
        <span className="pet-message">{feeding ? '胡萝卜来啦，啊呜一口！' : pet.mood > 75 ? '今天也要开心学习呀！' : '摸摸我，再喂我一点吧～'}</span>
        <div className="xp-track"><i style={{ width: `${wallet.xp % 100}%` }} /></div>
        <small>再有 {100 - (wallet.xp % 100 || 0)} 经验升级外观</small>
      </div>
      <button className={`pet-button ${bouncing ? 'is-bouncing' : ''} ${feeding ? 'is-eating' : ''}`} aria-label={`和${info.name}互动`} onClick={interact}>
        <svg viewBox="0 0 160 170" role="img">
          {info.ears === 'round' && <><circle cx="42" cy="42" r="30" fill={info.accent}/><circle cx="118" cy="42" r="30" fill={info.accent}/></>}
          {info.ears === 'point' && <><path d="M24 67L38 10l39 42" fill={info.accent}/><path d="M136 67L122 10 83 52" fill={info.accent}/></>}
          {info.ears === 'rabbit' && <>
            <ellipse cx="51" cy="39" rx="19" ry="38" fill={info.color} stroke={info.accent} strokeWidth="4" transform="rotate(-8 51 39)"/>
            <ellipse cx="109" cy="39" rx="19" ry="38" fill={info.color} stroke={info.accent} strokeWidth="4" transform="rotate(8 109 39)"/>
            <ellipse cx="51" cy="38" rx="9" ry="27" fill="#f1a9c2" opacity=".72" transform="rotate(-8 51 38)"/>
            <ellipse cx="109" cy="38" rx="9" ry="27" fill="#f1a9c2" opacity=".72" transform="rotate(8 109 38)"/>
          </>}
          <ellipse cx="80" cy="93" rx="60" ry="64" fill={info.color}/>
          <ellipse cx="58" cy="86" rx="7" ry="10" fill="#433a5d"/><ellipse cx="103" cy="86" rx="7" ry="10" fill="#433a5d"/>
          <circle cx="55" cy="83" r="2.5" fill="white"/><circle cx="100" cy="83" r="2.5" fill="white"/>
          {info.ears === 'rabbit' ? <>
            <path d="M74 103q6-6 12 0-2 7-6 7t-6-7" fill="#d9799b"/>
            <path className="pet-mouth" d="M80 109v5m0 0q-8 8-14 1m14-1q8 8 14 1" fill="none" stroke="#433a5d" strokeWidth="3.5" strokeLinecap="round"/>
            <rect x="72" y="116" width="8" height="10" rx="2" fill="white"/><rect x="80" y="116" width="8" height="10" rx="2" fill="white"/>
            <path d="M45 108l-19-5m19 12-20 3m90-10 19-5m-19 12 20 3" fill="none" stroke="#766a8b" strokeWidth="2" strokeLinecap="round" opacity=".65"/>
          </> : <path className="pet-mouth" d="M73 108q8 10 16 0" fill="none" stroke="#433a5d" strokeWidth="5" strokeLinecap="round"/>}
          <circle cx="45" cy="106" r="8" fill="#f2a4b4" opacity=".55"/><circle cx="115" cy="106" r="8" fill="#f2a4b4" opacity=".55"/>
          {level >= 2 && <path d="M52 32l8-15 9 15 16-2-10 13 7 15-17-5-13 11 1-17-14-9z" fill="#ffd861"/>}
        </svg>
        <span className="tap-hint">点点我</span>
      </button>
      {feeding && <>
        <span className="flying-carrot" key={`flying-carrot-${feedAnimation}`} aria-hidden="true">🥕</span>
        <span className="feed-thanks" key={`feed-thanks-${feedAnimation}`} role="status">好香呀，谢谢你！</span>
        <span className="feed-sparkles" key={`feed-sparkles-${feedAnimation}`} aria-hidden="true"><i>💛</i><i>✨</i><i>⭐</i><i>💛</i></span>
      </>}
      <button className="feed-button" onClick={() => void onFeed()} disabled={wallet.foodHalfUnits < 2 || feeding}>{feeding ? '正在享用…' : '🥕 喂食 -1 粮'}</button>
    </section>
  );
}
