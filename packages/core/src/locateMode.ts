export type LocateMode = 'off' | 'follow' | 'compass';

// Ciclo del botón "ubicarme".
export function nextLocateMode(mode: LocateMode, opts: { headingSupported: boolean }): LocateMode {
  switch (mode) {
    case 'off':
      return 'follow';
    case 'follow':
      return opts.headingSupported ? 'compass' : 'off';
    case 'compass':
      return 'follow';
  }
}

// Mover/rotar el mapa a mano apaga el seguimiento.
export function locateModeOnUserGesture(_mode: LocateMode): LocateMode {
  return 'off';
}
