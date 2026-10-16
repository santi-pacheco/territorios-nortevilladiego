# 02 — Mobile stack for TerritoriosMap 2.0 (Android + iOS)

Status: research / recommendation. Date: 2026-10-16. Author: worker task_93cf056b1149.
Scope: choose how to ship lightweight, secure Android + iOS apps alongside the Vercel web app.

---

## TL;DR — recommendation

**Use Capacitor 8 to wrap the same Vite + React web app, in a pnpm-workspace monorepo. Ship a PWA first as Phase 0.**

- Phase 0 (any stack): make the web app a proper PWA, with a manifest, a service worker, an offline app shell and self-hosted fonts. Viewers get an installable, offline-capable app within days, and none of that work is thrown away.
- Phase 1: `apps/mobile` = Capacitor 8 shell loading the **bundled** `apps/web` build (never `server.url` → Vercel). Add native plugins where they add real value: Keychain/Keystore session storage, native geolocation, push, haptics, share sheet and a status bar.
- Distribution: Apple **Unlisted App Distribution** + Google Play (closed track first). The audience is a single congregation.
- OTA: Capgo (`@capgo/capacitor-updater`), either the Solo plan or self-hosted. It replaces Ionic Appflow, which is being wound down.
- iOS builds from Windows: GitHub Actions `macos-*` runners (free minutes for public repos, metered for private) or Codemagic's free tier. No local Mac is needed.

Why: roughly 100% of the UI and logic is reused. MapLibre GL JS, pdf.js, `html-to-image` and Tailwind all run unchanged in WKWebView/Android WebView. The map is small (49 placemarks, 84 KB KML), so there is no native-map performance argument. Expo would force a rewrite of ~3,000 lines of DOM/Tailwind components and the PDF import path for no user-visible gain at this scale.

**Switch triggers that should send us to Expo instead** (this keeps the decision falsifiable):
1. A Capacitor spike on a low-end Android device (≤3 GB RAM, Android WebView ≥ 120) shows map pan/zoom under ~30 fps, or a cold start to first map frame over 3 s.
2. A requirement for native offline vector tile packs or background location tracking (neither exists today).
3. Apple rejects the Capacitor build under 4.2 twice, even after the native features listed in §6 are added.

---

## 1. What the app actually needs (from `src/`)

| Capability | Where | Mobile implication |
|---|---|---|
| MapLibre GL JS map, CARTO Positron style over the network | `src/components/MapView.tsx:2,22,91-99` | WebGL in a WebView works fine; basemap tiles need network unless cached |
| Popups built as raw HTML strings | `src/components/MapView.tsx:25-33,170` (`setHTML`) | **XSS sink**; see §8 |
| Territory polygons from a static KML | `src/data/useTerritories.ts:16` → `/territorios.kml` (84,579 bytes, **49** `<Placemark>`) | Tiny dataset; bundle it in the app |
| Geolocation `watchPosition` (high accuracy) | `src/hooks/useGeolocation.ts:29-40` | WKWebView prompts twice (app + "localhost"); use `@capacitor/geolocation` |
| Compass via `deviceorientation`, iOS `webkitCompassHeading` + `requestPermission` | `src/hooks/useDeviceHeading.ts:22-28,40-46` | Must be verified inside WKWebView in the spike; fallback is a small native heading plugin (CLLocationManager / Android rotation vector) |
| Supabase auth (email+password), session persisted by supabase-js in `localStorage` | `src/lib/supabase.ts:13`, `src/data/useAdminAuth.ts:27-36,47-51` | Move the session to Keychain/Keystore through a custom `auth.storage` |
| Supabase Realtime `postgres_changes` on single rows | `src/lib/carrito/api.ts:35-52`, `src/lib/salidasApi.ts:36-52` | The WebSocket dies in background on both OSes, whatever the stack. Refetch on resume |
| Single-row last-write-wins upsert | `src/lib/carrito/api.ts:27-33` | Offline writes would clobber each other. Viewers read offline; admin writes only when online |
| Local cache in `localStorage` | `src/lib/carrito/store.ts:99,117`, `src/lib/salidasStore.ts:177,188`, `src/lib/programa/api.ts:38,49`, `src/data/geocodeCorner.ts:11,20` | Works in the WebView; iOS may evict WebView storage under pressure. Use `@capacitor/preferences` for anything that must survive |
| PDF import via pdf.js worker (`?url` import) | `src/lib/programa/pdfItems.ts:5-10` | Runs unchanged in a WebView. With React Native it needs a native PDF lib or a hidden WebView, i.e. a rewrite |
| PNG export + clipboard via `html-to-image` | `src/lib/exportImage.ts:12-37` | DOM-only. On mobile, replace `a.download` with `@capacitor/share` / Filesystem. No RN equivalent without a rewrite |
| Geocoding via Nominatim | `src/data/geocodeCorner.ts:5,35` | Needs `connect-src`; Nominatim usage policy requires a UA/referrer and a low request rate |
| No PWA today | `index.html` (no manifest link), `public/` = `favicon.svg`, `territorios.kml` only | Phase 0 work |

