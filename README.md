# CF Worker Church Projects

This repository hosts **web apps for the church clubs** (Adventurers, Pathfinders, etc.), published as Cloudflare Workers.

Each club lives in its own subfolder with its own `wrangler.jsonc`, so every club deploys as an independent Worker on its own subdomain. Inside a club's Worker, each activity is a static page listed on the club's index page.

The apps themselves are written in Spanish (their audience is the local congregation); repo documentation is in English.

## Structure

```
cf-worker-church-projects/
├── README.md
└── adventurers/                  # Adventurers Club Worker
    ├── wrangler.jsonc            # Worker config (custom domain, assets, D1)
    ├── package.json              # wrangler + hono, dev/deploy scripts
    ├── yarn.lock
    ├── .nvmrc                    # Node 24 (latest LTS)
    ├── src/
    │   └── index.js              # Worker: JSON API (Hono) for profiles and points
    ├── scripts/
    │   └── check-games.mjs       # Contract check for every activity (runs in CI)
    ├── migrations/               # D1 migrations (applied by yarn dev/deploy)
    │   ├── 0001_create_adventurers_players.sql
    │   ├── 0002_add_interaction_kind.sql
    │   ├── 0003_scope_kind_to_activity.sql
    │   └── 0004_add_player_age.sql
    └── public/                   # Static assets served by the Worker
        ├── index.html            # Home: tabbed activity index
        ├── manifest.webmanifest  # Installable app (PWA)
        ├── sw.js                 # Service worker: offline play
        ├── icons/                # App icons from the official Adventurer emblem
        ├── shared/
        │   ├── profile.js        # Cross-page profile module (window.AvProfile)
        │   └── profile.css       # Profile overlay, player chip, trophy, toasts
        └── <activity>/
            └── index.html        # One self-contained page per activity
```

## Projects

### adventurers

Interactive activities for the Adventurers Club (ages 4–9), served at `aventureros.iglesiajordanibague.org`.

Every activity is one self-contained page that opens on a **📖 Leer** (read) tab with its source, and only then lets the child practice: the game checks what was read, it does not teach from scratch. The home page groups them in four tabs.

**Conexión Bíblica** — the camp exam comes from here: Daniel in Reina-Valera 1995, with chapters 39, 41 and 44 of *Prophets and Kings*.

| Activity | Path | What it teaches that nothing else does |
|----------|------|----------------------------------------|
| La mesa del rey y la mesa de Daniel | `/conexion-biblica-pr39/` | Tell apart, in a burst, what belongs to the king's table and what to Daniel's — no reading, no adult grading |
| La línea de los 10 días | `/conexion-biblica-pr39-prueba10/` | Put the events in order, from the captivity to "ten times better" |
| Los cuatro nombres | `/conexion-biblica-pr39-nombres/` | The Hebrew↔Babylonian name table, so Sadrac and his friends aren't strangers in ch. 41 |
| Colorea la corte de Babilonia | `/conexion-biblica-pr39-colorear/` | Find the named part of the scene and tell an adult why it's there. The only paper-and-crayon exit |
| La estatua del sueño | `/conexion-biblica-pr41-estatua-sueno/` | Match material to body part (Daniel 2:32-33), and why the king made his own statue all of gold |
| Ordena la historia del horno | `/conexion-biblica-pr41-secuencia/` | Sequence by motive, and retell the chain out loud |
| El versículo que no se quema | `/conexion-biblica-pr41-versiculo/` | Isaiah 43:2 word for word, with its reference |
| ¿Qué falta en el foso? | `/conexion-biblica-pr44-diferencias/` | Recall the scene's inventory. The only game a 4-year-old plays alone |
| Reparte las voces | `/conexion-biblica-pr44-quien-lo-dijo/` | Attribute each line and act the scene with its three voices |
| Tres veces al día | `/conexion-biblica-pr44-reloj/` | Keep the prayer habit with a family log — measures consistency, not knowledge |

**Los libros de la Biblia** — for the camporee station where two children sort the Old Testament books, against the clock.

