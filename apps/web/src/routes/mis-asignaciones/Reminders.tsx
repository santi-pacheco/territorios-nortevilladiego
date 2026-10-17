import { useEffect, useState } from 'react';
import { BellOff, BellRing, Check } from 'lucide-react';
import { platform } from '@territorios/platform';
import { withDb } from '@territorios/data';
import { deleteWebPushSubscription, saveWebPushSubscription } from '../../lib/accounts';
import {
  base64UrlToBytes,
  currentSubscription,
  readPushEnv,
  staticPushState,
  swRegistration,
  vapidKey,
  type PushState,
} from '../../lib/push';

async function detect(): Promise<PushState> {
  const fixed = staticPushState(readPushEnv(), {
    native: platform().kind !== 'web',
    vapidKey: vapidKey(),
  });
  if (fixed) return fixed;
  const reg = await swRegistration();
  if (!reg) return 'no-sw';
  if (Notification.permission === 'denied') return 'denied';
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** "Activar recordatorios": 7 days and 1 day before each assignment, via Web Push. */
export function Reminders() {
  const [state, setState] = useState<PushState | 'checking'>('checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    detect().then(
      (s) => live && setState(s),
      () => live && setState('unsupported'),
    );
    return () => {
      live = false;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setError(null);
    try {
      // Ask first, inside the tap, so the browser treats it as the user's choice.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const reg = await swRegistration();
      if (!reg) {
        setState('no-sw');
        return;
      }
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(vapidKey()),
        }));
      await withDb((sb) => saveWebPushSubscription(sb, JSON.stringify(sub)));
      setState('on');
    } catch {
      setError('No pudimos activar los recordatorios. Revisá la conexión y volvé a intentar.');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      const sub = await currentSubscription();
      if (sub) {
        await withDb((sb) => deleteWebPushSubscription(sb, JSON.stringify(sub)));
        await sub.unsubscribe();
      }
      setState('off');
    } catch {
      setError('No pudimos desactivarlos. Revisá la conexión y volvé a intentar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="recordatorios" className="asig-reminders">
      <h2 id="recordatorios" className="flex items-center gap-2 text-heading font-bold">
        {state === 'on' ? (
          <BellRing aria-hidden size={22} />
        ) : (
          <BellOff aria-hidden size={22} className="text-ink-soft" />
        )}
        Recordatorios
      </h2>
      <Body state={state} busy={busy} onEnable={enable} onDisable={disable} />
      {error && (
        <p role="alert" className="text-secondary text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

function Body({
  state,
  busy,
  onEnable,
  onDisable,
}: {
  state: PushState | 'checking';
  busy: boolean;
  onEnable: () => void;
  onDisable: () => void;
}) {
  const note = (text: string) => <p className="text-secondary text-ink-soft">{text}</p>;
  switch (state) {
    case 'checking':
      return <div aria-hidden className="skeleton h-12 w-full" />;
    case 'on':
      return (
        <>
          <p className="flex items-start gap-2 text-body">
            <Check aria-hidden size={20} className="mt-1 shrink-0 text-ok" />
            <span>Activados en este teléfono. Te avisamos 7 días y 1 día antes.</span>
          </p>
          <button type="button" className="btn-secondary" disabled={busy} onClick={onDisable}>
            {busy ? 'Desactivando…' : 'Desactivar'}
          </button>
        </>
      );
    case 'off':
      return (
        <>
          {note('Te avisamos 7 días y 1 día antes de cada asignación, aunque no abras la app.')}
          <button type="button" className="btn-primary" disabled={busy} onClick={onEnable}>
            {busy ? 'Activando…' : 'Activar recordatorios'}
          </button>
        </>
      );
    case 'ios-install':
      return (
        <>
          <p className="text-body font-semibold">Primero agregá la app a tu pantalla de inicio</p>
          <ol className="asig-steps text-secondary">
            <li>En Safari, tocá Compartir.</li>
            <li>Elegí “Agregar a pantalla de inicio”.</li>
            <li>Abrí Territorios desde ese ícono y activá los recordatorios acá.</li>
          </ol>
        </>
      );
    case 'denied':
      return note(
        'Las notificaciones están bloqueadas para esta app. Habilitalas en los ajustes del navegador (Notificaciones) y volvé a esta pantalla.',
      );
    case 'unsupported':
      return note(
        'Este navegador no permite recordatorios. En Android usá Chrome; en iPhone, la app agregada a la pantalla de inicio.',
      );
    case 'no-sw':
      return note('Los recordatorios se activan desde la app publicada. Recargá la página y volvé a intentar.');
    case 'unavailable':
      return note('Los recordatorios todavía no están disponibles. Mientras tanto, revisá esta pantalla.');
    case 'native':
      return note('En esta versión de la app los recordatorios todavía no están disponibles.');
  }
}
