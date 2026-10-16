# 03 — Design & platform skills for TerritoriosMap 2.0

Date: 2026-10-16. Task `task_565e5d036ee8`. Research and tooling only. No repo file was changed apart from this report (`git status --porcelain` was empty after all installs).

## TL;DR

- **15 skills installed**, user scope (`~/.claude/skills/<name>`), Claude Code only, copied rather than symlinked.
- **Primary design skill: `impeccable`.** It is the only anti-slop skill that explicitly covers *app UI*, which it calls "Operate" mode (dashboards, editors, schedulers). That is what Mapa, Salidas, Carrito and Programa are.
- **Review gates:** `web-design-guidelines` (Vercel) and `accessibility` (Addy Osmani, WCAG 2.2).
- **Mobile:** both paths are covered so the Expo-vs-Capacitor decision can be made with guidance on each side: Expo (5 skills), Vercel RN (1), Capacitor (1).
- **Backend:** Supabase (2 skills). The Supabase MCP server's own instructions recommend this package.
- **No restart needed.** The skills hot-loaded into the running session; they appeared in the Skill list right after install. Other already-open sessions may need `/reload` or a restart to see them.
- **No interactive steps**, with one caveat: impeccable downloads a binary on first run (see the security notes).

## Current stack these skills target

- React 19 / Vite 7 / Tailwind 4 / MapLibre / supabase-js: `package.json:15,18,21,25,30,32`.
- Theme tokens live in Tailwind 4 `@theme` (`src/index.css:4-13`), as a `jw-*` navy/gold/ivory palette. impeccable `document`/`extract` and ui-ux-pro-max read and produce exactly this kind of token set.
- Views: `src/components/{MapView,SalidasView,CarritoView,ProgramaView}.tsx`.

## Installed

All commands were run from the scratchpad (not the repo), with `DISABLE_TELEMETRY=1` and the flags `-g -a claude-code -y --copy`. The shorthand below omits them:

`npx -y skills add <repo> -s <skill...> -g -a claude-code -y --copy`

Note: multiple skills go after one `-s`, separated by spaces. Repeating `-s` keeps only the last one.

### Design (anti-AI-slop)