| Activity | Path | What it teaches |
|----------|------|-----------------|
| Los cinco colores | `/biblia-colores/` | Which colour each family gets. Without this the 39 cards get painted wrong |
| Antes o después | `/biblia-orden/` | Which book comes before and which after, and sorting a whole family |
| Organiza la Biblia | `/organiza-la-biblia/` | Sort by family and order against the clock, the way it is scored |

**Los ideales del club** — the whole club learns these, so they carry no class label.

| Activity | Path | What it teaches |
|----------|------|-----------------|
| El Voto | `/ideales-voto/` | "Porque Jesús me ama, siempre haré lo mejor", from memory |
| La Ley | `/ideales-ley/` | The ten points and their order |
| El Himno | `/ideales-himno/` | Both stanzas, verse by verse |

**Para padres** — *Sacerdotes comprometidos*: the reading the camporee bulletin asks of every parent, with a written exam at camp.

| Activity | Path | What it covers |
|----------|------|----------------|
| La limpieza | `/padres-cap17/` | *Conducción del niño* ch. 17, full text with its CN references and a practice quiz |
| Pulcritud, orden y regularidad | `/padres-cap18/` | *Conducción del niño* ch. 18, same shape |

Static pages are served via [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/); requests that don't match an asset (i.e. `/api/*`) fall through to the Worker script. `workers_dev` and `preview_urls` are disabled, so the app is only reachable through the custom domain.

#### Points, caps and classes

Kids earn ⭐ 1 point per correct answer; wrong answers are only logged, they never subtract.

The daily cap is **per activity**, not global: each one has its own 5 `card` + 5 `quiz` points (`DAILY_LIMIT` in `src/index.js`, America/Bogota time), so a child who finishes one activity still has something to earn in the next. In the database `kind` stores `'<activity>:<type>'`, and the activity must be listed in `ACTIVITIES` — an unknown slug is rejected with 400 rather than silently scoring somewhere else.

**Each activity also declares its own cap**, because they are not worth the same: reciting the Pledge is two points, sorting the Bible's families is ten. A page passes `caps` to `AvProfile.init({activity, caps: {card: 2, quiz: 0}})` and the shared module enforces it in `canScore` and in `score` — a correct answer above the cap is not even sent. That enforcement lives in one place on purpose: when each page limited itself, twelve implementations got it wrong twelve times.

Nothing repeats: `AvProfile.pick(bucket, items, n, keyFn)` keeps a bag **per child and per ISO week**, so a question does not come back until the bag runs out. Each age tier has its own bag, and two siblings on the same phone have separate bags.

Every answer is a row in `adventurers_interactions` (delta +1 correct / 0 wrong, with its kind and the Bogota date), which is what the caps count and doubles as an audit trail. Totals live in `adventurers_players`; both tables are in the shared D1 database `church-jordan-projects` (`adventurers_` prefix). The leaderboard opens from the 🏆 button in the header, on any page.

**Classes.** Registration asks the child's age, and the app derives the club class: Principiantes (2–3), Corderitos (4), Aves Madrugadoras (5), Abejitas Industriosas (6), Rayitos de Sol (7), Constructores (8), Manos Ayudadoras (9). The list is a single constant in `profile.js`. The class shows in the player chip, decides which tier of questions a child gets, adjusts difficulty in some activities, and **sorts the home page** so the recommended cards come first — all of them stay visible, it is a suggestion and not a filter.

Profiles are keyed by the child's document number, so one family can't add points to another child's profile:

- The profile UI lives in a shared module (`public/shared/profile.js` + `.css`) used by the home page and every activity: include both files and call `AvProfile.init({chip, activity, caps, autoOpen})`. It renders the player chip (tap to switch player), the trophy that opens the leaderboard, the login overlay, and exposes `get/clubClass/canScore/cap/score/pick/open/onChange`.
- One simple form: typing the document looks up the profile live — if it exists it greets by name; if new, the name and age fields appear to create it. Profiles created before the age column are asked for it on next login.
- The document is **never stored or displayed in plain text** — only a salted SHA-256 hash is kept (plus the last 2 digits as a hint column); the leaderboard shows names and points only.

