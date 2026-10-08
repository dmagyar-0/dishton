# Image fixtures

Photos used by the image-lane cases in `../../cases.ts`, downscaled to 1568 px
on the long edge (the size the Anthropic API resizes images to anyway).
`cases.ts` reads every image in a case folder, **sorted by filename**, and
feeds them through the production `structuringFromImage` prompt with a
user note.

| folder | photos | note given | gold |
|---|---|---|---|
| `shepherdless-pie/` | method p.1 (steps 1–6), method p.2 (steps 7–10), breakdown, breakdown continued | "use only the middle column" (Sweet Potato Cottage Pie) | `../../gold/sweet-potato-cottage-pie.json` |
| `classic-pancakes/` | method page, breakdown table with handwritten amounts over the middle column | American-style column, with the handwritten amounts | `../../gold/american-pancakes.json` |

Other photos dropped here stay local (see `../../.gitignore`).
