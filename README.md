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
npm run verify         # astro check + astro build + scripts/check-dist.mjs
npm run preview        # serve dist/ on http://127.0.0.1:4400/
npm run test:a11y      # with the preview running: axe, overflow, keyboard and reduced-motion checks
npm run og             # re-render public/og/retronative.png
```

`test:a11y` and `og` use Playwright's Chromium (`npx playwright-core install chromium`);
`test:a11y` loads axe-core 4.10.2 from cdnjs into each page.

## Layout

| Path | Role |
|---|---|
| `src/data/projects.json` | The projects gallery. One entry per port, validated by `src/content.config.ts` |
| `src/data/contributors.json` | The hand-curated contributor list (empty for now), validated by `src/lib/contributors.ts` |
| `src/site.config.ts` | Organization name, mission line, description, GitHub link |
| `src/components/` | `Hero`, `Section`, `ProjectGallery`, `ProjectCard`, `ProjectArt`, `StatusBadge`, `Disclaimer`, `ContributorList`, `Seo`, `SiteHeader`, `SiteFooter`, `Wordmark`, `ExternalLink` |
| `src/pages/` | `/`, `/projects/`, `/projects/<id>/`, `404` |
| `src/styles/` | Design tokens, fonts, base styles |
| `scripts/check-dist.mjs` | Checks on the build: metadata, links and anchors, private and download links, sitemap, project path collisions |
| `scripts/a11y.mjs` | Accessibility checks against a running preview |
| `deploy/github-pages.yml` | Inactive GitHub Pages workflow template |

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

## Deployment

Not enabled. Once approved: create the public repository `retronative/retronative.github.io`,
set Settings → Pages → Source to "GitHub Actions", move `deploy/github-pages.yml` to
`.github/workflows/`, run it once by hand, check the result, then enable its `push` trigger.

## Licenses

- Site code: [MIT](LICENSE).
- Original written content: [CC BY 4.0](LICENSE-CONTENT.txt).
- Fonts: Chakra Petch, Inter and JetBrains Mono, self-hosted from `@fontsource`, under the
  SIL Open Font License 1.1. Their license texts are published with the site in `public/licenses/`.
- The colour palette's values match ReCarbon's website; the stylesheets here are original.

Game titles are trademarks of their owners and appear only to describe the games. RetroNative
projects are unofficial and not affiliated with any game's publisher or platform holder.