#### Installable and offline

The site is a PWA: `manifest.webmanifest` plus icons generated from the club's official Adventurer emblem. Android and desktop get a real install button; iPhone shows instructions, since Safari offers no install prompt.

`sw.js` precaches every activity and the shared module. Navigations go to the network first — so a deploy shows up at once while online — and fall back to cache when there is none. `/api/*` is never cached. **Bump `VERSION` in `sw.js` whenever an activity is deleted**, or its cached copy keeps opening a page that no longer exists.

Points survive having no signal: a correct answer given offline is queued in `localStorage` and sent when the connection returns or the app is reopened — not via Background Sync, which iOS does not have. Resending is safe because the cap lives on the server. The chip shows how many are waiting.

API (Hono, in `src/index.js`):

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/api/leaderboard` | — | Top 20 `{name, points}` |
| POST | `/api/register` | `{name, doc, age}` | Create profile (409 if the document already exists) |
| POST | `/api/login` | `{doc}` | Fetch profile by document |
| POST | `/api/edad` | `{doc, age}` | Fill in the age of a profile created before the age column |
| POST | `/api/score` | `{doc, correct, kind, activity}` | `kind`: `card` \| `quiz`. `activity` must be in `ACTIVITIES` (400 otherwise; omitting it falls back to `pr39` for cached old pages). `correct: true` adds 1 point (429 past that activity's daily cap); `correct: false` only logs the answer. 401 if the document doesn't match |

Responses carry `{player: {id, name, points, age}, today: {<activity>: {card, quiz}}, limit: {card, quiz}}`.

## Deployment

### Automatic (Workers Builds — recommended)

Connect this repository to Cloudflare in the dashboard (Workers & Pages → Create → Connect to Git):

1. Set the project subfolder (e.g. `adventurers`) as the build **root directory**.
2. Set the **deploy command** to `yarn deploy` — it applies pending D1 migrations and then runs `wrangler deploy`, so a fresh deploy is fully functional with no manual steps.
3. The custom domain is declared in `wrangler.jsonc` (`routes` with `custom_domain: true`); Cloudflare creates the DNS record on deploy. The zone and the D1 database must exist in the same Cloudflare account as the Worker.

### Manual

Requires Node 24 (latest LTS — see `.nvmrc`) and Yarn.

```bash
cd adventurers
nvm use          # switch to Node 24
yarn install
yarn dev         # applies D1 migrations locally + local dev server
yarn deploy      # applies D1 migrations remotely + deploy to Cloudflare
yarn migrate --local|--remote   # run migrations on their own
yarn verify      # contract check for every activity (also runs in CI)
```

## Adding a new activity to a club

1. Create a folder under the club's `public/` (e.g. `public/my-activity/`) with a self-contained `index.html`. Copy the shape of an existing one: a **📖 Leer** tab with the source, a practice tab, a printable section with `@media print`, and a parents' block.
2. Register the slug in `ACTIVITIES` (`src/index.js`) and its path in `RUTAS` (`public/sw.js`), or it won't score and won't work offline.
3. Add a card linking to it on the club's `public/index.html`, with `data-from`/`data-to` for the class range it suits.
4. Declare what it is worth: `AvProfile.init({activity, caps: {card: N, quiz: M}})`. Do not invent filler rounds to reach ten.
5. Run `yarn verify`. It fails on dead links, missing ids, unregistered slugs, activities left out of the service worker, and content that would repeat because it doesn't use `AvProfile.pick`.

### Code and content conventions

Identifiers, CSS classes and commit messages are in **English**; comments and everything the child or parent reads are in **Spanish**. Every biblical fact must be traceable to the chapter or passage the activity cites — if it comes from elsewhere, say so on the page.

## Adding a new club

1. Create a new subfolder named after the club.
2. Add its own `wrangler.jsonc` (unique `name`, its own subdomain route) and a `public/` directory.
3. Add its tables as D1 migrations using a club prefix (the D1 database `church-jordan-projects` is shared).
4. Document it in this README.
