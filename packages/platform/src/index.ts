/** Native capabilities the UI may use. Web impl ships here; native impl is injected by apps/mobile at boot. */
export interface KeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface Position {
  lat: number;
  lng: number;
  accuracy: number;
}

export interface Platform {
  kind: 'web' | 'ios' | 'android';
  /** Non-sensitive cache (query persistence, preferences). */
  storage: KeyValueStorage;
  /** Keychain/Keystore on native; falls back to storage on web. Holds the auth session. */
  secureStorage: KeyValueStorage;
  watchPosition(onPos: (p: Position) => void, onError: (e: Error) => void): () => void;
  /** Compass heading in degrees (0 = north). Returns unsubscribe. */
  watchHeading(onHeading: (deg: number) => void): Promise<() => void>;
  share(file: { name: string; blob: Blob; title?: string }): Promise<void>;
  onResume(cb: () => void): () => void;
}

let current: Platform | null = null;
export function setPlatform(p: Platform): void {
  current = p;
}
export function platform(): Platform {
  if (!current) throw new Error('Platform not initialised: call setPlatform() at boot');
  return current;
}
