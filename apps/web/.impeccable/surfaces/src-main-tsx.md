---
version: 1
slug: "src-main-tsx"
primary_target: "src/main.tsx"
related_targets: []
---

# Surface brief: app shell + Salidas (members)

Scope: the whole member app shell (tabs Salidas, Mapa, Carrito, Programa; avatar sheet; Gestión stack) with Salidas as the first surface. Mode: Operate.

Audience/job: congregation members on mid-range Android phones outdoors; answer "what's today, where, with whom, is it my turn" in one tap. Editors secondary.

## Direction contract
THESIS: Each day is a train line in its printed-card colour and each salida is a station on it, in time order. It refuses the category default of grey list cards with a blue accent.
OWN-WORLD: Cool grey canvas (#eef1f4), white station cards, ink #14181f. The day-accent line stripe is the only strong colour per screen. Territory numbers sit in round black roundels set in mono. Day tabs carry a short line swatch plus one tick per salida. No navy+gold, no gradients, no glass.
STORY: The member sees today's line, knows which station is next and how long until it, taps through to the map or territories, and trusts that any change stays marked until seen.
FIRST VIEWPORT: Header: congregation + week (caption), day name as title, then the day strip. Body: an 8px vertical stripe in the day accent with 24px station dots. Each station card shows a mono time at 28px, the place at 17/600, the conductor and groups at 15 secondary, and the roundels. The next station is outlined 2px ink with "Próxima · en N min". Past stations are hollow and faded. Bottom tab bar on mobile; left rail on desktop with a Salidas+Mapa split.
FORM: Trenes Argentinos line diagram, #5 on the ordered list; seed:03cb1d9aaa48756d. Raises: change marks persist until seen (boarding pass); state by line form, not only hue (emission rail); few type sizes, rank by weight (timetable); day tabs show extent ticks (acetate manual).
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
