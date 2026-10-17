/**
 * Web Push opt-in for "Mis asignaciones" reminders. The order of the checks matters: iPhone
 * Safari has no PushManager until the app is added to the home screen, so "install first" must
 * win over "unsupported".
 */

export type PushState =
  | 'native' // Capacitor shell: reminders come with the store app, not Web Push
  | 'ios-install' // iPhone/iPad in a browser tab: add to home screen first
  | 'unsupported'
  | 'unavailable' // no VAPID key configured in this build
  | 'no-sw' // no service worker (dev server, or it has not registered yet)
  | 'denied'
  | 'off'
  | 'on';

export interface PushEnv {
  userAgent: string;
  maxTouchPoints: number;
  /** navigator.standalone (iOS) or display-mode: standalone */
  standalone: boolean;
  hasPush: boolean;
}

export function readPushEnv(): PushEnv {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    standalone: nav.standalone === true || matchMedia('(display-mode: standalone)').matches,
    hasPush: 'serviceWorker' in nav && 'PushManager' in window && 'Notification' in window,
  };
}

/** iPhone, iPod, or an iPad that reports itself as a Mac. */
export function isIos(env: Pick<PushEnv, 'userAgent' | 'maxTouchPoints'>): boolean {
  return (
    /iPad|iPhone|iPod/.test(env.userAgent) ||
    (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1)
  );
}

/** What the browser allows before looking at the service worker or the permission. */
export function staticPushState(
  env: PushEnv,
  opts: { native: boolean; vapidKey: string },
): PushState | null {
  if (opts.native) return 'native';
  if (isIos(env) && !env.standalone) return 'ios-install';
  if (!env.hasPush) return 'unsupported';
  if (!opts.vapidKey) return 'unavailable';
  return null;
}

/** VAPID public key from the build, trimmed; empty when not configured. */
export function vapidKey(): string {
  const raw: unknown = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  return typeof raw === 'string' ? raw.trim() : '';
}

/** base64url (VAPID public key) → bytes for `applicationServerKey`. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (value.length % 4)) % 4);
  const b64 = (value + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The registered service worker, without waiting forever when there is none. */
export async function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await swRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}