**Code size split** (non-test lines): `src/lib/**/*.ts` = 1,666 (pure TS: parsers, scheduler, adapters, stores); `src/data` + `src/hooks` = 729 (React hooks, mostly portable); `src/components/**/*.tsx` = 2,968 + `src/App.tsx` 386 (DOM + Tailwind).
→ Capacitor reuses ~100%. Expo reuses roughly the 1,666 lines of `lib` plus part of the hooks, and **rewrites ~3,350 lines of UI** plus the PDF and export paths.

---

## 2. Current facts (verified 2026-10-16)

npm registry (`npm view <pkg> version`):

| Package | Latest | Notes |
|---|---|---|
| `@capacitor/core` | 8.5.3 | Cap 8 GA Dec 2025. Needs Xcode 26+, iOS 15 min, Android SDK 36 / AGP 8.13, Node 22+. New iOS projects default to SPM |
| `@capacitor/geolocation` | 8.2.4 | |
| `@capacitor/push-notifications` | 8.1.3 | FCM on Android, APNs on iOS (or FCM for both) |
| `@capgo/capacitor-updater` | 8.53.0 | OTA; open source, self-hostable |
| `@aparajita/capacitor-secure-storage` | 8.0.1 | Keychain / Keystore-backed AES-256-GCM; async get/set/remove matches the supabase-js storage shape |
| `expo` | 58.0.13 | SDK 58 targets RN 0.88 / React 19.2.3. SDK 55+ is New-Architecture-only |
| `@maplibre/maplibre-react-native` | 11.5.0 | v11 is New-Arch-only; API realigned with GL JS; `MapView` renamed to `Map` |
| `@tauri-apps/cli` | 2.12.3 | Mobile supported; push only via community plugins |
| `maplibre-gl` | 6.14.0 | Repo is on `^5.24.0` (`package.json`). The 6.x upgrade is a separate v2 item |

Stores and services:
- Apple Developer Program: US$99/yr. Google Play: US$25 one-time.
- **Google Play, new personal accounts** (created after 2023-11-13) need a closed test with **≥12 testers opted in for 14 consecutive days** before production access. Organization accounts are exempt. Plan for this: recruit 12+ publishers early.
- **Android developer verification**: enforced since 2026-09-30 in BR/ID/SG/TH on certified devices, with the global rollout through 2027. Argentina is not in wave 1. Register anyway; it is free with a Play account.
- **Apple Unlisted App Distribution**: the app passes normal App Review, then is reachable only via a direct link. Request it in App Store Connect with a reason (e.g. "internal tool for a single congregation"). It cannot be requested for a beta build. This is a good fit and lowers the "why would the public want this" 4.2 pressure, but it does **not** waive 4.2.
- Ionic **Appflow** is being wound down (no new customers; reported EOL 2027-12-31), so do not build on it.
- **Capgo** pricing: Solo $12–14/mo (2,000 MAU), Maker $33–39/mo (10k MAU). The stack is open source and self-hostable.
- **EAS** (for comparison): Free = 15 iOS + 15 Android builds/mo, low-priority queue, 1,000 update MAU. Starter $19/mo. Paid-tier prices conflict between sources ($99 vs $199 Production), so check expo.dev/pricing.

