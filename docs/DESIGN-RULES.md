# Design rules for screen work (binding)

Read first: `apps/web/PRODUCT.md`, the direction contract in `apps/web/.impeccable/surfaces/src-main-tsx.md`, and the reference screen `apps/web/src/routes/salidas/*` + `apps/web/src/styles.css`. A new screen must look like it belongs next to Salidas.

## World: "Línea del día"
- Cool grey canvas (`bg-canvas`), white surfaces (`bg-surface`), ink text (`text-ink`, `text-ink-soft`). Hairline borders `border-line`.
- **Colour does a job.** The only strong colour on a screen is the day accent (`var(--tk-day-<dia>-accent)`, exposed to CSS as `--day`). Status colours (`text-ok/warn/danger`) only where they mean something.
- Territory numbers are **roundels** (`.roundel`): round, ink background, mono numerals.
- Times and numbers use the mono face (`font-mono` / `var(--tk-font-numeric)`); everything else Atkinson Hyperlegible Next.
- Type sizes only from tokens: `text-display`, `text-title`, `text-heading`, `text-body`, `text-secondary`, `text-caption`. Nothing smaller than 13 px. Rank by weight before size.
- Touch targets ≥ 44 px (`min-h-touch` / `.icon-btn`). Every control is a standard control (button, link, tab, input, select, `<dialog>` sheet).
- Use `lucide-react` icons, 24 px, stroke 2, always with a visible text label for primary actions.

## Refuse (review blockers)
No gradients. No glass/backdrop-blur. No emoji or Unicode glyphs as icons. No tracked-uppercase eyebrow labels above headings. No cream + gold, no navy brand. No `border-left` accent stripes on cards. No uniform card grid as page structure; lists are rows with hairlines, cards only for salida/turn/part items. No decorative motion (fade-in on every item, hover lift). No "→" in buttons. No instruction copy that a clear control would replace. No `dangerouslySetInnerHTML`, no MapLibre `setHTML` (lint enforces).

## Copy
Rioplatense voseo ("Tocá", "Elegí"), sentence case, plain verbs. Errors say what happened and what to do. Empty states say what will appear and when.

## States (all required)
Loading = skeleton shaped like the content (`.skeleton`), never a spinner. Empty, error (with retry/explanation), offline (data comes from cache, still render it). Respect `prefers-reduced-motion`.

## Engineering
- Each route lives in `apps/web/src/routes/<name>/` and exports `Component` from `route.tsx` (lazy-loaded). Put route-only CSS in `routes/<name>/<name>.css`, imported by the route, using `@reference "../../styles.css";` if you need Tailwind `@apply`. Do not edit `styles.css`, `AppShell.tsx` or other routes.
- Data only through `@territorios/data` hooks; never call Supabase from components except via `db()` inside data-layer helpers.
- Header pattern: copy the Salidas header structure (caption line, `text-display` title, `AccountButton` on mobile).
- Verify visually: dev server `pnpm --filter @territorios/web dev --port <free port>` with local Supabase (`npx supabase start` already running, env in `apps/web/.env.local`), then `MSYS_NO_PATHCONV=1 BASE_URL=http://localhost:<port> node scripts/shots.mjs /<route>` and look at the PNGs in `apps/web/.impeccable/review/` (light/dark/sol × mobile/desktop). Zero horizontal overflow is required.
