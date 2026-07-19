import { Hono } from "hono";

// El documento nunca se guarda en claro: solo su hash con esta sal.
const SALT = "aventureros-jordan-2026";

async function docHash(doc) {
  const data = new TextEncoder().encode(`${SALT}:${doc}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const normalizeDoc = (raw) => String(raw ?? "").replace(/\D/g, "");
const normalizeName = (raw) => String(raw ?? "").trim().replace(/\s+/g, " ");

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
    return c.json(
      { error: `Ese documento ya está registrado a nombre de ${existing.name}. Usa "Ya tengo perfil".` },
      409
    );
  }
  const player = await c.env.DB.prepare(
    "INSERT INTO adventurers_players (name, doc_hash, doc_hint) VALUES (?, ?, ?) RETURNING id, name, points"
  )
    .bind(name, hash, doc.slice(-2))
    .first();
  return c.json({ player }, 201);
});

app.post("/api/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const doc = normalizeDoc(body.doc);
  if (!doc) return c.json({ error: "Escribe el número de documento." }, 400);
  const player = await c.env.DB.prepare(
    "SELECT id, name, points FROM adventurers_players WHERE doc_hash = ?"
  )
    .bind(await docHash(doc))
    .first();
  if (!player) {
    return c.json({ error: "No encontramos un perfil con ese documento. Crea uno con «Soy nuevo»." }, 404);
  }
  return c.json({ player });
});

// Suma exactamente 1 punto; el documento valida que el perfil sea propio.
app.post("/api/score", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const doc = normalizeDoc(body.doc);
  if (!doc) return c.json({ error: "Falta el documento." }, 400);
  const player = await c.env.DB.prepare(
    "UPDATE adventurers_players SET points = points + 1, updated_at = datetime('now') WHERE doc_hash = ? RETURNING id, name, points"
  )
    .bind(await docHash(doc))
    .first();
  if (!player) return c.json({ error: "El documento no coincide con ningún perfil." }, 401);
  return c.json({ player });
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default app;
