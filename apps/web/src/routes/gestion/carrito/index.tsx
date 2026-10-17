/**
 * Gestión ▸ Carrito: the editor screen for the territory-cart roster.
 *
 * Four sub-tabs share one data load: the public cart board (`cart_places`, `cart_slots`,
 * `cart_schedules`, `cart_assignments`, `cart_blackouts`) and the editor-only people roster.
 */
import { useState, type ReactNode } from 'react';
import { useCartSchedule, usePeople } from '@territorios/data';
import { GenerarTab } from './GenerarTab';
import { LugaresTab } from './LugaresTab';
import { PersonasTab } from './PersonasTab';
import { TurnosTab } from './TurnosTab';
import { EmptyState, SubTabs, TabSkeleton, type TabSpec } from './ui';

type Tab = 'personas' | 'lugares' | 'turnos' | 'generar';

const TABS: readonly TabSpec<Tab>[] = [
  { value: 'personas', label: 'Personas' },
  { value: 'lugares', label: 'Lugares' },
  { value: 'turnos', label: 'Turnos' },
  { value: 'generar', label: 'Generar' },
];

type BoardQuery = ReturnType<typeof useCartSchedule>;
type RosterQuery = ReturnType<typeof usePeople>;

export function GestionCarrito() {
  const [tab, setTab] = useState<Tab>('personas');
  const [scheduleId, setScheduleId] = useState<string | undefined>(undefined);
  const board = useCartSchedule(scheduleId);
  const schedules = [...(board.data?.schedules ?? [])].sort((a, b) =>
    b.start_date.localeCompare(a.start_date),
  );
  const roster = usePeople();

  return (
    <div className="flex flex-col gap-4">
      {/* The Gestión layout owns the page h1; this is the section heading. */}
      <h2 className="text-title font-bold">Carrito</h2>

      <SubTabs value={tab} onChange={setTab} tabs={TABS} />

      {tab === 'generar' && schedules.length > 1 && (
        <label className="flex flex-col gap-1">
          <span className="text-secondary text-ink-soft">Cronograma</span>
          <select
            className="field"
            value={board.data?.schedule?.id ?? ''}
            onChange={(e) => setScheduleId(e.target.value)}
          >
            {schedules.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <CarritoBody tab={tab} board={board} roster={roster} />
    </div>
  );
}

function CarritoBody({
  tab,
  board,
  roster,
}: {
  tab: Tab;
  board: BoardQuery;
  roster: RosterQuery;
}) {
  if (board.isPending) return <TabSkeleton />;

  if (board.isError && !board.data) {
    return (
      <EmptyState
        title="No pudimos cargar el carrito"
        body="Revisá la conexión. Cuando vuelva, se actualiza solo."
      >
        <button type="button" className="btn-secondary" onClick={() => void board.refetch()}>
          Reintentar
        </button>
      </EmptyState>
    );
  }

  const data = board.data;
  if (!data) return <TabSkeleton />;

  if (tab === 'lugares') return <LugaresTab places={data.places} />;
  if (tab === 'turnos') return <TurnosTab slots={data.slots} places={data.places} />;

  return (
    <RosterGate roster={roster}>
      {(people) =>
        tab === 'personas' ? (
          <PersonasTab roster={people} slots={data.slots} places={data.places} />
        ) : (
          <GenerarTab key={data.schedule?.id ?? 'nuevo'} roster={people} board={data} />
        )
      }
    </RosterGate>
  );
}

/** Personas and Generar need the editor-only roster; show a skeleton while it loads. */
function RosterGate({
  roster,
  children,
}: {
  roster: RosterQuery;
  children: (roster: NonNullable<RosterQuery['data']>) => ReactNode;
}) {
  if (roster.isPending) return <TabSkeleton />;
  if (roster.isError && !roster.data) {
    return (
      <EmptyState
        title="No pudimos cargar las personas"
        body="Solo los encargados ven esta lista. Entrá con tu cuenta de encargado y reintentá."
      >
        <button type="button" className="btn-secondary" onClick={() => void roster.refetch()}>
          Reintentar
        </button>
      </EmptyState>
    );
  }
  if (!roster.data) return <TabSkeleton />;
  return <>{children(roster.data)}</>;
}

export default GestionCarrito;
export const Component = GestionCarrito;
