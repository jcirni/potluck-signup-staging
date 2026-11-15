# Bring a Dish

A userless potluck signup app. Anyone can create an event, share one
link, and every guest can see who is coming, what they are bringing,
and what the menu still needs. No accounts, no logins.

Modeled on a 2024 Friendsgiving spreadsheet with columns
**Name | What are you bringing? | Course | Need Oven? | Food Allergies?**
and a menu grouped by course. Live backend: a free Supabase project.
Frontend: Vite + React + TypeScript, hosted on GitHub Pages, and
installable as a PWA.

## Features

- **Events with two links:** a public share link (`?event=<id>`) for
  guests and a private admin link (`?event=<id>&admin=<token>`) for
  the host. Only SHA-256 hashes of the tokens are ever stored.
- **Signup form:** name, dish, course, needs oven, servings, allergy
  and dietary notes. Guests can claim a dish from the built-in catalog
  or type their own, and can pick a recipe scale (0.5x, 2x, and so on).
- **Live menu grouped by course:** Appetizers, Mains, Sides,
  Desserts, Drinks, Supplies, with oven tags and one allergy roll-up.
- **Gap panel ("We could use more of"):** per-course count against
  host-set targets, most needed first, plus a dietary coverage check
  (vegetarian, vegan, gluten-free, no pork) against the host's stated
  needs.
- **Claim-a-dish gap view:** dishes the menu still needs, offered from
  the catalog so a guest can claim one in a click.
- **Duplicate detection:** the same dish signed up twice is flagged,
  exactly when two guests claim the same catalog dish.
- **RSVP headcount** separate from dishes (adults and kids per party),
  so the host knows the real count even when a party brings one dish.
- **Oven and reheat timeline:** which dishes need the oven, at what
  temperature, hottest first.
- **Recipe scaling and shopping list:** claimed catalog dishes turn
  into one aggregated shopping list, quantities scaled per cook.
- **Menu balance and macros:** per-serving macro estimates for catalog
  dishes, rolled up across the menu.
- **Supplies as a signup category:** ice, plates, cups, and the like
  are claimable like dishes.
- **Calendar export:** a `.ics` file for the event with the menu in
  the description.
- **Edit without accounts:** a guest's edit token lives in their
  browser, so they can edit or remove their own signup later. The
  host's admin link can edit the event and remove any signup.

## Architecture

- **Framework-free logic layer.** Everything testable lives in
  `src/lib/` as plain TypeScript: gap analysis, duplicate detection,
  dietary coverage, oven planning (`gaps.ts`), the dish catalog
  (`catalog.ts`), shopping lists (`shopping.ts`), calendar export
  (`ics.ts`), and storage (`storage.ts`). React is only the shell
  (`src/App.tsx`), which is what makes a future native wrapper cheap.
- **One storage interface.** Backends sit behind `SignupStore`
  (`list / add / update / remove` plus event methods) in
  `src/lib/storage.ts`. Production ships exactly one:
  - **Supabase:** the public backend. Anyone can create an event;
    data lives in one Postgres project, chosen at build time by
    repository variables (a staging repo points at a staging
    project). Setup: [docs/BACKEND.md](docs/BACKEND.md).
  - **This browser only (dev only):** a localStorage store for
    development and tests, enabled by `npm run dev` or
    `VITE_ENABLE_DEV_STORES=1`. Production builds ignore it
    entirely: no mode switcher, no local saving. (Earlier URL
    snapshot and Google Sheet stores were removed.)
- **Static catalog.** The dish catalog is a JSON file in
  `public/data/`, not a database table. Supabase stores only events,
  signups, and RSVPs; a signup references a catalog dish id or is
  free text.

## The dish catalog

`public/data/dishes.json` holds 155 dishes across 25 cuisines plus 8
supply items. Each dish has a course, cuisine, description, servings,
prep and cook minutes, an estimated cost, ingredients with
quantities, steps, per-serving macros, logistics (oven need and
temperature, crockpot, make-ahead, travels well, serving utensil), and
tags for allergens contained and diets satisfied.

