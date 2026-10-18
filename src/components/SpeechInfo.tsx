import { useId, useState } from 'react';

export function SpeechInfo() {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <span className={`speech-info ${open ? 'is-open' : ''}`}>
    <button type="button" className="speech-info-button" aria-label="朗读说明" aria-describedby={id} aria-expanded={open}
      onClick={() => setOpen(!open)} onBlur={() => setOpen(false)} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.currentTarget.blur(); } }}>i</button>
    <span id={id} role="tooltip" className="speech-info-text">未登录时使用设备朗读，在家长中心登录后可获取更好的朗读体验。</span>
  </span>;
}