---

## 3. Options compared

Scoring: ●●● best … ● worst, for *this* app.

| Criterion | **Capacitor 8 + shared Vite web** | **Expo SDK 58 (RN) + shared TS core** | **Tauri 2 mobile** | **PWA only** |
|---|---|---|---|---|
| Code reuse with web | ●●● ~100%: same bundle | ● `lib/` only; rewrite all UI, PDF import and PNG export (or wrap them in a WebView, which defeats the point) | ●●● same bundle | ●●● 100% |
| Binary size | ●● ~5–8 MB Android APK / ~10–15 MB iOS (web bundle + Cap runtime; system WebView not shipped) | ●● ~15–25 MB APK (Hermes + RN + native MapLibre) | ●●● smallest shell, but Rust toolchain per ABI | ●●● none |
| Startup perf | ●● WebView init ~300–600 ms on mid Android; fine with bundled assets + splash | ●●● native first frame; Hermes bytecode | ●● same WebView cost as Cap | ● network-dependent first load; good once SW-cached |
| Map perf | ●● maplibre-gl JS in WebGL: fine for 49 polygons + 1 marker; weakest on low-end Android WebView | ●●● native MapLibre Android/iOS; v11 stable on New Arch | ●● same as Cap | ●● same as Cap (in browser) |
| Push notifications | ●●● `@capacitor/push-notifications` (official) | ●●● `expo-notifications` + Expo push service | ● community plugins only | ● iOS web push needs Home-Screen install + permission; flaky UX |
| Offline cache | ●● bundled assets always offline; data via Preferences/SQLite. **No service workers in WKWebView** without App-Bound Domains (max 10, side effects), so don't rely on Workbox inside the app | ●●● SQLite/MMKV, native tile cache / offline packs | ●● like Cap | ●● SW + Cache API; iOS may evict after ~7 days of no use |
| Secure session storage | ●●● Keychain/Keystore plugin as `auth.storage` | ●●● `expo-secure-store` (values over ~2 KB warn → "LargeSecureStore" pattern: AES key in SecureStore, ciphertext in AsyncStorage) | ●● Stronghold / keychain plugins, less proven on mobile | ● `localStorage` only; no hardware-backed storage |
| App Store review risk | ●● 4.2 risk if it feels like a website. Mitigate with native geolocation, push, share, offline shell and haptics, plus Unlisted distribution | ●●● native UI, lowest 4.2 risk | ●● same as Cap | n/a (no store) |
| OTA updates | ●●● Capgo (hosted or self-hosted); JS/CSS/asset-only updates allowed by Apple 3.3.2 / Google policy | ●●● EAS Update (1k MAU free) or self-hosted expo-updates server | ● none first-party | ●●● instant: it's the web |
| Build on Windows | ●● Android local (Android Studio). iOS needs macOS: GitHub Actions macOS runner / Codemagic / a borrowed Mac | ●●● `eas build -p ios` in the cloud from Windows, incl. signing management | ● Android local; iOS needs a Mac + Rust targets; least CI tooling | ●●● none |
| Ongoing cost | $99/yr Apple + $25 Google + Capgo $0–14/mo + CI minutes | Same store fees + EAS $0–19/mo | Store fees + CI | $0 |
| Team fit (1 dev, React web skills) | ●●● same mental model | ● new paradigm (RN styling, navigation, native modules) | ● adds Rust | ●●● |

### Why not Expo (yet)
Expo is the better *native* platform: cloud iOS builds from Windows, native map and the lowest 4.2 risk. It loses here because the web app is DOM-heavy (Tailwind layouts, `setHTML` popups, `html-to-image`, the pdf.js worker), and the 2.0 brief also revamps the *web* UI. With Expo we would build and maintain **two UIs** (`react-dom` + RN). That doubles the surface for "less buggy" and is the opposite of "lightweight". React-Native-Web or Expo DOM components could narrow the gap, but they add a layer of indirection the current team doesn't need. Revisit if a switch trigger fires.

