import { useEffect, useState } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { sfx } from '../lib/fx.js';

/** Mute / unmute the interface sounds (persisted in localStorage). */
export default function SoundToggle({ className = '' }) {
  const [on, setOn] = useState(sfx.enabled);
  useEffect(() => sfx.subscribe(setOn), []);
  return <button type="button" className={`btn px-2 ${className}`} aria-pressed={on} aria-label={on ? 'Sound on' : 'Sound off'} title={on ? 'Звук включён' : 'Звук выключен'} onClick={() => sfx.set(!on)}>{on ? <Volume2 size={16} /> : <VolumeX size={16} />}</button>;
}
