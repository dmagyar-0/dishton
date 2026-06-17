# UI/UX changes since last design sync

- Snapshot of `main` @ `e02ea90` (e02ea90a1a453e212a241960dd78b5cc5643f781)
- Previous sync: `fbd85094a19fc8706e5aa28befc843260a3c5e2f`
- Range: `fbd85094a19fc8706e5aa28befc843260a3c5e2f..e02ea90a1a453e212a241960dd78b5cc5643f781`

## Commits touching UI-affecting paths

- Re-theme to Soft Contrast and rebuild Home (Lane 3) (#144) (e02ea90)
- Home meal-category tiles + Customize sheet (#140) (059fa84)

## Files changed (UI-affecting paths)
```
 index.html                                 |   2 +-
 public/manifest.webmanifest                |   4 +-
 public/offline.html                        |  20 +-
 src/domain/default-tags.test.ts            |  65 ++++++
 src/domain/default-tags.ts                 |  57 ++---
 src/lib/i18n.de.ts                         |  27 +++
 src/lib/i18n.en.ts                         |  27 +++
 src/lib/i18n.hu.ts                         |  27 +++
 src/routes/h/$householdId/index.tsx        | 352 ++++++++++++++++++-----------
 src/styles/global.css                      |  52 +++++
 src/styles/tokens.css                      |  59 ++---
 src/ui/recipe/HomeBanner.tsx               | 107 +++++++++
 src/ui/search/CategoryFilterSheet.test.tsx |  64 ++++++
 src/ui/search/CategoryFilterSheet.tsx      |  85 +++++++
 src/ui/search/CategoryTiles.test.tsx       |  36 +++
 src/ui/search/CategoryTiles.tsx            |  69 ++++++
 src/ui/search/CustomizeHomeSheet.test.tsx  |  80 +++++++
 src/ui/search/CustomizeHomeSheet.tsx       | 171 ++++++++++++++
 src/ui/search/ProduceGlyph.tsx             | 317 ++++++++++++++++++++++++++
 src/ui/search/SearchBar.tsx                |  33 ++-
 src/ui/search/categoryIcons.ts             |  64 ++++++
 src/ui/shell/AppShell.tsx                  |  77 ++++++-
 src/ui/theme.ts                            |  11 +
 23 files changed, 1581 insertions(+), 225 deletions(-)
```