### Why not Tauri 2 mobile
It has the same WebView trade-offs as Capacitor, with a much thinner mobile plugin ecosystem (push is community-only), a Rust toolchain on every build, and no OTA story. It gives this app nothing extra.

### Why not PWA-only
iOS install friction (Share → Add to Home Screen), web push only after install, storage eviction, no Keychain, and no store presence, which matters for less-technical publishers. Ship it anyway as **Phase 0**; it is the foundation Capacitor bundles.

---

## 4. Recommended architecture

### Monorepo layout (pnpm workspaces)

```
territorios/
├─ pnpm-workspace.yaml          # packages: ["apps/*", "packages/*"]
├─ package.json                 # root scripts: dev, build, test, lint (pnpm -r)
├─ apps/
│  ├─ web/                      # Vite 7 + React 19 + Tailwind 4; deployed to Vercel (root dir = apps/web)
│  │  ├─ src/                   # UI only: components, routes, views
│  │  ├─ public/                # manifest.webmanifest, icons, territorios.kml, fonts/inter/*
│  │  └─ vite.config.ts         # vite-plugin-pwa (Workbox) — web only
│  └─ mobile/                   # Capacitor 8 shell — NO UI code here
│     ├─ capacitor.config.ts    # webDir: "../web/dist-mobile", no server.url in prod
│     ├─ android/               # committed native project
│     ├─ ios/                   # committed native project (SPM)
│     └─ src/native/            # thin TS adapters registered into core's Platform interface
├─ packages/
│  ├─ core/                     # pure TS, no DOM, no React: today's src/lib/** (parsers, scheduler, adapters, stores' pure parts, types)
│  ├─ data/                     # supabase client factory + repositories + React hooks (useSalidas, useCarrito, usePrograma, useAuth)
│  └─ platform/                 # interface Platform { storage, secureStorage, geolocation, heading, share, push, appState }
│                               #   + web impl (localStorage, navigator.geolocation, deviceorientation, Web Share)
│                               #   mobile impl lives in apps/mobile/src/native and is injected at boot
└─ supabase/                    # migrations (move docs/*.sql here), edge functions (push sender)
```

Key rules:
- `apps/web` builds two outputs. `dist/` is the Vercel build with the service worker. `dist-mobile/` is built with `--mode capacitor`, without the SW plugin, with `base: './'`, and fonts and the KML bundled. The `VITE_TARGET=capacitor` flag selects the platform adapter at boot.
- The UI never imports `@capacitor/*` directly; it goes through `packages/platform`. This keeps the web bundle free of native code and keeps an Expo pivot possible, because `core` + `data` + `platform` are exactly the parts an RN app would reuse.
- Vercel: set the project root to `apps/web`, install command `pnpm install --frozen-lockfile`. (The current deploy is CLI-linked with `npx vercel --prod`; the root-directory change happens in project settings, which is out of scope here.)

### Supabase session in Keychain/Keystore

```ts
// packages/data/src/client.ts
export function makeSupabase(url: string, key: string, storage: AsyncStorageLike, isNative: boolean) {
  return createClient(url, key, {
    auth: {
      storage,                 // web: localStorage; native: SecureStorage adapter
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: !isNative,
    },
  });
}

// apps/mobile/src/native/secureStorage.ts
import { SecureStorage } from '@aparajita/capacitor-secure-storage';
export const secureStorage = {
  getItem: async (k: string) => (await SecureStorage.get(k)) as string | null,
  setItem: (k: string, v: string) => SecureStorage.set(k, v),
  removeItem: (k: string) => SecureStorage.remove(k),
};

// apps/mobile/src/native/lifecycle.ts — pause refresh/realtime in background, refetch on resume
App.addListener('appStateChange', ({ isActive }) => {
  if (isActive) { supabase.auth.startAutoRefresh(); repos.refetchAll(); }
  else supabase.auth.stopAutoRefresh();
});
```

Spike checks: confirm the `@aparajita` plugin's `get`/`set` signatures and its iOS Keychain accessibility class (want `AfterFirstUnlockThisDeviceOnly`). Alternative: Capawesome Secure Preferences (sponsorware) or Capgo's native Supabase plugin.

