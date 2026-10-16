/**
 * Locate button state machine. `off` releases every sensor (no background GPS); the camera
 * follows position and heading at most once per animation frame.
 */
import { platform, type Position } from '@territorios/platform';
import { moveCamera, setMe, type CameraStep } from './engine';
import { nextLocateMode, type LocateMode } from './model';

export function headingSupported(): boolean {
  if (platform().kind !== 'web') return true;
  // Desktop browsers expose the event but have no sensor: only offer the compass on touch devices.
  return 'DeviceOrientationEvent' in window && matchMedia('(pointer: coarse)').matches;
}

function screenAngle(): number {
  return screen.orientation?.angle ?? 0;
}

export class Locator {
  mode: LocateMode = 'off';
  private stopPosition: (() => void) | null = null;
  private stopHeading: (() => void) | null = null;
  /** Bumped on every heading start/stop so a late `watchHeading` resolution can tell it is stale. */
  private headingRun = 0;
  private frame = 0;
  private step: CameraStep = {};
  private firstFix = true;

  constructor(private readonly onChange: (mode: LocateMode, message: string | null) => void) {}

  /** Call straight from the click handler: iOS only grants the compass inside a user gesture. */
  cycle(): void {
    const leavingCompass = this.mode === 'compass';
    this.set(nextLocateMode(this.mode, headingSupported()));
    // Tapping out of the compass turns the map north-up again (a drag keeps the user's rotation).
    if (leavingCompass) this.queue({ bearing: 0 });
  }

  set(next: LocateMode, message: string | null = null): void {
    const prev = this.mode;
    if (next === prev) {
      if (message) this.onChange(next, message);
      return;
    }
    this.mode = next;
    if (next === 'off') {
      this.stopAll();
      setMe(null);
    } else {
      if (!this.stopPosition) {
        this.firstFix = true;
        this.stopPosition = platform().watchPosition(
          (p) => this.onPosition(p),
          () => this.set('off', 'No pudimos ubicarte. Revisá que la app tenga permiso de ubicación.'),
        );
        // A platform without geolocation reports the error synchronously: we are already off.
        if (this.mode === 'off') {
          this.stopPosition();
          this.stopPosition = null;
          return;
        }
      }
      if (next === 'compass') this.startHeading();
      else this.endHeading();
    }
    this.onChange(next, message);
  }

  dispose(): void {
    this.set('off');
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private startHeading(): void {
    const run = ++this.headingRun;
    platform()
      .watchHeading((deg) => {
        if (run === this.headingRun) this.queue({ bearing: (deg + screenAngle()) % 360 });
      })
      .then((stop) => {
        if (run === this.headingRun && this.mode === 'compass') this.stopHeading = stop;
        else stop();
      })
      .catch(() => {
        if (run === this.headingRun)
          this.set('follow', 'No pudimos usar la brújula. Seguimos tu ubicación sin girar el mapa.');
      });
  }

  private endHeading(): void {
    this.headingRun++;
    this.stopHeading?.();
    this.stopHeading = null;
  }

  private stopAll(): void {
    this.endHeading();
    this.stopPosition?.();
    this.stopPosition = null;
    this.step = {};
  }

  private onPosition(p: Position): void {
    if (this.mode === 'off') return;
    setMe(p);
    this.queue({ center: [p.lng, p.lat], minZoom: this.firstFix ? 16 : undefined });
    this.firstFix = false;
  }

  private queue(step: CameraStep): void {
    this.step = { ...this.step, ...step };
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      const s = this.step;
      this.step = {};
      // Heading drives the camera every frame: jump. A lone position fix may glide.
      moveCamera(s, s.bearing === undefined && this.mode === 'follow');
    });
  }
}
