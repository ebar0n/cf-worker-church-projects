# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

Study apps for the ministries of Iglesia Adventista Jordán, Ibagué. Today that is
`adventurers/`: a Cloudflare Worker (Hono JSON API + Workers Static Assets) that serves
18 study activities for the **El Elohe Israel** Adventurer Club, preparing children for
the *Guardianes del Santuario* camporee (9–12 October 2026).

It shares the D1 database `church-jordan-projects` with future sibling apps, so this
app's tables are prefixed `adventurers_`. The church website is a **separate** repo
(`cf-worker-church-platform`, Next.js, D1 `church-jordan`) — don't mix the two.

## Commands

```bash
nvm use                 # Node 24, pinned by adventurers/.nvmrc — do this first
yarn dev                # applies local migrations, then wrangler dev on :8787
yarn verify             # contract validator + plays every activity in a real DOM
yarn migrate            # D1 migrations (--local or --remote)
yarn deploy             # migrations --remote, then wrangler deploy
```

Deploys happen automatically from `main` via Workers Builds. **Its build command must run
the migrations.** When it doesn't, a merge that adds a migration takes the API down with
"Falta aplicar las migraciones", because the code expects columns the database lacks.

## Language

**Code in English, content in Spanish.** Identifiers, object keys, CSS classes, element
ids, branch names, commit messages and comments-as-code are English. Everything a child
or a parent reads is Spanish. Comments explaining *why* are written in Spanish here
because that is the language the maintainer thinks in.

## Renaming across files

This rule exists because ignoring it cost a full day and shipped broken games to
production. A rename that touches identifiers **is not a text substitution**.

- **Never rename with regex across files.** A regex that turns `nombre` into `name`
  hits `p.nombre` and the CSS class `.nombre` and the Spanish word "nombre" inside a
  sentence a child reads. Real damage seen: "3 roundLabels de 5 segundos", "ajusta la
  dificultad a tu clubClass", "Para su hijo, clubClass Principiantes".
- **A key renamed without its reads is invisible.** `fase:` renamed while every guard
  still read `match.phase` produced no syntax error, no test failure, and no console
  error — it silently disabled the state machine of **seven games**, so taps did nothing
  and none of them could award a point. `nothing.nombre` just prints `undefined`; the
  next `.toLowerCase()` throws and kills the click handler.
- **CSS is the same trap in reverse.** Markup renamed to `family-card` while the rule
  still said `.fam-card` renders the component completely unstyled. Nothing fails.
- **Commit a working state before starting.** Without it there is nothing to revert to.
- Prefer a real codemod over pattern matching, and rename in one direction at a time:
  keys first, then reads, verifying in between.

## Verifying

Static checks pass on all of the above. The only thing that catches it is exercising the
thing.

- `yarn verify` runs two gates: `scripts/check-games.mjs` (contract: activity slug
  matches its folder, rotation present, shared modules loaded, print stylesheet, no
  `alert`, sw.js covers every route, manifest shortcuts point at activities that exist,
  one version number everywhere) and `scripts/check-text.mjs`, which plays each activity
  in jsdom, opens every menu tab, and **fails when `undefined`, `NaN` or
  `[object Object]` reaches the screen**.
- Neither replaces playing it. Open every activity in the browser at ~390px, take the
  **wrong** answer too, and open the printable tab — bugs found only that way include
  "Estrofa NaN", a legend printing "undefined" five times, and an answer visible at 14%
  opacity that made a puzzle winnable without reading the chapter.
- A game that scores 0 points in the playtest is a signal, not a detail: it usually
  means a guard never passes.

## One version number

`adventurers/package.json` `version` is the single source. It must equal `APP_VERSION`
in `public/shared/profile.js` (printed in the page footer, so the version is legible on
a phone with no signal) and `VERSION` in `public/sw.js` (whose value names the caches, so
changing it purges them). `check-games.mjs` fails if the three disagree.

Bump it on every deploy that changes shared CSS/JS or removes an activity — otherwise an
installed phone keeps serving the cached copy, including pages for activities that no
longer exist.

## Points

The Worker is the authority, not the pages. `src/index.js` holds `ACTIVITIES` (every
valid slug; an unknown one is a 400) and `ACTIVITY_CAPS`, the per-activity daily cap by
kind. Activities are deliberately **not** worth the same: the parent chapters give 5
question points and no game points, the vow gives 2. A child may earn each activity's
points once a day and accumulate across all of them.

`AvProfile` in `public/shared/profile.js` enforces the same caps client-side, queues
points in `localStorage` when offline, and rotates questions per child per ISO week
(`AvProfile.pick`) so two brothers sharing one phone don't get the same questions.

## Working agreements

- **Don't deploy ad hoc.** Do the whole job, then one commit, PR, merge; the automatic
  deploy takes it from there.
- **Never run a migration against production without asking**, and never assume the
  hosted deploy command applies them.
- Don't delegate everything to subagents — they're slow and they undo each other's work
  (a deleted game reappeared three times because agents were still running).
- Ask before adding a capability nobody requested. Audio was built, and removed, because
  the question asked was whether it was *possible*.
