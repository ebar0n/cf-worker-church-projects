# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`README.md` is the reference for *what* each activity teaches, the full API table and the
deployment setup. This file covers the architecture and the invariants that only show up
when you read several files together.

## Layout

One Cloudflare Worker per church club, each in its own subfolder with its own
`wrangler.jsonc` and its own subdomain. Today there is one, `adventurers/`. All commands
below run from that subfolder.

The church website is a **separate** repo (`cf-worker-church-platform`): Next.js, Prisma,
D1 `church-jordan`. Nothing is shared but the Cloudflare account — don't carry
assumptions across.

## Commands

```bash
nvm use          # Node 24, pinned by .nvmrc — do this first
yarn dev         # applies local migrations, then wrangler dev on :8787
yarn verify      # both check scripts (also what CI runs)
yarn migrate --local|--remote
yarn deploy      # migrations --remote, then wrangler deploy
```

There is no test runner, bundler or lint step. `yarn verify` is the whole gate:

```bash
node scripts/check-games.mjs            # the contract; all activities, no filter
node scripts/check-text.mjs             # plays all 18 in jsdom
node scripts/check-text.mjs pr44        # substring-filter to one or a few activities
DBG=1 node scripts/check-text.mjs pr39  # log every click, to see where a game stalls
node scripts/check-text.mjs pr39 40     # second arg caps the click count (default 400)
```

CI (`.github/workflows/checks.yml`) additionally runs `node --check` on `src/index.js`
and `public/shared/profile.js`.

Deploys are automatic from `main` via Workers Builds. **Its deploy command must be
`yarn deploy`**, because that is what applies pending migrations. If it isn't, a merge
that adds a migration returns 500 from every endpoint — `app.onError` detects
`no such table|no such column` and appends "Falta aplicar las migraciones" to the
message, which is the signature of exactly this.

## Architecture

### No framework, no build

`public/` is served by Workers Static Assets; anything that doesn't match a file falls
through to the Hono app in `src/index.js` (in practice `/api/*`). Each activity is **one
self-contained `index.html`** of roughly 700–1100 lines, with its CSS in an inline
`<style>` and its logic in an inline `<script>`. Nothing is imported, transpiled or
minified, so editing a page is editing exactly what ships.

The only shared code is `public/shared/profile.js` + `.css`, loaded by every page.

### Points: the Worker is the authority, the page is only the UI

Three things have to agree, and they are in different files:

1. `ACTIVITIES` in `src/index.js` — every valid slug. An unrecognised one is a **400**,
   never a silent score somewhere else. An *omitted* `activity` falls back to
   `ACTIVITIES[0]` (`pr39`) so cached copies of old pages keep working.
2. `ACTIVITY_CAPS` in `src/index.js` — the per-activity daily cap by kind
   (`card` / `quiz`). Activities are deliberately not worth the same: `padres-cap17` is
   `{card: 0, quiz: 5}`, `ideales-voto` is `{card: 2, quiz: 0}`,
   `organiza-la-biblia` is `{card: 5, quiz: 5}`. `capFor()` clamps against the global
   `DAILY_LIMIT`.
3. The page's own `AvProfile.init({activity, caps})` — the same numbers, client-side, so
   the UI stops offering points it wouldn't get.

The server-side cap is enforced **inside the `UPDATE ... WHERE` subquery** that counts
today's rows, so it is atomic and a direct POST can't outrun it. The page's copy is a
courtesy; if the two disagree the server wins and the child sees a 429.

`kind` is stored as `'<activity>:<type>'`, which is why migration `0003` had to rewrite
existing rows. Every answer is a row in `adventurers_interactions` — `delta` 1 for
correct, 0 for wrong — so the cap count and the audit trail are the same data. The day
boundary is America/Bogota.

The document number is only ever stored as a salted SHA-256 (`SALT` + `docHash` in
`src/index.js`); there is no plaintext column and the leaderboard returns names only.

### `AvProfile`, the cross-page contract

