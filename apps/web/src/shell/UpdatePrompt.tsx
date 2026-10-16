/// <reference types="vite-plugin-pwa/react" />
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * "New version" toast for the installed web app. The service worker waits (registerType
 * 'prompt') until the user taps Actualizar, so a half-filled form is never reloaded away.
 * The native shell (mode 'capacitor') has no service worker and renders nothing.
 */
export function UpdatePrompt() {
  if (import.meta.env.MODE === 'capacitor') return null;
  return <WebUpdatePrompt />;
}

function WebUpdatePrompt() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  if (!needRefresh) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-gutter bottom-[calc(80px+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-md items-center gap-3 rounded-md border border-line bg-surface py-2 pr-2 pl-4 text-ink shadow-sheet lg:bottom-6"
    >
      <p className="flex-1 text-body">Hay una versión nueva</p>
      <button type="button" className="btn-primary" onClick={() => void updateServiceWorker(true)}>
        Actualizar
      </button>
    </div>
  );
}
