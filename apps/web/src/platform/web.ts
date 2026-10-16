import type { KeyValueStorage, Platform } from '@territorios/platform';

function localStore(): KeyValueStorage {
  return {
    async getItem(key) {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    async setItem(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch {
        // Storage full or blocked (private mode): the cache is an optimisation, never required.
      }
    },
    async removeItem(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        // ignore
      }
    },
  };
}

type OrientationEventWithCompass = DeviceOrientationEvent & { webkitCompassHeading?: number };
type OrientationPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

export function webPlatform(): Platform {
  const storage = localStore();
  return {
    kind: 'web',
    storage,
    // Browsers have no hardware-backed store; the session lives in localStorage on web only.
    secureStorage: storage,
    watchPosition(onPos, onError) {
      if (!('geolocation' in navigator)) {
        onError(new Error('Este dispositivo no permite ubicar.'));
        return () => {};
      }
      const id = navigator.geolocation.watchPosition(
        (p) =>
          onPos({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        (e) => onError(new Error(e.message)),
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
      );
      return () => navigator.geolocation.clearWatch(id);
    },
    async watchHeading(onHeading) {
      const ctor = DeviceOrientationEvent as unknown as OrientationPermission;
      if (typeof ctor.requestPermission === 'function') {
        const state = await ctor.requestPermission();
        if (state !== 'granted') throw new Error('Permiso de brújula denegado.');
      }
      let frame = 0;
      let latest: number | null = null;
      const handle = (e: Event) => {
        const ev = e as OrientationEventWithCompass;
        const deg =
          typeof ev.webkitCompassHeading === 'number'
            ? ev.webkitCompassHeading
            : ev.absolute && ev.alpha !== null
              ? (360 - ev.alpha) % 360
              : null;
        if (deg === null) return;
        latest = deg;
        // Sensors fire ~60 Hz; deliver at most once per frame.
        if (!frame)
          frame = requestAnimationFrame(() => {
            frame = 0;
            if (latest !== null) onHeading(latest);
          });
      };
      const type =
        'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
      window.addEventListener(type, handle);
      return () => {
        window.removeEventListener(type, handle);
        cancelAnimationFrame(frame);
      };
    },
    async share({ name, blob, title }) {
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
    onResume(cb) {
      const handler = () => {
        if (document.visibilityState === 'visible') cb();
      };
      document.addEventListener('visibilitychange', handler);
      return () => document.removeEventListener('visibilitychange', handler);
    },
  };
}
