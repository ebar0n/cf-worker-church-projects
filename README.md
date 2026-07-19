# CF Worker Church Projects

This repository hosts **web apps for the church clubs** (Adventurers, Pathfinders, etc.), published as Cloudflare Workers.

Each club lives in its own subfolder with its own `wrangler.jsonc`, so every club deploys as an independent Worker on its own subdomain. Inside a club's Worker, each activity is a static page listed on the club's index page.

The apps themselves are written in Spanish (their audience is the local congregation); repo documentation is in English.

## Structure

```
cf-worker-church-projects/
├── README.md
└── aventureros/                  # Adventurers Club Worker
    ├── wrangler.jsonc            # Worker config (name, custom domain, assets)
    ├── package.json              # Pins wrangler + dev/deploy scripts
    ├── yarn.lock
    ├── .nvmrc                    # Node 24 (latest LTS)
    └── public/                   # Static assets served by the Worker
        ├── index.html            # Activity index (card grid)
        └── conexion-biblica-pr39/
            └── index.html        # Activity: one page per activity
```

## Projects

### aventureros

Interactive activities for the Adventurers Club (ages 4–9), served at `aventureros.iglesiajordanibague.org`.

| Activity | Path | Description |
|----------|------|-------------|
| La mesa del rey vs. la mesa de Daniel | `/conexion-biblica-pr39/` | Bible Connection game for *Prophets and Kings* ch. 39 ("En la corte de Babilonia"): a food card game with printable cards and age-tiered quiz questions. |
| El horno de fuego (ch. 41) | — | Coming soon (placeholder card on the index). |
| En el foso de los leones (ch. 44) | — | Coming soon (placeholder card on the index). |

The Worker serves the `public/` directory via [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) — no Worker script is needed for static pages. `workers_dev` and `preview_urls` are disabled, so the app is only reachable through the custom domain.

## Deployment

### Automatic (Workers Builds — recommended)

Connect this repository to Cloudflare in the dashboard (Workers & Pages → Create → Connect to Git):

1. Set the project subfolder (e.g. `aventureros`) as the build **root directory**.
2. Cloudflare picks up that folder's `wrangler.jsonc` and deploys the Worker on every push.
3. The custom domain is declared in `wrangler.jsonc` (`routes` with `custom_domain: true`); Cloudflare creates the DNS record on deploy. The zone must exist in the same Cloudflare account as the Worker.

### Manual

Requires Node 24 (latest LTS — see `.nvmrc`) and Yarn.

```bash
cd aventureros
nvm use          # switch to Node 24
yarn install
yarn dev         # local dev server
yarn deploy      # deploy to Cloudflare
```

## Adding a new activity to a club

1. Create a new folder under the club's `public/` directory (e.g. `public/my-activity/`) with an `index.html`.
2. Add a card linking to it on the club's `public/index.html`.

## Adding a new club

1. Create a new subfolder named after the club.
2. Add its own `wrangler.jsonc` (unique `name`, its own subdomain route) and a `public/` directory.
3. Document it in this README.
