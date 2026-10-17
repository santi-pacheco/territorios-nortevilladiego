/**
 * The one MapLibre instance of the app. It lives at module level with its own container element:
 * the route re-attaches the container on mount and detaches it on unmount, so switching tabs
 * never creates a new WebGL context or refetches the basemap.
 */
import {
  Map as MapLibreMap,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapMouseEvent,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre finds its worker next to its own module, which Vite moves; hand it the bundled one.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import type { Position } from '@territorios/platform';
import type { TerritoryRow } from '@territorios/data';
import { boundsOf, circleRing } from './model';

export type MapTheme = 'light' | 'dark' | 'sol';

const STYLES = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
} as const;
// Same stack the CARTO styles use, so the glyph server already has it.
const LABEL_FONT = ['Montserrat Medium', 'Open Sans Bold', 'Noto Sans Regular'];

/** Set by the mounted route; the map's listeners are bound once and call through here. */
export const handlers = {
  onTerritoryTap: (_id: number) => {},
  onUserGesture: () => {},
};

interface Feature {
  type: 'Feature';
  id?: number;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
}
/** MapLibre types its GeoJSON input with @types/geojson; ours is structurally the same. */
type GeoData = Parameters<GeoJSONSource['setData']>[0];
const collection = (features: Feature[]): GeoData =>
  ({ type: 'FeatureCollection', features }) as GeoData;

let map: MapLibreMap | null = null;
let container: HTMLDivElement | null = null;
let styleUrl = '';
let rows: TerritoryRow[] = [];
let highlight = {
  day: null as string | null,
  assigned: new Set<number>(),
  selected: new Set<number>(),
};
let me: Position | null = null;
let lastFitKey: string | null = null;

export function reducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Mounts the singleton map into `host`. Returns false when the device has no WebGL. */
export function attach(host: HTMLElement, theme: MapTheme): boolean {
  if (!container) {
    container = document.createElement('div');
    container.className = 'mapa-canvas';
  }
  host.appendChild(container);
  if (map) {
    map.resize();
    setTheme(theme);
    return true;
  }
  try {
    setWorkerUrl(workerUrl);
    styleUrl = styleFor(theme);
    map = new MapLibreMap({
      container,
      style: styleUrl,
      center: [-58.44, -34.61],
      zoom: 11,
      attributionControl: { compact: true },
      pitchWithRotate: false,
      touchPitch: false,
      fadeDuration: 0,
    });
  } catch {
    container.remove();
    return false;
  }
  bind(map);
  return true;
}

/** Detaches the map only from `host`: a late cleanup must not take it from the next owner. */
export function detach(host: HTMLElement): void {
  if (container?.parentElement === host) container.remove();
}

function styleFor(theme: MapTheme): string {
  return theme === 'dark' ? STYLES.dark : STYLES.light;
}

export function setTheme(theme: MapTheme): void {
  if (!map) return;
  const next = styleFor(theme);
  if (next !== styleUrl) {
    styleUrl = next;
    // Our layers go with the old style; they are re-added on `style.load`.
    map.setStyle(next);
  } else if (map.isStyleLoaded()) {
    paint();
  }
}

function bind(m: MapLibreMap): void {
  m.on('style.load', () => {
    tuneBasemap(m);
    install(m);
    render();
  });
  const tap = (e: MapMouseEvent) => {
    if (!ready()) return;
    const hit = m.queryRenderedFeatures(e.point, { layers: ['terr-label-bg', 'terr-fill'] })[0];
    if (hit?.id !== undefined) handlers.onTerritoryTap(Number(hit.id));
  };
  m.on('click', tap);
  m.on('mouseenter', 'terr-fill', () => (m.getCanvas().style.cursor = 'pointer'));
  m.on('mouseleave', 'terr-fill', () => (m.getCanvas().style.cursor = ''));
  // Only a person's hand carries `originalEvent`; our own camera moves never cancel follow.
  const gesture = (e: { originalEvent?: unknown }) => {
    if (e.originalEvent) handlers.onUserGesture();
  };
  m.on('dragstart', gesture);
  m.on('rotatestart', gesture);
}

