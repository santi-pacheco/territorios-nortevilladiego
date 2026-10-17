# Territorios · Cong. Norte Villa Diego

Weekly field-service arrangements for one congregation: salidas, territory map, carrito turns and the meeting program. Spanish UI, built for phones used outdoors.

Live: https://nortevilladiego.vercel.app

## Stack

- `apps/web`: React 19 + Vite + Tailwind 4, installable PWA. Deployed on Vercel.
- `apps/mobile`: Capacitor 8 shell around the same web app (Android first).
- `packages/core`: pure logic (carrito scheduler, program PDF parsers, salidas rules).
- `packages/data`: Supabase client, Zod schemas, TanStack Query hooks, realtime sync.
- `packages/ui-tokens`: design tokens (light, dark, high-contrast "Sol").
- `supabase/`: schema migrations, row-level security, pgTAP tests.

## Develop

```sh
pnpm install
npx supabase start          # local database with fake seed data
pnpm dev                    # web app
pnpm run verify             # typecheck, lint, tests, build, size budget, secret scan
```

Real member data lives only in the hosted Supabase project. The repository contains fake names only, and CI fails if secret keys appear in the source.