### Native features to add (value + 4.2 mitigation)
1. `@capacitor/geolocation`: one native permission prompt, with Info.plist `NSLocationWhenInUseUsageDescription` in Spanish.
2. Heading: keep `deviceorientation` if it works in WKWebView. Otherwise add a ~60-line local plugin (iOS `CLLocationManager.startUpdatingHeading`, Android `TYPE_ROTATION_VECTOR`).
3. Push (`@capacitor/push-notifications` + FCM HTTP v1 for both platforms) for "Salidas de mañana", "Te asignaron al carrito" and "Programa nuevo publicado". The sender is a Supabase Edge Function triggered by a DB webhook on `salidas`/`carrito`/`programa` updates, with a `device_tokens` table under RLS. This is new server work and is needed with any stack.
4. `@capacitor/share` + `@capacitor/filesystem` replace `a.download` in `src/lib/exportImage.ts:15-18` (a download anchor does nothing in a WebView).
5. `@capacitor/splash-screen`, `@capacitor/status-bar` / System Bars (Cap 8 edge-to-edge), `@capacitor/haptics`, `@capacitor/app` (back button, resume), `@capacitor/network` (offline banner).
6. Offline: the bundled shell + KML are always available. Snapshot the last fetched rows into `@capacitor/preferences`. Basemap tiles: rely on the WebView HTTP cache, and optionally pre-cache the city bbox at z12–16 into Filesystem served through a custom MapLibre `addProtocol`. That is feasible later; don't do it in Phase 1.

### OTA policy
Capgo channels `production` / `beta`. OTA only for JS/CSS/asset changes; native plugin changes require a store release. Use bundle signing (Capgo end-to-end encryption) and enable auto-rollback when the new bundle fails to call `notifyAppReady()`. Respect Apple 3.3.2: no feature changes that alter the app's primary purpose via OTA.

### Build pipeline (developer on Windows)
- **Android**: local `pnpm --filter mobile cap sync android && ./gradlew bundleRelease`. Upload keystore stored outside the repo, enrolled in Play App Signing.
- **iOS**: a GitHub Actions workflow on `macos-15` (or newer) runs `pnpm install` → `pnpm --filter web build:mobile` → `npx cap sync ios` → `xcodebuild archive` → `xcrun altool`/`fastlane pilot` upload to TestFlight. Signing uses an App Store Connect API key + distribution cert in GitHub secrets (or fastlane match). macOS minutes are metered at a multiplier on private repos, so watch usage. Alternative: **Codemagic** free tier (macOS M-series, ~500 min/mo for personal use; verify the current allowance).
- Both workflows run on tags `mobile-v*`. Web deploy stays independent.

---

## 5. Phased plan

| Phase | Deliverable | Exit criteria |
|---|---|---|
| 0 | PWA: manifest, icons, `vite-plugin-pwa` app shell, self-host Inter (drop the Google Fonts `<link>` in `index.html`), offline read of last data, refetch on `visibilitychange` | Lighthouse PWA installable; app opens offline showing the last schedule |
| 1a | Monorepo split (`packages/core`, `data`, `platform`), no behavior change | `pnpm -r test` green (existing vitest suites move with `core`) |
| 1b | **Capacitor spike (2–3 days)** on one low-end Android + one iPhone: map fps, cold start, compass in WKWebView, pdf.js worker, geolocation prompt | Switch triggers (TL;DR) not hit |
| 1c | Secure session, native geo, share, lifecycle refetch, splash/status bar | Internal TestFlight + Play internal track |
| 2 | Push (Edge Function + `device_tokens`), Capgo OTA | 12-tester / 14-day closed test done; Unlisted request approved |

---

## 6. App-store review risk checklist