function install(m: MapLibreMap): void {
  m.addSource('territories', { type: 'geojson', data: territoryData() });
  m.addSource('labels', { type: 'geojson', data: labelData() });
  m.addSource('me', { type: 'geojson', data: meData() });
  const clear = 'rgba(0,0,0,0)';
  // Fills and outlines sit under the basemap's labels so street names stay readable on top.
  const firstLabel = m.getStyle().layers.find((l) => l.type === 'symbol')?.id;
  m.addLayer(
    { id: 'terr-fill', type: 'fill', source: 'territories', paint: { 'fill-color': clear } },
    firstLabel,
  );
  m.addLayer(
    {
      id: 'terr-line',
      type: 'line',
      source: 'territories',
      paint: { 'line-color': clear, 'line-width': 1.5 },
    },
    firstLabel,
  );
  m.addLayer({
    id: 'terr-label-bg',
    type: 'circle',
    source: 'labels',
    paint: { 'circle-radius': 13, 'circle-color': clear },
  });
  m.addLayer({
    id: 'terr-label',
    type: 'symbol',
    source: 'labels',
    layout: {
      'text-field': ['to-string', ['get', 'id']],
      'text-font': LABEL_FONT,
      'text-size': 13,
      'text-allow-overlap': true,
      // Numbers always show, and their footprint (the 13 px circle) pushes street
      // names aside instead of being drawn on top of them.
      'text-ignore-placement': false,
      'text-padding': 9,
    },
    paint: { 'text-color': clear },
  });
  m.addLayer({
    id: 'me-accuracy',
    type: 'fill',
    source: 'me',
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: { 'fill-color': clear },
  });
  m.addLayer({
    id: 'me-dot',
    type: 'circle',
    source: 'me',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 7, 'circle-stroke-width': 3, 'circle-color': clear },
  });
}

// ---------------------------------------------------------------------------
// Basemap legibility. CARTO draws minor street names only from z16, at 9 px, in
// light grey: unreadable outdoors. Members navigate by street name, so names show
// from z14.5, larger, in ink with a halo, and street outlines get more contrast.
// ---------------------------------------------------------------------------
const ROAD_NAMES: Record<string, { minzoom: number; size: ExpressionSpecification }> = {
  roadname_minor: {
    minzoom: 14.5,
    size: ['interpolate', ['linear'], ['zoom'], 14.5, 11, 16, 13, 18, 16],
  },
  roadname_sec: {
    minzoom: 13.5,
    size: ['interpolate', ['linear'], ['zoom'], 13.5, 11.5, 16, 14, 18, 17],
  },
  roadname_pri: {
    minzoom: 13,
    size: ['interpolate', ['linear'], ['zoom'], 13, 12, 16, 15, 18, 18],
  },
  roadname_major: {
    minzoom: 12,
    size: ['interpolate', ['linear'], ['zoom'], 12, 12, 16, 15, 18, 18],
  },
};
const ROAD_CASINGS = ['road_minor_case', 'road_sec_case_noramp', 'road_service_case'];

function tuneBasemap(m: MapLibreMap): void {
  for (const [id, cfg] of Object.entries(ROAD_NAMES)) {
    if (!m.getLayer(id)) continue;
    m.setLayerZoomRange(id, cfg.minzoom, 24);
    m.setLayoutProperty(id, 'text-size', cfg.size);
    m.setLayoutProperty(id, 'text-font', [
      'Montserrat Medium',
      'Open Sans Semibold',
      'Noto Sans Regular',
    ]);
    m.setLayoutProperty(id, 'text-padding', 2);
    // Repeat names more often along a street, so one hidden by a territory number shows again nearby.
    m.setLayoutProperty(id, 'symbol-spacing', 140);
  }
  // Minor street outlines from z13 so the grid reads before names appear.
  if (m.getLayer('road_minor_case')) m.setLayerZoomRange('road_minor_case', 13, 24);
  if (m.getLayer('road_minor_fill')) m.setLayerZoomRange('road_minor_fill', 13, 24);
  tintBasemap(m);
}

function tintBasemap(m: MapLibreMap): void {
  const ink = token('--tk-text-primary', '#14181f');
  const surface = token('--tk-bg-surface', '#ffffff');
  const casing = token('--tk-border-strong', '#8994a6');
  for (const id of Object.keys(ROAD_NAMES)) {
    if (!m.getLayer(id)) continue;
    m.setPaintProperty(id, 'text-color', ink);
    m.setPaintProperty(id, 'text-halo-color', surface);
    m.setPaintProperty(id, 'text-halo-width', 2);
    m.setPaintProperty(id, 'text-halo-blur', 0);
  }
  for (const id of ROAD_CASINGS) if (m.getLayer(id)) m.setPaintProperty(id, 'line-color', casing);
}

function ready(): MapLibreMap | null {
  return map && map.getSource('territories') ? map : null;
}

// ---------------------------------------------------------------------------
// Colours: tokens are CSS variables; MapLibre needs concrete colour strings.
// ---------------------------------------------------------------------------
let probe: CanvasRenderingContext2D | null = null;
function token(name: string, fallback = 'rgba(0,0,0,0)'): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  probe ??= document.createElement('canvas').getContext('2d');
  if (!probe) return raw;
  // The canvas normalises any CSS colour (incl. `rgb(r g b / a%)`) to hex or rgba().
  probe.fillStyle = fallback;
  probe.fillStyle = raw;
  return String(probe.fillStyle);
}

