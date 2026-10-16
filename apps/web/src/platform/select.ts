import type { Platform } from '@territorios/platform';
import { webPlatform } from './web';

/**
 * The native Platform when built with `--mode capacitor`, otherwise undefined (boot uses web).
 * `import.meta.env.MODE` is replaced at build time, so the web bundle drops this branch and
 * never contains @capacitor/* code.
 */
export async function selectNativePlatform(): Promise<Platform | undefined> {
  if (import.meta.env.MODE !== 'capacitor') return undefined;
  const { createNativePlatform } = await import('../../../mobile/src/native/platform');
  return createNativePlatform(webPlatform());
}
