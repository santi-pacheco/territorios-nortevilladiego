import { Suspense, lazy, type ComponentType } from 'react';
import { Navigate, NavLink, useLocation } from 'react-router';
import { BookOpen, CalendarDays, ShoppingBag, UsersRound } from 'lucide-react';
import { useRole } from '@territorios/data';
import { AccountButton } from '../../shell/AccountSheet';
import { ScreenSkeleton } from '../../shell/AppShell';
import { GestionSalidas } from './salidas';
import './gestion.css';

const SECTIONS = [
  { key: 'salidas', to: '/gestion/salidas', label: 'Salidas', Icon: CalendarDays },
  { key: 'carrito', to: '/gestion/carrito', label: 'Carrito', Icon: ShoppingBag },
  { key: 'programa', to: '/gestion/programa', label: 'Programa', Icon: BookOpen },
  { key: 'usuarios', to: '/gestion/usuarios', label: 'Usuarios', Icon: UsersRound },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];
type SubsectionKey = Exclude<SectionKey, 'salidas'>;

/**
 * Carrito and Programa are owned by other tasks and may not exist yet. Load them lazily when
 * present and fall back to a placeholder, so Gestión ships without blocking on them.
 */
const SUBSECTION_EXPORT: Record<SubsectionKey, string> = {
  carrito: 'GestionCarrito',
  programa: 'GestionPrograma',
  usuarios: 'GestionUsuarios',
};

const subsectionLoaders = import.meta.glob<Record<string, unknown>>('./{carrito,programa,usuarios}/index.tsx');

function makeSubsection(name: SubsectionKey): ComponentType {
  const loader = subsectionLoaders[`./${name}/index.tsx`];
  if (!loader) return Proximamente;
  return lazy(async () => {
    const module = await loader();
    const Component = module[SUBSECTION_EXPORT[name]] as ComponentType | undefined;
    return { default: Component ?? Proximamente };
  });
}

const SUBSECTIONS: Record<SubsectionKey, ComponentType> = {
  carrito: makeSubsection('carrito'),
  programa: makeSubsection('programa'),
  usuarios: makeSubsection('usuarios'),
};

function sectionFor(pathname: string): SectionKey {
  if (pathname.startsWith('/gestion/carrito')) return 'carrito';
  if (pathname.startsWith('/gestion/programa')) return 'programa';
  if (pathname.startsWith('/gestion/usuarios')) return 'usuarios';
  return 'salidas';
}

export function Component() {
  const { isEditor, isLoading } = useRole();
  const { pathname } = useLocation();

  if (isLoading) {
    return (
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
        <ScreenSkeleton />
      </main>
    );
  }

  if (!isEditor) return <NotSignedIn />;

  if (pathname === '/gestion' || pathname === '/gestion/') {
    return <Navigate to="/gestion/salidas" replace />;
  }

  const section = sectionFor(pathname);
  const Subsection = section === 'salidas' ? null : SUBSECTIONS[section];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-5">
      <header className="flex items-start justify-between gap-2">
        <h1 className="text-display font-bold">Gestión</h1>
        <div className="lg:hidden">
          <AccountButton />
        </div>
      </header>

      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[200px_1fr] lg:items-start lg:gap-8">
        <nav aria-label="Secciones de gestión" className="gestion-nav">
          {SECTIONS.map(({ key, to, label, Icon }) => (
            <NavLink key={key} to={to} className="gestion-nav-link">
              <Icon aria-hidden size={22} strokeWidth={2} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="min-w-0">
          {Subsection ? (
            <Suspense fallback={<ScreenSkeleton />}>
              <Subsection />
            </Suspense>
          ) : (
            <GestionSalidas />
          )}
        </div>
      </div>
    </main>
  );
}

function NotSignedIn() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-2 px-4 py-5">
      <header className="flex items-start justify-between gap-2">
        <h1 className="text-display font-bold">Gestión</h1>
        <div className="lg:hidden">
          <AccountButton />
        </div>
      </header>
      <h2 className="mt-2 text-heading font-bold">Necesitás iniciar sesión como encargado</h2>
      <p className="max-w-prose text-body text-ink-soft">
        El acceso está en la hoja de cuenta: tocá el botón de tu cuenta (arriba a la derecha, o en
        el menú lateral en la computadora), abrí “Soy encargado” y entrá con el correo y la
        contraseña de encargado.
      </p>
      <p className="max-w-prose text-body text-ink-soft">
        Si todavía no tenés cuenta de encargado, pedísela al responsable de la congregación.
      </p>
    </main>
  );
}

function Proximamente() {
  return (
    <div className="flex flex-col gap-2 py-8">
      <h2 className="text-heading font-bold">Próximamente</h2>
      <p className="max-w-prose text-body text-ink-soft">Esta sección se está construyendo.</p>
    </div>
  );
}
