import React, { useEffect, useState } from 'react';
import './coach.css';

interface CoachSpeechProps {
  line: string;
  /** Colocación en cada escena */
  className?: string;
}

/** Bocadillo del coach: la frase se escribe letra a letra cada vez que cambia */
export const CoachSpeech: React.FC<CoachSpeechProps> = ({ line, className = '' }) => {
  const [typed, setTyped] = useState(0);
  const chars = Array.from(line);
  useEffect(() => setTyped(0), [line]);
  useEffect(() => {
    if (typed >= chars.length) return;
    const t = setTimeout(() => setTyped((n) => n + 1), typed === 0 ? 450 : 30);
    return () => clearTimeout(t);
  }, [typed, chars.length]);

  return (
    <div className={`coach-speech ${className}`}>
      {chars.slice(0, typed).join('')}
      <span className="coach-speech-ghost">{chars.slice(typed).join('')}</span>
    </div>
  );
};
