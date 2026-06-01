# Image fixtures (not committed)

The Stage-3 photos are gitignored (binary + possible cookbook copyright). To run
the image lane, drop the photos here, e.g.:

```
fixtures/images/shepherdless-pie/IMG_*.jpg   # the 4-photo breakdown matrix
```

`cases.ts` reads every image in `fixtures/images/shepherdless-pie/` (sorted by
name) and feeds them through the production `structuringFromImage` prompt with
the note *"use only the middle column."* Update `cases.ts` to add more image
cases. The expected answer for the existing case lives in
`../../gold/sweet-potato-cottage-pie.json`.
