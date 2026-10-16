import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { boot } from './boot';
import { BootContext } from './shell/bootContext';
import { router } from './router';
import { applyTheme, readTheme } from './lib/theme';
import './styles.css';

applyTheme(readTheme());
const app = boot();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BootContext.Provider value={app}>
      <QueryClientProvider client={app.queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </BootContext.Provider>
  </StrictMode>,
);
