# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

Study apps for the ministries of Iglesia Adventista Jordán, Ibagué. Today that is
`adventurers/`: a Cloudflare Worker serving 18 study activities for the **El Elohe
Israel** Adventurer Club, which prepare children for the *Guardianes del Santuario*
camporee (9–12 October 2026).

The church website is a **separate** repo (`cf-worker-church-platform`): Next.js,
Prisma, D1 `church-jordan`. Nothing here shares that stack — don't carry assumptions
between the two.

## Stack

- **Runtime:** Cloudflare Workers, `src/index.js`, Worker name
  `cf-worker-church-projects-adventurers`
- **API:** Hono 4, JSON only
- **Pages:** Workers Static Assets — plain HTML/CSS/JS under `public/`, one folder per
  activity, no framework and no build step
- **Database:** D1 `church-jordan-projects`, shared with future sibling apps, so this
  app's tables are prefixed `adventurers_`
- **PWA:** `public/manifest.webmanifest` and `public/sw.js` (network-first navigations,
  stale-while-revalidate assets, `/api/*` never cached)
- **Tooling:** wrangler, jsdom for the checks. Node 24, pinned by `adventurers/.nvmrc`

## Commands

Run from `adventurers/`:

```bash
nvm use                 # Node 24 — do this first
yarn dev                # applies local migrations, then wrangler dev on :8787
yarn verify             # contract validator + plays every activity in a real DOM
yarn migrate            # D1 migrations (--local or --remote)
yarn deploy             # migrations --remote, then wrangler deploy
```

Deploys happen automatically from `main` via Workers Builds. **Its build command has to
run the migrations.** If it doesn't, a merge that adds a migration takes the API down
with "Falta aplicar las migraciones", because the code expects columns the database
lacks.

## Language

**Code in English, content in Spanish.** Identifiers, object keys, CSS classes, element
ids, branch names and commit messages are English. Everything a child or a parent reads
is Spanish. Comments explaining *why* are in Spanish, the language the maintainer thinks
in.

## Points

The Worker is the authority, not the pages. `src/index.js` holds `ACTIVITIES` (every
valid slug; an unknown one is a 400) and `ACTIVITY_CAPS`, the per-activity daily cap by
kind. Activities are deliberately **not** worth the same: the parent chapters give 5
question points and no game points, the vow gives 2. A child earns each activity's
points once a day and accumulates across all of them.

`AvProfile` in `public/shared/profile.js` enforces the same caps client-side, queues
points in `localStorage` when offline, and rotates questions per child per ISO week
(`AvProfile.pick`) so two siblings sharing one phone don't get the same questions.

## One version number

`adventurers/package.json` `version` is the single source. It must equal `APP_VERSION`
in `public/shared/profile.js`, which prints in the page footer so the version is legible
on a phone with no signal, and `VERSION` in `public/sw.js`, whose value names the caches
so changing it purges them. `check-games.mjs` fails if the three disagree.

Bump it on every deploy that changes shared CSS/JS or removes an activity. Otherwise an
installed phone keeps serving its cached copy, including pages for activities that no
longer exist.

## Verifying

`yarn verify` runs two gates:

- `scripts/check-games.mjs` — the contract. Activity slug matches its folder, rotation
  present, shared modules loaded, print stylesheet, no `alert`, `sw.js` covers every
  route, manifest shortcuts point at activities that exist, one version number
  everywhere. A failure is pushed onto `failures` and the script exits 1.
- `scripts/check-text.mjs` — plays each activity in jsdom, opens every menu tab, and
  fails when `undefined`, `NaN` or `[object Object]` reaches the screen. It shortens the
  games' timers so a game waiting on a round transition isn't mistaken for a stuck one.

Neither replaces opening it. Play each activity in the browser at ~390px, take the
**wrong** answer as well as the right one, and open the printable tab — that tab holds
static content the game flow never renders.

Two signals worth reading as bugs rather than details: an activity that scores zero
points in the playtest usually has a guard that never passes, and a CSS rule whose class
no longer appears in the markup means that component renders unstyled.

## Working agreements

- **Don't deploy ad hoc.** Do the whole job, then one commit, PR, merge; the automatic
  deploy takes it from there.
- **Never run a migration against production without asking**, and don't assume the
  hosted deploy command applies them.
