import { describe, expect, it } from 'vitest';
import { base64UrlToBytes, isIos, staticPushState, type PushEnv } from './push';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';

const env = (p: Partial<PushEnv>): PushEnv => ({ userAgent: ANDROID, maxTouchPoints: 5, standalone: false, hasPush: true, ...p });

describe('push opt-in', () => {
  it('detects iPhone and iPad-as-Mac, not desktop Macs', () => {
    expect(isIos({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe(false);
  });

  it('asks iPhone users to install before calling the browser unsupported', () => {
    const opts = { native: false, vapidKey: 'k' };
    expect(staticPushState(env({ userAgent: IPHONE, hasPush: false }), opts)).toBe('ios-install');
    expect(staticPushState(env({ userAgent: IPHONE, standalone: true }), opts)).toBeNull();
    expect(staticPushState(env({ hasPush: false }), opts)).toBe('unsupported');
    expect(staticPushState(env({}), { native: false, vapidKey: '' })).toBe('unavailable');
    expect(staticPushState(env({}), { native: true, vapidKey: 'k' })).toBe('native');
  });

  it('decodes a base64url VAPID key', () => {
    expect(Array.from(base64UrlToBytes('AQID_-8'))).toEqual([1, 2, 3, 255, 239]);
  });
});
