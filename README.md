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
    │   └── index.js              # Worker: JSON API (Hono) for the points board
    ├── migrations/               # D1 migrations (applied by yarn dev/deploy)
    │   └── 0001_create_adventurers_players.sql
    └── public/                   # Static assets served by the Worker
        ├── index.html            # Activity index (card grid) + leaderboard
        ├── shared/
        │   ├── profile.js        # Cross-page profile module (window.AvProfile)
        │   └── profile.css       # Styles for the profile overlay + player chip
        └── conexion-biblica-pr39/
            └── index.html        # Activity: one page per activity
```

## Projects

### adventurers

Interactive activities for the Adventurers Club (ages 4–9), served at `aventureros.iglesiajordanibague.org`.

| Activity | Path | Description |
|----------|------|-------------|
| La mesa del rey vs. la mesa de Daniel | `/conexion-biblica-pr39/` | Bible Connection game for *Prophets and Kings* ch. 39 ("En la corte de Babilonia"): a food card game with printable cards and age-tiered quiz questions. |
| El horno de fuego (ch. 41) | — | Coming soon (placeholder card on the index). |
| En el foso de los leones (ch. 44) | — | Coming soon (placeholder card on the index). |

Static pages are served via [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/); requests that don't match an asset (i.e. `/api/*`) fall through to the Worker script. `workers_dev` and `preview_urls` are disabled, so the app is only reachable through the custom domain.

#### Points challenge and leaderboard

The game is played in **matches** (partidas): 5 surprise food cards followed by 5 quiz questions. Kids earn ⭐ 1 point per correct answer and lose 1 per wrong answer (never below 0). Earning is capped **per day and per type** — 5 card points + 5 quiz points (`DAILY_LIMIT` in `src/index.js`, America/Bogota time) — so one match a day scores and any extra matches automatically become practice (no judge buttons, just "next"). Every answer is stored as a row in `adventurers_interactions` (+1/-1 with its kind and the Bogota date), which is what the caps count — and doubles as an audit/stats trail. Totals live in `adventurers_players`; both tables are in the shared D1 database `church-jordan-projects` (`adventurers_` prefix). The club index shows the leaderboard (top 20).

Profiles are keyed by the child's document number, so one family can't add points to another child's profile:

- The profile UI lives in a shared module (`public/shared/profile.js` + `.css`) used by the index and every activity: include both files and call `AvProfile.init({chip, autoOpen})`. It renders the player chip (tap to switch player), the login overlay, and exposes `get/canScore/score/open/onChange`.
- One simple form: typing the document looks up the profile live — if it exists it greets by name (no typing the name again); if new, the name field appears to create it. Duplicates are rejected with the registered name.
- The document is **never stored or displayed in plain text** — only a salted SHA-256 hash is kept (plus the last 2 digits as a hint column); the leaderboard shows names and points only.

API (Hono, in `src/index.js`):

| Method | Path | Body | Description |
|--------|------|------|-------------|
| GET | `/api/leaderboard` | — | Top 20 `{name, points}` |
| POST | `/api/register` | `{name, doc}` | Create profile (409 if the document already exists) |
| POST | `/api/login` | `{doc}` | Fetch profile by document |
| POST | `/api/score` | `{doc, correct, kind}` | `kind`: `card` \| `quiz`. `correct: true` adds 1 point (429 past that kind's daily cap); `correct: false` subtracts 1 (floor 0). 401 if the document doesn't match |

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
```

## Adding a new activity to a club

1. Create a new folder under the club's `public/` directory (e.g. `public/my-activity/`) with an `index.html`.
2. Add a card linking to it on the club's `public/index.html`.

## Adding a new club

1. Create a new subfolder named after the club.
2. Add its own `wrangler.jsonc` (unique `name`, its own subdomain route) and a `public/` directory.
3. Add its tables as D1 migrations using a club prefix (the D1 database `church-jordan-projects` is shared).
4. Document it in this README.
