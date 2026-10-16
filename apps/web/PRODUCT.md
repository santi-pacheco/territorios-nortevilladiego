# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(Also shipped inside a Capacitor 8 shell for Android and iOS. The design language stays web; native affordances come from the shell: safe areas, back button, share sheet, haptics.)

## Users

- **Members (primary).** Publishers of Cong. Norte Villa Diego, many of them older, on mid-range Android phones and often outdoors in sunlight. They open the app to answer one question quickly: "what's today, where, with whom, is it my turn?"
- **Editors (secondary).** A few people who build the weekly salidas, the carrito schedule and the monthly meeting program. They are often on a desktop browser, and also edit on phones.

## Product Purpose

One place for the congregation's weekly field-service arrangements:
- the salidas (meeting point, time, conductor, groups, territories);
- the territory map with today's assigned territories;
- the carrito turns;
- the midweek and weekend meeting program.

Success means a member finds their info in one tap from launch, and an editor publishes a change that every member sees within seconds, without ever losing an edit.

## Positioning

The app replaces a printed weekly card and a PDF program with a live version that keeps the card's familiar day colours. It links each salida to the actual territory polygons on a map, and generates the carrito schedule while respecting pairing and gender rules. A generic calendar app cannot do this.

## Operating Context

- The printed weekly salidas card is shared as an image on WhatsApp. The PNG share card is a core workflow and must stay faithful to the printed layout.
- The monthly meeting program arrives as two PDFs (midweek "ENTRE SEMANA" and weekend). Editors upload them, and the app parses them.
- Territories come from a Google My Maps KML (49 polygons, numbered).
- Members use the map on foot to navigate, with locate/follow/compass modes.
- Connectivity is spotty, so the app must open offline with the last known data.

## Capabilities and Constraints

- Spanish UI, Rioplatense voseo ("Tocá", "Subí").
- Views: Salidas (default), Mapa, Carrito, Programa. Gestión (editing) sits behind sign-in.
- Viewers are anonymous. "Soy…" lets a member pick their name, stored only on that device, to highlight their turns and parts. People data (names, availability) is visible to editors only.
- Per-editor accounts with roles. Public sign-up is disabled.
- Backend: Supabase (new 2.0 project), realtime updates, row-level tables with version checks.
- Performance budget: eager JS ≤ 150 KB gz; the map and PDF code load lazily.

## Brand Commitments

- Name: "Cong. Norte Villa Diego" plus the app name "Territorios". Keep these.
- Do **not** carry over v1's navy and gold look. Do **not** use official JW logos, marks or typefaces.
- Day colours from the printed card are learned by members and must be preserved as a navigation colour code.

## Evidence on Hand

- `ModeloNuevo.jpeg` in v1: the reference layout for the new weekly card (Domingo with groups G1–G4).
- The real data lives in the v1 Supabase project and is imported into 2.0. The repo holds no real names; fixtures use fake names.
- No testimonials or metrics exist; do not fabricate any.

## Product Principles

1. **Today first.** Launch lands on today's salidas. Everything else is one tap away.
2. **Members first, editors second.** Public screens carry no edit chrome.
3. **Never lose an edit.** Conflicts are shown, never silently overwritten.
4. **Readable in the sun.** Legibility beats decoration.
5. **Light and fast on cheap phones.** Every dependency has to earn its bytes.

## Accessibility & Inclusion

- WCAG 2.2 AA throughout. Base text is 17 px, and nothing is smaller than 13 px.
- Layouts survive 200% text scaling.
- A high-contrast **Sol** theme (≥ 7:1 body contrast) for use in sunlight.
- Touch targets are at least 44 px.
- Respect reduced motion.
- Older users: use explicit labels next to icons, with no icon-only primary actions.