### Contributing a dish

Open a pull request editing `public/data/dishes.json`. A dish entry
needs every field; `npm test` runs `validateCatalog` over the real
file and will reject a malformed entry. Field notes:

- `id`: lowercase slug, unique.
- `course`: one of Appetizers, Mains, Sides, Desserts,
  Drinks. (Supplies are separate `supplies` entries with just `id`,
  `name`, `description`, `estCostUsd`.)
- `origin`: optional credit, a plain name.
- `macros`: estimated per serving, calculated from the ingredient
  list against USDA FoodData Central values, and labeled estimated
  in the app. Never copy macros from a copyrighted source. A test
  checks calories land within 15 percent of
  4 x protein + 4 x carbs + 9 x fat.
- Recipes must be written in your own words from standard
  preparations. If a recipe is adapted from a CC BY-SA source such as
  the Wikibooks Cookbook, say so in the pull request; catalog data
  that adapts CC BY-SA material ships under CC BY-SA with attribution
  to that source.

## Backend

Supabase setup from scratch, the security model (token hashes only,
row-level security with select and insert only, edits through
token-checked database functions), and the production / staging /
dev environment split are documented in
[docs/BACKEND.md](docs/BACKEND.md). The schema itself is
`backend/supabase.sql`.

Two things worth knowing here:

- The Project URL and anon key are public by design and ship as
  defaults in the client. The service_role key and the database
  password are never used by the app and must never be committed.
- A GitHub Actions keep-alive (`.github/workflows/keep-alive.yml`)
  pings the database every 3 days so the free project never hits the
  1-week inactivity pause.

## PWA: install and offline behavior

The production build is an installable Progressive Web App
(`vite-plugin-pwa`, configured in `vite.config.ts`):

- **Install:** serve `dist/` over HTTPS (GitHub Pages qualifies).
  Chrome and Edge offer install from the address bar; on Android an
  Install app button also appears in the app when the browser fires
  `beforeinstallprompt`. On iPhone and iPad: Share, then Add to Home
  Screen. The installed app runs standalone with its own icon.
- **Paths:** the manifest `start_url` and `scope` are relative and the
  build uses `base: './'`, so the installed app works from any GitHub
  Pages subpath. Icons live in `public/icons/`, drawn from
  `public/icons/icon.svg`.
- **Caching rule:** the service worker precaches the app shell and the
  dish catalog, and updates itself automatically. Signup data is
  never cached: requests to `*.supabase.co` are NetworkOnly in the
  Workbox config, so the menu a guest sees is always live.
- **Native later:** Capacitor can wrap this same `dist/` output into
  iOS and Android packages later. The UI is plain React and the logic
  is framework-free TypeScript, so no rewrite is needed; only native
  plugins would be added.

## Local development

```sh
npm install
npm run dev     # Vite dev server
npm test        # Vitest: catalog, gaps, shopping, ics, storage cleaners
npm run build   # tsc type check plus Vite production build into dist/
```

Tests live next to the modules they cover (`src/lib/*.test.ts`) and
run in CI on every push.

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`: `npm ci`,
`npm test`, `npm run build`, then deploy of `dist/` to GitHub Pages
via `actions/upload-pages-artifact` and `actions/deploy-pages`. The
`base: './'` build works under the repo subpath
(`https://jcirni.github.io/potluck-signup/`). The workflow can also be
run by hand from the Actions tab.

## Sample data

In the dev local store, the demo event seeds the four rows from the
2024 Friendsgiving sheet: Howard's Taiwanese stir fry rice noodles
(Mains), Joe's salmon (Mains), Valerie's stuffing (Sides), Gardner's
seltzers (Drinks). They are marked as samples and can be cleared from
Manage event. Production never seeds them.

## License

MIT. Catalog recipes adapted from CC BY-SA sources remain CC BY-SA
with attribution, as described under Contributing a dish.