`public/shared/profile.js` is a single IIFE exposing `window.AvProfile`:
`init, get, onChange, today, cap, pending, clubClass, clubClasses, toast, canScore,
score, pick, open, board`.

Behaviours worth knowing before touching it:

- **`score()` is serialised** through a `scoreChain` promise. It has to be: concurrent
  calls used to drop points while a request was in flight.
- **Offline points are queued** in `localStorage` under `aventureros-cola` and flushed on
  the `online` event and on app open — not Background Sync, which iOS lacks. Resending is
  safe because the cap lives server-side.
- **`pick(bucket, items, n, keyFn)`** is the anti-repetition bag, keyed per child **and
  per ISO week**; when a bag empties it resets. Two siblings on one phone have separate
  bags. `check-games.mjs` requires every activity either to call it or to declare
  `sin-rotacion: <razón>`.
- **`CLASSES`** is the single source for the age→club-class mapping (Principiantes 2–3
  … Manos Ayudadoras 9). It drives the player chip, question tiers, some difficulty, and
  the home page ordering via `data-from`/`data-to` on each card.

### CSS cascade gotcha

`shared/profile.css` is linked in `<head>` immediately **before** each page's inline
`<style>`. Equal-specificity rules in the page therefore win. Shared rules that must not
be overridden are written with a `body ` prefix — that is why the file has selectors like
`body .topbar` and `body .pf-version`.

### One version number

`package.json` `version` is the source. It must equal `APP_VERSION` in
`shared/profile.js` (rendered in the page footer, so the running version is legible on a
phone with no signal) and `VERSION` in `sw.js` (its value names the caches, so changing
it purges them). `check-games.mjs` fails when the three disagree.

Bump it whenever shared CSS/JS changes or an activity is removed; otherwise an installed
phone keeps serving its cached copy, including pages that no longer exist.

## The activity page contract

`check-games.mjs` enforces all of this per folder — read its `fail(dir, ...)` calls for
the authoritative list:

- Folder name is the slug, and `const ACTIVITY` in the page must match it and be listed
  in `ACTIVITIES`.
- Calls `AvProfile.init` with an `activity`; loads both shared files; has
  `#playerChip` and `#changePlayerBtn`.
- Consults `canScore` and calls `score` — a page that never scores fails.
- Four `data-tab` sections: `leer` (the source, shown first — the game checks what was
  read rather than teaching from scratch), a practice section, `material` (printable,
  needs `@media print`) and `padres`.
- No `alert`/`confirm`/`prompt`, no drag & drop (unusable on phones), no external
  resources beyond `<a href>` links, `og:url` matching the real path, balanced tags,
  inline scripts that parse, and every `getElementById` id actually present.

Registering an activity means touching four places: the folder, `ACTIVITIES`
(`src/index.js`), `RUTAS` (`public/sw.js`, or it won't work offline) and a card on
`public/index.html`. `check-games.mjs` checks all four, in both directions — an activity
missing from the index and a dead link in the index both fail.

## Verifying beyond the scripts

`check-text.mjs` mounts each page in jsdom, stubs `AvProfile`, clicks through it, opens
every menu tab, and **fails when `undefined`, `NaN` or `[object Object]` reaches the
screen**. It shortens the games' `setTimeout` delays so a game waiting on a round
transition isn't mistaken for a stuck one.

Its report is worth reading, not just its exit code: the `+card=` / `+quiz=` columns are
how many points the game managed to award. An activity that scores **0** usually has a
guard that never passes rather than a game that's hard to click.

Neither script replaces opening the page. Play at ~390px, take the wrong answer as well
as the right one, and open the `material` tab — it holds static content that the game
flow never renders, so it is where stale markup hides.

A CSS rule whose class no longer appears anywhere in the markup means that component
renders unstyled. Nothing fails; it just looks broken.

## Conventions

**Code in English, content in Spanish** — including branch names and commit messages in
English. The exception is comments, which are Spanish.

Every biblical fact has to be traceable to the chapter or passage the activity cites; if
it comes from elsewhere, the page says so.