- Bundle the web assets. **Never** set `server.url` to the Vercel site in production: it is the classic 4.2 "repackaged website" signal and it breaks offline.
- The offline launch must render the shell + last-known data, not an error page. Reviewers test airplane mode.
- Native permission strings in Spanish and specific ("Para mostrar tu ubicación sobre el mapa de territorios").
- Login: provide a demo/reviewer account in Review Notes, or make clear the app is fully usable without login (viewer mode). Account deletion (5.1.1(v)) applies only if users can create accounts; today only admins exist, created in the dashboard. Keep it that way, or add in-app deletion.
- Privacy: App Privacy "nutrition label" and Play Data Safety. Data collected: location (not stored server-side; state that), email (admins), names of publishers (carrito people list). Publish a privacy policy URL.
- Unlisted App Distribution request text: "internal scheduling/maps tool for one congregation; not useful to the general public".

---

## 7. Cost summary (yearly, steady state)

| Item | Capacitor plan |
|---|---|
| Apple Developer Program | US$99 |
| Google Play (one-time) | US$25 |
| Capgo OTA | $0 (self-host) – ~$144 (Solo, monthly) |
| iOS CI | $0 (Codemagic free / public repo) – low tens of $ (private-repo macOS minutes) |
| Push (FCM) | $0 |
| Supabase | unchanged (Edge Function invocations are well within free tier) |
| **Total** | **≈ US$125 – 300 / yr** |

Expo path for comparison: the same store fees + EAS free (15 iOS builds/mo, 1k update MAU) or $19/mo Starter. The cost difference is negligible; the real cost is the UI rewrite.

---

## 8. Security checklist

**Findings in the current code (fix before any mobile release):**

1. **XSS in map popups — blocker.** `popupHtml()` interpolates admin-entered `a.corner`, `a.leader`, `a.groups` into HTML without escaping (`src/components/MapView.tsx:25-33`) and passes it to `Popup.setHTML` (`:170`). Inside a Capacitor WebView, script injection can call the native bridge, including the secure-storage plugin holding the admin session. Fix: build popup DOM with `textContent` / `setDOMContent`, or escape the values. Add a CSP (below) as defense in depth.
2. **Hardcoded fallback credentials.** `LEGACY_USER`/`LEGACY_PASS` in `src/data/useAdminAuth.ts:9-10` ship in the JS bundle, so they are readable from the Vercel bundle today and trivially from an APK/IPA. Delete the legacy path in 2.0; require Supabase.
3. **RLS write policy is "any authenticated user".** `for all to authenticated using (true) with check (true)` in `docs/carrito-supabase.sql:24-28` (same pattern in `docs/salidas-supabase.sql:24` and `docs/programa-supabase.sql:30`). The mobile binary exposes the project URL + publishable key (by design). So if **public email signups** are enabled in Supabase Auth, anyone can create an account and overwrite every schedule. Action: confirm "Allow new users to sign up" is **off**, and gate writes on an admin claim (`(auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'`) or an `admins` table.
4. **Public read of personal data.** `carrito read ... to anon using (true)` (`docs/carrito-supabase.sql:19-22`) exposes the people list (names, gender, availability) to anyone with the publishable key. Decide whether 2.0 viewers must sign in (e.g. magic link or a shared congregation code mapped to a role), or split the people data into an admin-only table.

**Platform checklist:**

- **Keys**: only the publishable key in clients. `service_role` / secret keys live only in Supabase Edge Function secrets (the push sender). The FCM service-account JSON also stays server-side. Add a CI grep that fails the build if `service_role`/`sb_secret_` appears in `apps/**`.
- **Session storage**: Keychain (`kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`) / Keystore-backed encryption via the `auth.storage` adapter. Never `localStorage` on native. Sign-out clears secure storage.
- **Transport**: HTTPS/WSS only. iOS ATS default (no `NSAllowsArbitraryLoads`). Android `usesCleartextTraffic=false` plus a `network_security_config` without user CAs in release builds.
- **Certificate pinning: do not pin.** Supabase, CARTO and Nominatim sit behind CDNs/managed TLS that rotate certificates and intermediates without notice, and a stale pin bricks the app until a store release (OTA can't fix native config). The threat it addresses (a MITM with a user-installed CA) is already blocked on Android by not trusting user CAs, and is low-value for this data.
- **Jailbreak/root detection: skip.** The client holds no secrets beyond the user's own session; all authorization is enforced by RLS on the server. Detection is bypassable and produces false positives. Revisit only if a high-value secret ever lands on device (it shouldn't).
- **CSP** (via `<meta http-equiv>` in `index.html` for both web and Capacitor; Vercel can also send it as a header):
  ```
  default-src 'self';
  script-src 'self';
  worker-src 'self' blob:;                       /* maplibre-gl workers, pdf.js worker */
  style-src 'self' 'unsafe-inline';              /* maplibre/inline styles; drop Google Fonts once Inter is self-hosted */
  img-src 'self' data: blob: https://*.basemaps.cartocdn.com;
  font-src 'self';
  connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co
              https://basemaps.cartocdn.com https://*.basemaps.cartocdn.com
              https://nominatim.openstreetmap.org;
  frame-ancestors 'none'; base-uri 'self'; object-src 'none';
  ```
  Capacitor serves from `capacitor://localhost` (iOS) / `https://localhost` (Android), so `'self'` covers the bundle. Verify MapLibre 6's worker setup and the pdf.js worker URL against the policy in the spike.
