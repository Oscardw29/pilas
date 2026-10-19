import type { HabitRelation, RelationType } from '@/types';

/**
 * Cómo se dibuja y se nombra cada tipo de conexión en el mapa.
 *
 * En el mapa todas las flechas apuntan «río abajo»: salen de lo que ocurre primero (o influye)
 * y llegan a lo que viene después (o recibe el efecto). Por eso «después de» y «depende de»
 * se dibujan al revés de como se guardan: A «depende de» B se ve como B → A.
 */
export type EdgeKind = 'facilitates' | 'sequence' | 'requires' | 'blocks' | 'goal';

export interface EdgeKindMeta {
  label: string;
  /** Explicación corta para la leyenda */
  hint: string;
  color: string;
  dash?: string;
  width: number;
}

export const EDGE_KINDS: Record<EdgeKind, EdgeKindMeta> = {
  facilitates: { label: 'Facilita', hint: 'Hacer uno hace más fácil el otro', color: 'var(--success)', width: 2.4 },
  sequence: { label: 'Secuencia', hint: 'Uno va justo antes del otro', color: 'var(--info)', dash: '8 5', width: 2.2 },
  requires: { label: 'Requisito', hint: 'Hay que hacer uno para poder hacer el otro', color: 'var(--warning)', dash: '2 5', width: 2.6 },
  blocks: { label: 'Bloquea si falla', hint: 'Si uno falla, el otro se cae', color: 'var(--danger)', dash: '12 4 3 4', width: 2.2 },
  goal: { label: 'Aporta a objetivo', hint: 'El hábito suma al objetivo', color: 'var(--muted)', width: 1.4 },
};

export const EDGE_KIND_ORDER: EdgeKind[] = ['facilitates', 'sequence', 'requires', 'blocks', 'goal'];

export const edgeKindOf = (type: RelationType): EdgeKind => {
  switch (type) {
    case 'facilitates': return 'facilitates';
    case 'before':
    case 'after': return 'sequence';
    case 'depends_on': return 'requires';
    case 'blocks': return 'blocks';
  }
};

/** Dirección visual de la flecha (de → a) para una relación guardada. */
export const flowOf = (rel: HabitRelation): { from: string; to: string } =>
  rel.type === 'after' || rel.type === 'depends_on'
    ? { from: rel.toId, to: rel.fromId }
    : { from: rel.fromId, to: rel.toId };

/** Frase de la relación tal como se guardó: «{pre} A {mid} B». */
export const RELATION_PHRASE: Record<RelationType, { pre?: string; mid: string }> = {
  facilitates: { mid: 'facilita' },
  before: { mid: 'va antes de' },
  after: { mid: 'va después de' },
  depends_on: { mid: 'depende de' },
  blocks: { pre: 'Si', mid: 'falla, bloquea' },
};

export interface RelationOption {
  type: RelationType;
  title: string;
  /** Ejemplo para que se entienda sin teoría */
  example: string;
}

/** Opciones que se ofrecen al crear una conexión (en el orden en que se muestran). */
export const RELATION_OPTIONS: RelationOption[] = [
  { type: 'facilitates', title: 'Facilita', example: 'Dormir temprano facilita hacer ejercicio' },
  { type: 'before', title: 'Va antes de', example: 'Meditar va antes de estudiar' },
  { type: 'after', title: 'Va después de', example: 'Leer va después de cenar' },
  { type: 'depends_on', title: 'Depende de', example: 'Crear proyectos depende de estudiar' },
  { type: 'blocks', title: 'Si falla, bloquea', example: 'Si no duermo bien, no entreno' },
];
