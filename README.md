# RetroNative website

The organization site of RetroNative, planned for <https://retronative.github.io/>: a static
[Astro](https://astro.build) site, dark-only, with no client-side JavaScript.

> Bringing classic games to modern platforms through native recompilation.

Not deployed. Publishing needs the public repository `retronative/retronative.github.io`
(see [Deployment](#deployment)).

## Commands

Node 22.12 or later.

```sh
npm ci                 # install the pinned dependencies
npm run dev            # dev server on http://127.0.0.1:4400/
npm run verify         # astro check + scripts/check-knowledge-graph.mjs + astro build + scripts/check-dist.mjs
npm run preview        # serve dist/ on http://127.0.0.1:4400/
npm run test:a11y      # with the preview running: axe, overflow, keyboard and reduced-motion checks
npm run test:knowledge # with the preview running: /knowledge/ behaviour (no-JS list, search, lazy graph, advanced mode, labels, motion)
npm run og             # re-render public/og/retronative.png
npm run hero-still     # re-render public/hero/platformer-still.png after changing the hero scene
npm run hero-laptop -- <photo>   # re-cut public/hero/laptop-*.webp from the laptop photo
```

`test:a11y`, `test:knowledge`, `og`, `hero-still` and `hero-laptop` use Playwright's Chromium (`npx playwright-core install chromium`);
`hero-laptop` also needs `cwebp` and `dwebp` (libwebp) on the `PATH`;
`test:a11y` and `test:knowledge` load axe-core 4.10.2 from cdnjs into each page. Both take the preview's URL as
an argument (`npm run test:knowledge -- http://127.0.0.1:4401`).

## Layout

| Path | Role |
|---|---|
| `src/data/projects.json` | The projects gallery. One entry per port, validated by `src/content.config.ts` |
| `src/data/knowledge-graph.json` | The knowledge graph shown on `/knowledge/`, pinned byte for byte from `retronative/game-port-knowledge` by `src/data/knowledge-graph.lock.json` (see [Knowledge base](#knowledge-base)) |
| `src/data/contributors.json` | The hand-curated contributor list (empty for now), validated by `src/lib/contributors.ts` |
| `src/site.config.ts` | Organization name, mission line, description, GitHub link |
| `src/lib/platformer.ts` | The hero's original 8-bit platformer loop (canvas, about 3.5 KB gzipped), also drawn as the no-JS still |
| `src/lib/knowledge.ts` | The build-time view model of `/knowledge/` (symptoms, guides and their techniques, investigations, projects, evidence rows) |
| `src/lib/knowledge-graph-view.ts` | The optional interactive graph on `/knowledge/` (Cytoscape), loaded only by dynamic `import()` when it is opened |
| `src/lib/laptop.ts` | The hero laptop photo's display geometry (corners, notch) and the CSS mapping of the game onto it; `scripts/cut-hero-laptop.mjs` uses it to black out the display |
| `src/components/` | `KnowledgeEvidence` (the collapsed evidence of a `/knowledge/` item), `Hero`, `CodeTranslation`, `Section`, `ProjectGallery`, `ProjectCard`, `ProjectArt`, `StatusBadge`, `Disclaimer`, `ContributorList`, `Seo`, `SiteHeader`, `SiteFooter`, `Wordmark`, `ExternalLink` |
| `src/pages/` | `/`, `/projects/`, `/projects/<id>/`, `/knowledge/` (and its `/knowledge/graph.json`), `404` |
| `src/styles/` | Design tokens, fonts, base styles |
| `scripts/check-dist.mjs` | Checks on the build: metadata, links and anchors, private and download links, sitemap, project path collisions, the served knowledge graph against its lock |
| `scripts/check-knowledge-graph.mjs` | Checks the pinned knowledge graph: hash, schema 2 (confidences, advanced flags, relation vocabulary), no inferred edges, document and section links, provenance, denylist |
| `scripts/a11y.mjs` | Accessibility checks against a running preview |
| `scripts/knowledge-test.mjs` | Behaviour tests of `/knowledge/` against a running preview |
| `.github/workflows/deploy.yml` | The GitHub Pages deployment (actions pinned to release commits) |

## Adding a project

Add an entry to `src/data/projects.json`. The build fails if an entry doesn't match the schema.

- `status.label` is shown verbatim. `released` and `downloads` stay `false` until there is a
  public release; there is no field for a download link.
- `links.site`, `links.repo` and `links.issues` are rendered only when `public` is `true`.
  `scripts/check-dist.mjs` fails if any page links to a non-public target.
- `legal.disclaimer` is shown on the home page, the gallery and the project's page.
- Card art is generated from `accent` and `glyphs`; no game imagery is used anywhere.
- The site never builds a route at `/<id>/`: on this domain that path belongs to the
  project's own GitHub Pages site.

## Knowledge base

`/knowledge/` presents the knowledge base (`retronative/game-port-knowledge`) by concept: start from a symptom,
browse guides and the techniques they document (each linked to its section on GitHub), read the investigations (case
studies), or see which guides and investigations draw on each project. Commit hashes are evidence, not headings: on the
list they appear only inside each item's collapsed "Evidence" (with the file and line), and the interactive graph shows
commits only in Advanced mode (a checkbox, shared as `/knowledge/#advanced`). "Cites the same evidence as" is a DERIVED
relationship (two items cite the same commit) and never claims a cause. Its data is the generated
`knowledge-graph/graph.json` of that repository, copied unchanged to `src/data/knowledge-graph.json` and
pinned by `src/data/knowledge-graph.lock.json` (version, sha256, commit, path). Don't edit it by hand: to
update it, copy the file from a new commit of the knowledge base and update the lock.

`scripts/check-knowledge-graph.mjs` (part of `npm run verify`) checks the hash against the lock and, when a
checkout of the knowledge base sits next to this one (`../game-port-knowledge`), that the file is the one at
the locked commit; without it the hash alone is checked (`KNOWLEDGE_GRAPH_REQUIRE_PROVENANCE=1` makes that a
failure). Inferred edges are refused unless `KNOWLEDGE_GRAPH_ALLOW_INFERRED=1`.

**Before deploying `/knowledge/`, the knowledge base repository must be public.** Until then every
document link on the page returns 404.

## Deployment

`.github/workflows/deploy.yml` builds, checks (`astro check`, `scripts/check-knowledge-graph.mjs`, `scripts/check-dist.mjs`) and deploys
the site to GitHub Pages (Settings → Pages → Source: GitHub Actions). It runs on every push to
`main`, or by hand.

## Licenses

- Site code: [MIT](LICENSE).
- Original written content: [CC BY 4.0](LICENSE-CONTENT.txt).
- Fonts: Chakra Petch, Inter and JetBrains Mono, self-hosted from `@fontsource`, under the
  SIL Open Font License 1.1. Their license texts are published with the site in `public/licenses/`.
- The colour palette's values match ReCarbon's website; the stylesheets here are original.
- The hero laptop photo (`public/hero/laptop-*.webp`) is © Which? and used with the rights
  holder's permission. It is not covered by the MIT or CC BY 4.0 licenses above. The source
  photo is kept out of the repository; the game shown on its screen is original.

Game titles are trademarks of their owners and appear only to describe the games. RetroNative
projects are unofficial and not affiliated with any game's publisher or platform holder.
