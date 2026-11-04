import React, { useCallback, useEffect, useState } from 'react';
import { DatabaseZap, ShieldAlert } from 'lucide-react';
import { useSocial } from '@/social/useSocial';
import { useIsCreator } from '@/lib/creator';
import { AiServicesTab } from '@/components/creator/AiServicesTab';
import { CatalogTab } from '@/components/creator/CatalogTab';
import { EconomyTab } from '@/components/creator/EconomyTab';
import { LeaguesAchievementsTab } from '@/components/creator/LeaguesAchievementsTab';
import { ModerationTab } from '@/components/creator/ModerationTab';
import { TestSettingsTab } from '@/components/creator/TestSettingsTab';
import { TrashTab } from '@/components/creator/TrashTab';
import { purgeExpired, useCreatorTrash } from '@/components/creator/creatorTrash';
import '@/components/creator/creator.css';

/**
 * PANEL DEL CREADOR (/creador)
 * Solo se muestra si el servidor dice que esta cuenta es la del creador (`is_admin()`). Ocultarlo aquí no da permisos:
 * cada escritura (catálogo, economía, logros, moderación) la vuelve a comprobar el servidor.
 */

const TABS = [
  { id: 'catalog', label: 'Catálogo' },
  { id: 'economy', label: 'Economía' },
  { id: 'leagues', label: 'Ligas y logros' },
  { id: 'moderation', label: 'Moderación' },
  { id: 'ai', label: 'IA de la app' },
  { id: 'tests', label: 'Ajustes de prueba' },
  { id: 'trash', label: 'Papelera' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const TAB_KEY = 'constancia_creator_tab';

const readTab = (): TabId => {
  try {
    const t = localStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.id === t) ? (t as TabId) : 'catalog';
  } catch {
    return 'catalog';
  }
};

const Head: React.FC = () => (
  <div className="page-head">
    <div>
      <p className="eyebrow">Solo tu cuenta</p>
      <h1>Panel del creador</h1>
    </div>
  </div>
);

export const CreatorView: React.FC = () => {
  const isAdmin = useSocial((s) => s.isAdmin);
  const available = useSocial((s) => s.available);
  const phase = useSocial((s) => s.phase);
  // Solo para los ajustes de prueba de este dispositivo mientras el servidor no tenga la capa pública
  const isCreator = useIsCreator();
  const [tab, setTabState] = useState<TabId>(readTab);
  const [economyFocus, setEconomyFocus] = useState<string | null>(null);

  const setTab = (t: TabId) => {
    setTabState(t);
    try {
      localStorage.setItem(TAB_KEY, t);
    } catch {
      /* sin almacenamiento: se abre en Catálogo */
    }
  };
  const clearFocus = useCallback(() => setEconomyFocus(null), []);
  const trashCount = useCreatorTrash((s) => s.entries.length);

  // Lo que lleva más de 24 h en la papelera se borra para siempre al abrir el panel
  useEffect(() => {
    if (isAdmin) void purgeExpired();
  }, [isAdmin]);

  if (!available) {
    return (
      <div className="stack fade-up">
        <Head />
        <div className="card">
          <div className="empty">
            <div className="empty-icon">
              <DatabaseZap />
            </div>
            <h3>El servidor aún no tiene la capa pública</h3>
            <p>
              Aplica la migración <code>supabase/migrations/0002_social.sql</code> en el editor SQL de Supabase y añade tu cuenta a <code>app_admins</code>. Después vuelve
              a abrir la app: el catálogo, la economía, las ligas y la moderación aparecerán aquí.
            </p>
          </div>
        </div>
        {isCreator && <TestSettingsTab />}
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="stack fade-up">
        <Head />
        <div className="card">
          <div className="empty">
            <div className="empty-icon">
              <ShieldAlert />
            </div>
            {phase === 'loading' || phase === 'off' ? (
              <>
                <h3>Comprobando tu cuenta…</h3>
                <p>Un momento.</p>
              </>
            ) : (
              <>
                <h3>Solo para la cuenta del creador</h3>
                <p>Esta página es para administrar la tienda, la economía y la moderación de ¡Pilas!.</p>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack fade-up">
      <Head />
      <div className="segmented creator-tabs" role="tablist" aria-label="Secciones del panel">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`creator-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="creator-panel"
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'trash' && trashCount > 0 && <span className="creator-tab-count">{trashCount}</span>}
          </button>
        ))}
      </div>
      <div id="creator-panel" role="tabpanel" aria-labelledby={`creator-tab-${tab}`}>
        {tab === 'catalog' && <CatalogTab />}
        {tab === 'economy' && <EconomyTab focus={economyFocus} onFocused={clearFocus} />}
        {tab === 'leagues' && (
          <LeaguesAchievementsTab
            onEditLeagues={() => {
              setEconomyFocus('leagues');
              setTab('economy');
            }}
          />
        )}
        {tab === 'moderation' && <ModerationTab />}
        {tab === 'ai' && <AiServicesTab />}
        {tab === 'tests' && <TestSettingsTab />}
        {tab === 'trash' && <TrashTab />}
      </div>
    </div>
  );
};
