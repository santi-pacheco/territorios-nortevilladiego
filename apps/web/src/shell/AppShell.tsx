import { Suspense, useSyncExternalStore } from 'react';
import { NavLink, Outlet } from 'react-router';
import { onlineManager } from '@tanstack/react-query';
import { BookOpen, CalendarDays, Map, ShoppingBag, WifiOff } from 'lucide-react';
import { useBoot } from './bootContext';
import { AccountButton } from './AccountSheet';

const TABS = [
  { to: '/salidas', label: 'Salidas', Icon: CalendarDays },
  { to: '/mapa', label: 'Mapa', Icon: Map },
  { to: '/carrito', label: 'Carrito', Icon: ShoppingBag },
  { to: '/programa', label: 'Programa', Icon: BookOpen },
] as const;

function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
  );
}

export function AppShell() {
  const { configured } = useBoot();
  const online = useOnline();

  return (
    <div className="min-h-dvh bg-canvas text-ink lg:grid lg:grid-cols-[96px_1fr]">
      <nav
        aria-label="Secciones"
        className="hidden lg:flex lg:flex-col lg:items-stretch lg:gap-1 lg:border-r lg:border-line lg:bg-surface lg:px-2 lg:py-4 lg:sticky lg:top-0 lg:h-dvh"
      >
        {TABS.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className="rail-link">
            <Icon aria-hidden size={24} strokeWidth={2} />
            <span>{label}</span>
          </NavLink>
        ))}
        <div className="mt-auto flex justify-center">
          <AccountButton />
        </div>
      </nav>

      <div className="flex min-h-dvh flex-col pb-[calc(68px+env(safe-area-inset-bottom))] lg:pb-0">
        {!configured && (
          <p role="alert" className="bg-warn px-4 py-2 text-secondary text-white">
            Falta configurar la conexión (VITE_SUPABASE_URL). La app no puede cargar datos.
          </p>
        )}
        {!online && (
          <p
            role="status"
            className="flex items-center gap-2 bg-offline px-4 py-2 text-secondary text-white"
          >
            <WifiOff aria-hidden size={18} />
            Sin conexión. Mostramos lo último que se cargó.
          </p>
        )}
        <Suspense fallback={<ScreenSkeleton />}>
          <Outlet />
        </Suspense>
      </div>

      <nav
        aria-label="Secciones"
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden"
      >
        {TABS.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className="tab-link">
            <Icon aria-hidden size={24} strokeWidth={2} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function ScreenSkeleton() {
  return (
    <div aria-busy="true" aria-label="Cargando" className="flex flex-col gap-4 p-4">
      <div className="skeleton h-5 w-48" />
      <div className="skeleton h-8 w-36" />
      <div className="skeleton h-28 w-full" />
      <div className="skeleton h-28 w-full" />
    </div>
  );
}