function paint(): void {
  const m = ready();
  if (!m) return;
  const day = highlight.day;
  const assigned = day ? token(`--tk-map-assigned-${day}`) : 'rgba(0,0,0,0)';
  const selected = day ? token(`--tk-map-selected-${day}`) : token('--tk-border-strong');
  const fill: ExpressionSpecification = [
    'case',
    ['boolean', ['feature-state', 'selected'], false],
    selected,
    ['boolean', ['feature-state', 'assigned'], false],
    assigned,
    'rgba(0,0,0,0)',
  ];
  const ink = token('--tk-text-primary', '#14181f');
  const surface = token('--tk-bg-surface', '#ffffff');
  const meColor = token('--tk-map-me', '#1a73e8');
  tintBasemap(m);
  m.setPaintProperty('terr-fill', 'fill-color', fill);
  m.setPaintProperty('terr-line', 'line-color', token('--tk-map-outline', ink));
  m.setPaintProperty('terr-label-bg', 'circle-color', ink);
  m.setPaintProperty('terr-label', 'text-color', surface);
  m.setPaintProperty('me-accuracy', 'fill-color', meColor);
  m.setPaintProperty('me-accuracy', 'fill-opacity', 0.15);
  m.setPaintProperty('me-dot', 'circle-color', meColor);
  m.setPaintProperty('me-dot', 'circle-stroke-color', surface);
}

function states(): void {
  const m = ready();
  if (!m) return;
  for (const t of rows) {
    m.setFeatureState(
      { source: 'territories', id: t.id },
      { assigned: highlight.assigned.has(t.id), selected: highlight.selected.has(t.id) },
    );
  }
}

function render(): void {
  paint();
  states();
}

// ---------------------------------------------------------------------------
// Data in
// ---------------------------------------------------------------------------
function territoryData(): GeoData {
  return collection(
    rows.map((t) => ({
      type: 'Feature',
      id: t.id,
      geometry: t.geometry,
      properties: { id: t.id },
    })),
  );
}

function labelData(): GeoData {
  return collection(
    rows.map((t) => ({
      type: 'Feature',
      id: t.id,
      geometry: { type: 'Point', coordinates: [t.centroid_lng, t.centroid_lat] },
      properties: { id: t.id },
    })),
  );
}

function meData(): GeoData {
  if (!me) return collection([]);
  return collection([
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [circleRing(me.lng, me.lat, me.accuracy)] },
      properties: {},
    },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [me.lng, me.lat] }, properties: {} },
  ]);
}

export function setTerritories(next: TerritoryRow[]): void {
  if (next === rows) return;
  rows = next;
  const m = ready();
  if (!m) return;
  (m.getSource('territories') as GeoJSONSource).setData(territoryData());
  (m.getSource('labels') as GeoJSONSource).setData(labelData());
  states();
}

/** `day` is the token slug (e.g. "jueves"); null when the week has no salidas. */
export function setHighlight(
  day: string | null,
  assigned: Set<number>,
  selected: Set<number>,
): void {
  const dayChanged = day !== highlight.day;
  highlight = { day, assigned, selected };
  if (dayChanged) paint();
  states();
}

/** The blue dot and accuracy halo: one GeoJSON source, updated in place. */
export function setMe(pos: Position | null): void {
  me = pos;
  (ready()?.getSource('me') as GeoJSONSource | undefined)?.setData(meData());
}

let topInset = 0;
/** Height of the overlay header. Passed with each camera move: `setPadding` would cut animations. */
export function setTopInset(px: number): void {
  topInset = px;
}
const inset = (extra = 0) => ({ top: topInset + extra, right: extra, bottom: extra, left: extra });

/** Frames `ids` (or every territory). Skips when this exact focus was already applied. */
export function focus(ids: number[], key: string): void {
  if (!map || key === lastFitKey || rows.length === 0) return;
  const wanted = new Set(ids);
  const picked = ids.length ? rows.filter((t) => wanted.has(t.id)) : rows;
  const bounds = boundsOf((picked.length ? picked : rows).map((t) => t.geometry));
  if (!bounds) return;
  lastFitKey = key;
  map.fitBounds(bounds, { padding: inset(40), maxZoom: 16, animate: !reducedMotion() });
}

export interface CameraStep {
  center?: [number, number];
  bearing?: number;
  minZoom?: number;
}

/** Locate-mode camera. Callers coalesce to one call per animation frame. */
export function moveCamera(step: CameraStep, smooth: boolean): void {
  if (!map) return;
  const zoom = step.minZoom !== undefined ? Math.max(map.getZoom(), step.minZoom) : undefined;
  const options = { center: step.center, bearing: step.bearing, zoom, padding: inset() };
  if (smooth && !reducedMotion()) map.easeTo({ ...options, duration: 400 });
  else map.jumpTo(options);
}
