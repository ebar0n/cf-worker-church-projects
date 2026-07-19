import { Hono } from "hono";

// El documento nunca se guarda en claro: solo su hash con esta sal.
const SALT = "aventureros-jordan-2026";

// Máximo de puntos que un niño puede sumar por día (hora de Colombia).
const DAILY_LIMIT = 10;

async function docHash(doc) {
  const data = new TextEncoder().encode(`${SALT}:${doc}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const normalizeDoc = (raw) => String(raw ?? "").replace(/\D/g, "");
const normalizeName = (raw) => String(raw ?? "").trim().replace(/\s+/g, " ");
const todayInBogota = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());

// Puntos sumados hoy (solo interacciones positivas cuentan para el tope).
async function todayCount(db, playerId) {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM adventurers_interactions WHERE player_id = ? AND day = ? AND delta > 0"
    )
    .bind(playerId, todayInBogota())
    .first();
  return row?.n ?? 0;
}

async function toProfile(db, row) {
  return {
    player: { id: row.id, name: row.name, points: row.points },
    today: await todayCount(db, row.id),
    limit: DAILY_LIMIT,
  };
}

const app = new Hono();

app.use("/api/*", async (c, next) => {
  await next();
  c.header("cache-control", "no-store");
});

app.get("/api/leaderboard", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT name, points FROM adventurers_players ORDER BY points DESC, updated_at ASC LIMIT 20"
  ).all();
  return c.json({ players: results });
});

app.post("/api/register", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const name = normalizeName(body.name);
  const doc = normalizeDoc(body.doc);
  if (name.length < 2 || name.length > 40) {
    return c.json({ error: "Escribe el nombre del niño o la niña (2 a 40 letras)." }, 400);
  }
  if (doc.length < 4 || doc.length > 15) {
    return c.json({ error: "El documento debe tener entre 4 y 15 números." }, 400);
  }
  const hash = await docHash(doc);
  const existing = await c.env.DB.prepare("SELECT name FROM adventurers_players WHERE doc_hash = ?")
    .bind(hash)
    .first();
  if (existing) {
    return c.json({ error: `Ese documento ya está registrado a nombre de ${existing.name}.` }, 409);
  }
  const row = await c.env.DB.prepare(
    "INSERT INTO adventurers_players (name, doc_hash, doc_hint) VALUES (?, ?, ?) RETURNING id, name, points"
  )
    .bind(name, hash, doc.slice(-2))
    .first();
  return c.json(await toProfile(c.env.DB, row), 201);
});

app.post("/api/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const doc = normalizeDoc(body.doc);
  if (!doc) return c.json({ error: "Escribe el número de documento." }, 400);
  const row = await c.env.DB.prepare(
    "SELECT id, name, points FROM adventurers_players WHERE doc_hash = ?"
  )
    .bind(await docHash(doc))
    .first();
  if (!row) return c.json({ error: "not_found" }, 404);
  return c.json(await toProfile(c.env.DB, row));
});

// Cada respuesta queda registrada como una interacción (+1 o -1, con el día
// en hora de Colombia). Correcta: +1 punto hasta DAILY_LIMIT por día.
// Incorrecta: -1 punto (nunca por debajo de 0), no consume intentos del día.
// El documento valida que el perfil sea propio.
app.post("/api/score", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const doc = normalizeDoc(body.doc);
  if (!doc) return c.json({ error: "Falta el documento." }, 400);
  const hash = await docHash(doc);
  const today = todayInBogota();

  if (body.correct === false) {
    const row = await c.env.DB.prepare(
      `UPDATE adventurers_players SET
         points = MAX(points - 1, 0),
         updated_at = datetime('now')
       WHERE doc_hash = ?
       RETURNING id, name, points`
    )
      .bind(hash)
      .first();
    if (!row) return c.json({ error: "El documento no coincide con ningún perfil." }, 401);
    await c.env.DB.prepare(
      "INSERT INTO adventurers_interactions (player_id, delta, day) VALUES (?, -1, ?)"
    )
      .bind(row.id, today)
      .run();
    return c.json(await toProfile(c.env.DB, row));
  }

  const row = await c.env.DB.prepare(
    `UPDATE adventurers_players SET
       points = points + 1,
       updated_at = datetime('now')
     WHERE doc_hash = ?1
       AND (SELECT COUNT(*) FROM adventurers_interactions i
              WHERE i.player_id = adventurers_players.id
                AND i.day = ?2 AND i.delta > 0) < ${DAILY_LIMIT}
     RETURNING id, name, points`
  )
    .bind(hash, today)
    .first();
  if (row) {
    await c.env.DB.prepare(
      "INSERT INTO adventurers_interactions (player_id, delta, day) VALUES (?, 1, ?)"
    )
      .bind(row.id, today)
      .run();
    return c.json(await toProfile(c.env.DB, row));
  }
  const exists = await c.env.DB.prepare("SELECT id FROM adventurers_players WHERE doc_hash = ?")
    .bind(hash)
    .first();
  if (!exists) return c.json({ error: "El documento no coincide con ningún perfil." }, 401);
  return c.json(
    { error: `🌙 ¡Ya sumaste tus ${DAILY_LIMIT} puntos de hoy! Vuelve mañana.`, limit: DAILY_LIMIT },
    429
  );
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((err, c) => {
  console.error(err);
  const hint = /no such table|no such column/i.test(String(err))
    ? " Falta aplicar las migraciones de la base de datos (yarn migrate --local o --remote)."
    : "";
  return c.json({ error: `Error interno.${hint}` }, 500);
});

export default app;
