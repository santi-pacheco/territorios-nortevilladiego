import { Download, Share, SquarePlus } from 'lucide-react';
import { ScreenHeader } from '../../shell/ScreenHeader';

type Device = 'android' | 'ios' | 'other';

function detectDevice(): Device {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'android';
  // iPadOS reports itself as Mac; touch points tell them apart.
  if (/iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  return 'other';
}

function installed(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** "Instalá la app": the Android APK download and the iPhone home-screen steps. */
export function Component() {
  const device = detectDevice();
  const showAndroid = device !== 'ios';
  const showIos = device !== 'android';

  return (
    <main className="flex flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-surface pb-2">
        <ScreenHeader caption="Cong. Norte Villa Diego" title="Instalá la app" />
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-6">
        {installed() && (
          <p role="status" className="text-body text-ok">
            Ya estás usando la app instalada.
          </p>
        )}

        {showAndroid && (
          <section aria-labelledby="android" className="flex flex-col gap-3">
            <h2 id="android" className="text-heading font-bold">
              Android
            </h2>
            <a
              href="/territorios.apk"
              download="Territorios.apk"
              className="btn-primary inline-flex items-center justify-center gap-2 self-start"
            >
              <Download aria-hidden size={22} />
              Descargar Territorios para Android
            </a>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-body">
              <li>Abrí el archivo descargado (Territorios.apk).</li>
              <li>
                Si Android dice que no se permiten apps de esta fuente, tocá{' '}
                <strong>Configuración</strong> y activá <strong>Permitir de esta fuente</strong>.
              </li>
              <li>
                Tocá <strong>Instalar</strong>. Si aparece un aviso de Play Protect, tocá{' '}
                <strong>Más detalles ▸ Instalar de todas formas</strong>.
              </li>
              <li>
                Abrí Territorios, entrá con tu cuenta de Google y en <strong>Mis asignaciones</strong>{' '}
                tocá <strong>Activar recordatorios</strong>.
              </li>
            </ol>
            <p className="text-secondary text-ink-soft">
              La app se actualiza sola: no hace falta volver a descargarla.
            </p>
          </section>
        )}

        {showIos && (
          <section aria-labelledby="iphone" className="flex flex-col gap-3">
            <h2 id="iphone" className="text-heading font-bold">
              iPhone
            </h2>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-body">
              <li>
                Abrí esta página en <strong>Safari</strong> (no en Chrome).
              </li>
              <li>
                Tocá <Share aria-label="Compartir" size={18} className="inline align-text-bottom" />{' '}
                <strong>Compartir</strong> y después{' '}
                <SquarePlus aria-hidden size={18} className="inline align-text-bottom" />{' '}
                <strong>Agregar a pantalla de inicio</strong>.
              </li>
              <li>Abrí Territorios desde el ícono nuevo.</li>
              <li>
                Entrá con tu cuenta y en <strong>Mis asignaciones</strong> tocá{' '}
                <strong>Activar recordatorios</strong>. Funciona desde iOS 16.4.
              </li>
            </ol>
          </section>
        )}
      </div>
    </main>
  );
}
