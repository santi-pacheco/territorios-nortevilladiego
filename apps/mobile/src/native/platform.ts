import type { KeyValueStorage, Platform } from '@territorios/platform';
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Geolocation } from '@capacitor/geolocation';
import { Preferences } from '@capacitor/preferences';
import { Share } from '@capacitor/share';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';

/** Keychain (iOS) / Keystore-wrapped AES-GCM (Android). Holds the Supabase session only. */
function secureStore(): KeyValueStorage {
  // Configured once before any read: device-only, never iCloud-synced, readable after first
  // unlock so a background token refresh still works while the screen is locked.
  const ready = Promise.all([
    SecureStorage.setKeyPrefix('territorios_'),
    SecureStorage.setSynchronize(false),
    SecureStorage.setDefaultKeychainAccess(KeychainAccess.afterFirstUnlockThisDeviceOnly),
  ]);
  return {
    // getItem/setItem store raw strings; get/set would JSON-parse the session into an object.
    getItem: async (key) => (await ready, SecureStorage.getItem(key)),
    setItem: async (key, value) => (await ready, SecureStorage.setItem(key, value)),
    removeItem: async (key) => (await ready, SecureStorage.removeItem(key)),
  };
}

/** Non-sensitive cache (query persistence). Native preferences survive WebView storage eviction. */
function prefsStore(): KeyValueStorage {
  return {
    getItem: async (key) => (await Preferences.get({ key })).value,
    setItem: (key, value) => Preferences.set({ key, value }),
    removeItem: (key) => Preferences.remove({ key }),
  };
}

/**
 * Turns a plugin's async listener handle into a sync unsubscribe. Calling it before the handle
 * resolves still tears the listener down once it does.
 */
function deferredUnsubscribe<T>(handle: Promise<T>, release: (h: T) => unknown): () => void {
  let cancelled = false;
  let pending: T | undefined;
  handle.then(
    (h) => {
      if (cancelled) void release(h);
      else pending = h;
    },
    () => {},
  );
  return () => {
    if (cancelled) return;
    cancelled = true;
    if (pending !== undefined) void release(pending);
  };
}

async function ensureLocationPermission(): Promise<void> {
  let status = await Geolocation.checkPermissions();
  if (status.location === 'prompt' || status.location === 'prompt-with-rationale') {
    status = await Geolocation.requestPermissions({ permissions: ['location'] });
  }
  if (status.location !== 'granted') {
    throw new Error('Permiso de ubicación denegado. Activalo en Ajustes.');
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('No se pudo leer el archivo.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Native Platform for the Capacitor shell. `fallback` is the web implementation, used where the
 * WebView API is good enough (compass heading).
 */
export function createNativePlatform(fallback: Platform): Platform {
  const kind = Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
  return {
    kind,
    storage: prefsStore(),
    secureStorage: secureStore(),
    watchPosition(onPos, onError) {
      const id = ensureLocationPermission().then(() =>
        Geolocation.watchPosition(
          { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
          (p, err) => {
            if (p)
              onPos({
                lat: p.coords.latitude,
                lng: p.coords.longitude,
                accuracy: p.coords.accuracy,
              });
            else if (err) onError(new Error('No se pudo obtener la ubicación.'));
          },
        ),
      );
      id.catch((e: unknown) => onError(e instanceof Error ? e : new Error(String(e))));
      return deferredUnsubscribe(id, (watchId) => Geolocation.clearWatch({ id: watchId }));
    },
    // TODO(M0 spike): if deviceorientation proves unreliable in WKWebView, add a small native
    // heading plugin (CLLocationManager.heading / Android rotation-vector sensor) here.
    watchHeading: (onHeading) => fallback.watchHeading(onHeading),
    async share({ name, blob, title }) {
      // Large binaries cross the bridge as a file, not base64 into the share sheet.
      const path = `share/${name}`;
      const { uri } = await Filesystem.writeFile({
        path,
        data: await blobToBase64(blob),
        directory: Directory.Cache,
        recursive: true,
      });
      try {
        await Share.share({ files: [uri], ...(title ? { title } : {}) });
      } finally {
        Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {});
      }
    },
    onResume(cb) {
      const handle = App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) cb();
      });
      return deferredUnsubscribe(handle, (h) => h.remove());
    },
  };
}