- **Capacitor config**: `allowNavigation` empty (no external navigation in the WebView); open external links with `@capacitor/browser`. `android:allowBackup="false"` (or exclude the secure-storage prefs file in backup rules). `webContentsDebuggingEnabled` false in release. Release builds minified with R8.
- **OTA integrity**: Capgo signed/encrypted bundles; the update channel can be written only from CI.
- **Push**: tokens stored with RLS (a user can only upsert their own token). Payloads carry no personal data beyond what the lock screen may show.
- **Dependencies**: Renovate/Dependabot on the workspace, `pnpm audit` in CI, pin Capacitor plugin majors together.

---

## 9. Open questions for the coordinator / owner

1. Is "Allow new users to sign up" currently disabled in the Supabase project? (It determines the severity of finding 3; I did not query Supabase.)
2. Should 2.0 viewers stay anonymous? (This affects the people-data exposure, push targeting and Apple account-deletion rules.)
3. Is there an organization (legal entity) to own the Play/App Store accounts? An org Play account skips the 12-tester rule; an Apple org account needs a D-U-N-S number.
4. Private vs public GitHub repo? (Determines whether macOS CI minutes are free.)

---

## Sources

- Capacitor 8 announcement / requirements: https://ionic.io/blog/announcing-capacitor-8 · https://capacitorjs.com/docs/next/updating/8-0
- Expo SDK 57/58: https://expo.dev/changelog/sdk-57 · https://expo.dev/changelog/sdk-58-beta · https://docs.expo.dev/versions/v58.0.0 · New Architecture: https://docs.expo.dev/guides/new-architecture/
- EAS pricing: https://expo.dev/pricing · https://docs.expo.dev/billing/plans
- MapLibre React Native v11: https://maplibre.org/maplibre-react-native/docs/setup/migrations/v11 · https://github.com/maplibre/maplibre-react-native/releases
- Capgo pricing / Appflow wind-down: https://capgo.app/pricing/ · https://capgo.app/blog/appflow-shutdown-alternative
- Secure storage plugins: https://capawesome.io/plugins/secure-preferences/ · https://capgo.app/docs/plugins/supabase/
- supabase-js custom auth storage: https://github.com/supabase/supabase-js (SupabaseClient.ts React Native example)
- WKWebView service workers / App-Bound Domains: https://developer.apple.com/forums/thread/748795 · https://docs.median.co/docs/service-workers
- Apple 4.2 / wrapper risk (secondary): https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper · https://capgo.app/blog/how-to-pass-app-store-review-2026/
- Apple Unlisted App Distribution: https://developer.apple.com/support/unlisted-app-distribution
- Google Play 12 testers / 14 days (secondary): https://www.testerscommunity.com/blog/google-play-closed-testing-requirements-2026
- Android developer verification rollout: https://androidauthority.com/android-sideloading-developer-verification-first-wave-rollout-3717921 · https://gigazine.net/gsc_news/en/20260619-android-developer-verification-timeline/
- Tauri mobile push (community): https://github.com/yanqianglu/tauri-plugin-mobile-push
- Versions: `npm view` on 2026-10-16 for all packages in §2.
