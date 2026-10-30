import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { useHasAi } from '@/lib/appAi';
import { useStore } from '@/store/useStore';
import { useCoachPersona } from './coachPersona';

/** Mensajes enviados al coach a partir de los que aparece el aviso */
const MESSAGES_BEFORE_NOTICE = 3;
/** Queda recordado en el dispositivo: borrar las conversaciones no lo quita */
const SEEN_KEY = 'pilas:local-mode-notice';

const readSeen = () => {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
};

/**
 * AVISO DE MODO LOCAL, dentro del chat
 * Sale cuando no hay IA (ni clave propia ni la de la app) y ya se enviaron 3 mensajes. No se puede cerrar: solo
 * desaparece cuando hay una clave. En cuanto el creador pone las suyas en su panel, deja de mostrarse a todos.
 */
export const LocalModeNotice: React.FC = () => {
  const persona = useCoachPersona();
  const hasAi = useHasAi();
  const sent = useStore((s) =>
    (s.conversations ?? []).reduce((n, c) => n + (c.messages as { sender?: string }[]).filter((m) => m.sender === 'user').length, 0),
  );
  const [seen, setSeen] = useState(readSeen);
  const reached = seen || sent >= MESSAGES_BEFORE_NOTICE;

  useEffect(() => {
    if (seen || sent < MESSAGES_BEFORE_NOTICE) return;
    setSeen(true);
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* sin almacenamiento: se vuelve a calcular con los mensajes */
    }
  }, [seen, sent]);

  if (hasAi || !reached) return null;

  return (
    <div className="callout attention coach-local-notice" role="note">
      <KeyRound aria-hidden="true" />
      <div className="grow">
        <div className="title">Modo Local Algorítmico Activo</div>
        <div className="detail">
          {persona.name} está respondiendo con el motor analítico local. Para activar los modelos de IA, añade tu clave de API en Ajustes.
        </div>
        <Link to="/ajustes" className="btn btn-secondary sm">
          Configurar clave
        </Link>
      </div>
    </div>
  );
};