| Skill | Source (stars, as of 2026-10-16) | Command | What it does | Invoke |
|---|---|---|---|---|
| `impeccable` v4.6.0 | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) ★81.9k, Apache-2.0, author Paul Bakaus (ex-Google Chrome DevRel) | `npx -y skills add pbakaus/impeccable -s impeccable -g -a claude-code -y --copy` | One skill with 24 sub-commands. It defines modes (Persuade / **Operate** / Read / Experience), a "craft floor" of banned slop patterns, and anti-pattern detection. It can write `PRODUCT.md`/`DESIGN.md`, and has `native` references for iOS/Android. | `/impeccable shape <target>`, `/impeccable audit`, `/impeccable critique`, `polish`, `typeset`, `colorize`, `harden`, `adapt`, `document`, `extract`, `live` (full list in the `argument-hint` of `~/.claude/skills/impeccable/SKILL.md`) |
| `design-taste-frontend` (taste-skill v2) | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) ★97.9k, MIT | `npx -y skills add Leonxlnx/taste-skill -s design-taste-frontend …` | Art direction drawn from 247 curated gallery sites. It deals a direction (type, palette, composition, imagery), runs a browser inspector/lint, and repeats a screenshot→fix loop. **Its own description says "Not for dashboards or app screens."** Use it only for public or landing surfaces, such as a future marketing or download page for the apps. | `/design-taste-frontend` |
| `ui-ux-pro-max` | [nextlevelbuilder/ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) ★136.5k, MIT | `npx -y skills add nextlevelbuilder/ui-ux-pro-max-skill -s ui-ux-pro-max …` | A local searchable database (Python BM25, no network): 192 palettes, 74 font pairings, 119 UX guidelines, styles, chart types, and per-stack rules. Treat it as a reference lookup for choosing tokens, not as a design director. **Requires Python** (3.12.10 is present). | `/ui-ux-pro-max`, or ask for a "design system for X" |
| `emil-design-eng` | [emilkowalski/skills](https://github.com/emilkowalski/skills) ★46.7k, MIT, author of Sonner/Vaul | `npx -y skills add emilkowalski/skills -s emil-design-eng …` | Polish, component feel, and when and how to animate. Pure markdown. | `/emil-design-eng` |

### Review / quality gates

| Skill | Source | Command | What it does | Invoke |
|---|---|---|---|---|
| `web-design-guidelines` | [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) ★32.5k | `npx -y skills add vercel-labs/agent-skills -s web-design-guidelines …` | Reviews files against the Vercel Web Interface Guidelines and outputs findings as `file:line`. It **fetches its rules at runtime** from `raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md`, so it needs network access and WebFetch. | `/web-design-guidelines src/components/CarritoView.tsx` |
| `accessibility` | [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills) ★3.0k (Addy Osmani, Google Chrome) | `npx -y skills add addyosmani/web-quality-skills -s accessibility …` | WCAG 2.2 audit and fixes: keyboard, screen reader, contrast, ARIA. Markdown plus reference docs; no scripts in this skill. | `/accessibility` or "a11y audit" |

### React architecture

| Skill | Source | Command | What it does | Invoke |
|---|---|---|---|---|
| `vercel-composition-patterns` | vercel-labs/agent-skills | `npx -y skills add vercel-labs/agent-skills -s vercel-composition-patterns vercel-react-native-skills vercel-react-view-transitions …` | Compound components and fixes for boolean-prop sprawl, including React 19 API changes. Relevant to the large view components. | auto-trigger, or `/vercel-composition-patterns` |
| `vercel-react-view-transitions` | vercel-labs/agent-skills | (same command) | React `<ViewTransition>` / `startViewTransition` for tab switches (Mapa↔Salidas↔Carrito↔Programa) with no animation library. | `/vercel-react-view-transitions` |
| `vercel-react-native-skills` | vercel-labs/agent-skills | (same command) | RN/Expo performance: lists, animations, native modules. | auto on RN work |

`vercel-react-best-practices` was **not** installed because it is already provided by the `vercel` plugin as `vercel:react-best-practices`.

### Mobile (Android + iOS)

| Skill | Source | Command | What it does |
|---|---|---|---|
| `expo-overview`, `expo-router`, `expo-native-ui`, `expo-ui`, `expo-web-to-native` | [expo/skills](https://github.com/expo/skills) ★2.9k, MIT, official Expo org | `npx -y skills add expo/skills -s expo-overview expo-router expo-native-ui expo-ui expo-web-to-native …` | `expo-overview` is the router skill; load it first. `expo-web-to-native` is the end-to-end guide for porting a Vite React app to Expo. `expo-ui` covers @expo/ui (SwiftUI/Compose). `expo-native-ui` covers HIG styling. `expo-router` covers navigation. |
| `capacitor-best-practices` | [Cap-go/capgo-skills](https://github.com/Cap-go/capgo-skills) ★73, MIT, Capgo (a commercial Capacitor live-update vendor) | `npx -y skills add Cap-go/capgo-skills -s capacitor-best-practices …` | Capacitor 8.5/9 setup, `capacitor.config.ts` audit, plugin and permission patterns, and release prep. It is the lightest-weight way to ship the existing Vite app to the stores. |

`capacitor-best-practices` is **below the find-skills ≥100-stars bar.** It was installed anyway because it is pure markdown (`SKILL.md`, `metadata.json`, `references/`; no scripts) and it is the only maintained Capacitor skill. It is **vendor-biased**: it steers live updates toward `@capgo/capacitor-updater` (`SKILL.md:69`). Treat those recommendations as advertising.

### Backend

| Skill | Source | Command | What it does |
|---|---|---|---|
| `supabase`, `supabase-postgres-best-practices` | [supabase/agent-skills](https://github.com/supabase/agent-skills) ★2.8k, MIT, official | `npx -y skills add supabase/agent-skills -s supabase supabase-postgres-best-practices …` | Auth/RLS/supabase-js/migrations guidance and Postgres schema/RLS/index rules. Relevant to `docs/*-supabase.sql` and the RLS hardening for the mobile apps. |

## Security vetting notes

- **impeccable launcher downloads an engine binary on first use.** `~/.claude/skills/impeccable/scripts/impeccable` (Windows: `impeccable.cmd`) looks for a sibling `bin/` and `~/.impeccable/bin/`. If neither exists, it downloads `v0.1.15` from `https://github.com/pbakaus/impeccable/releases/download/...` with curl and verifies SHA-256 against a `.sha256` sidecar fetched from the same origin. It refuses to run if the sidecar is missing or the hash does not match. That proves the download is intact, not who published it. The first run therefore needs network access and writes to `~/.impeccable/`.
- **impeccable `live` mode** injects `live-browser.js` into the dev page. The script only talks to a token-protected `http://localhost:PORT` server (`live-browser.js:3825,4141,5339`); no third-party hosts were found.
- **Writes into the project:** impeccable `init`/`document` write `PRODUCT.md`/`DESIGN.md`, and ui-ux-pro-max can persist design-system files. **No smoke test was run in this repo**, to respect the no-write constraint. Run these on the 2.0 branch only.
- **taste-skill** `scripts/assets.mjs` fetches public-domain imagery from Openverse, Wikimedia Commons, the Art Institute of Chicago, and the Met API (`assets.mjs:329,368,422,455`). It is benign but makes network calls.
- **ui-ux-pro-max** scripts are local Python (no `requests`/`subprocess` in the `ui-ux-pro-max` scripts dir).
- **Expo was installed as skills only, not as the plugin.** `plugins/expo/hooks/hooks.json` in the Expo plugin registers `PostToolUse(Skill)` and `UserPromptExpansion` hooks that run `node …/expo-skill-feedback/scripts/skill-event.cjs` (telemetry; opt-in per Expo's description). Installing with `npx skills add` copies only the `SKILL.md` folders, so no hooks run. Verified: no `hooks.json` or `settings.json` under `~/.claude/skills`.
- impeccable was also installed as a skill only, not via its `.claude-plugin` marketplace. Installing both would register a duplicate trigger plus 4 extra agents.
- The `skills` CLI collects install telemetry; it was run with `DISABLE_TELEMETRY=1`.

## Considered, not installed

| Candidate | Reason |
|---|---|
| `designed-by-ai/skills@design-mobile-apps` | **Red flag:** 848k "installs" against **16 GitHub stars**, which suggests an inflated install count. Skipped. |
| `uizze.sh@ui-taste`, `uizze.sh@ios-design` | Distributed from a domain, not a GitHub repo, so there is no source to vet. Skipped. |
| `nutlope/hallmark` ★30k | Another anti-slop director that overlaps impeccable and taste; it would add another conflicting auto-trigger. |
| taste-skill siblings (`high-end-visual-design`, `gpt-taste`, `redesign-existing-projects`, `minimalist-ui`, …) | One taste skill is enough. They conflict with each other and with impeccable. |
| ui-ux-pro-max siblings (`design`, `brand`, `banner-design`, `slides`, `ui-styling`, `design-system`) | Out of scope (logos, slides, banners). Some call external image APIs. |
| `vercel-labs` `vercel-react-best-practices` | Duplicates the installed `vercel:react-best-practices`. |
| Other Expo skills (`eas-*`, `expo-module`, `expo-dom`, `expo-animation`, `expo-examples`, …) | Add them once Expo is chosen: `npx -y skills add expo/skills -s <name> -g -a claude-code -y --copy`. |
| Other Capgo skills (`capacitor-security`, `capacitor-app-store`, `capgo-live-updates`, …) | Add them only if Capacitor is chosen. `capacitor-security` is worth adding then. |
| `wshobson/agents@wcag-audit-patterns`, `ibelick/ui-skills@fixing-accessibility` | Covered by `accessibility`, impeccable `audit`, and `web-design-guidelines`. |
| Anthropic `frontend-design` | Already installed (`frontend-design:frontend-design`). |

## Trigger overlap and how to drive these skills (important)

`frontend-design`, `impeccable`, `ui-ux-pro-max` and `design-taste-frontend` all auto-match on "design/redesign UI", and they give conflicting directions. For 2.0, **invoke them explicitly** rather than relying on auto-trigger:

1. **Direction and tokens:** `/impeccable shape` (Operate mode) for each view. Optionally use `/ui-ux-pro-max` to look up palette and font candidates that replace the `jw-*` tokens in `src/index.css:4-13`.
2. **Build:** impeccable `craft`, `typeset`, `colorize`, `layout`, plus `vercel-composition-patterns` for component APIs.
3. **Gate before merge:** `/impeccable audit`, `/web-design-guidelines <files>`, `/accessibility`.
4. **Motion:** `/emil-design-eng` and `vercel-react-view-transitions` for tab transitions.
5. **Mobile:** `expo-overview` → `expo-web-to-native` (Expo path), or `capacitor-best-practices` (wrap-the-web-app path).
6. Reserve `design-taste-frontend` for any public landing or download page. It is explicitly not for app screens.

If auto-trigger noise becomes a problem, remove the extra skill: `npx skills remove <name> -g`.

## Maintenance

- List: `npx skills ls -g -a claude-code`
- Update: `npx skills update -g`
- Remove: `npx skills remove <name> -g`
- Install location: `C:\Users\Santiago\.claude\skills\<name>` (copied files, so `update` re-copies them).
