import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './shell/AppShell';
import { RouteError } from './shell/RouteError';
import { SalidasScreen } from './routes/salidas/SalidasScreen';

/**
 * Salidas is the launch screen, so it ships in the entry chunk.
 * Every other tab is a lazy route: maplibre and pdf.js never load until visited.
 */
export const router = createBrowserRouter([
  {
    element: <AppShell />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <Navigate to="/salidas" replace /> },
      { path: 'salidas/:dia?', element: <SalidasScreen /> },
      { path: 'mapa', lazy: () => import('./routes/mapa/route') },
      { path: 'carrito', lazy: () => import('./routes/carrito/route') },
      { path: 'programa', lazy: () => import('./routes/programa/route') },
      { path: 'mis-asignaciones', lazy: () => import('./routes/mis-asignaciones/route') },
      { path: 'app', lazy: () => import('./routes/app/route') },
      { path: 'privilegios', lazy: () => import('./routes/privilegios/route') },
      { path: 'gestion/*', lazy: () => import('./routes/gestion/route') },
      { path: '*', element: <Navigate to="/salidas" replace /> },
    ],
  },
]);
