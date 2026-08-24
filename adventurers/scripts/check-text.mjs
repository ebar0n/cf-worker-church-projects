// Juega cada juego a golpe de clics en un DOM real y reporta errores de JS,
// llamadas a puntos por tipo, y si la partida llega a cerrar.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

const ROOT = new URL("..", import.meta.url).pathname;
const PUB = join(ROOT, "public");
const CLICKS = Number(process.argv[3] || 400);
const only = process.argv[2];

const dirs = readdirSync(PUB)
  .filter((d) => {
    try { return readFileSync(join(PUB, d, "index.html"), "utf8").includes("AvProfile.init("); }
    catch { return false; }
  })
  .filter((d) => !only || d.includes(only))
  .sort();

let bad = 0;

for (const dir of dirs) {
  const slug = dir.replace("conexion-biblica-", "");
  let html = readFileSync(join(PUB, dir, "index.html"), "utf8");
  // El módulo compartido se reemplaza por un doble: no hay red en la prueba.
  html = html.replace(/<script src="\/shared\/profile\.js"><\/script>/, "");

  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(String(e.message || e).slice(0, 300)));
  vc.on("error", (m) => errors.push(String(m).slice(0, 300)));

  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
    virtualConsole: vc,
    url: "https://aventureros.iglesiajordanibague.org/" + dir + "/",
  });
  const { window } = dom;

  const scores = { card: 0, quiz: 0 };
  const wrong = { card: 0, quiz: 0 };
  const picks = [];
  let caps = null;
  window.AvProfile = {
    init: (o) => { if (o && o.caps) caps = o.caps; },
    get: () => ({ id: 1, name: "Sara", points: 3 }),
    today: () => ({ card: 0, quiz: 0 }),
    // El doble respeta el tope: si un juego lo ignora, se pasa de 5 y se ve.
    canScore: (kind) => {
      const tope = (k) => Math.min(5, caps && Number.isFinite(caps[k]) ? caps[k] : 5);
      if (kind) return scores[kind === "quiz" ? "quiz" : "card"] < tope(kind === "quiz" ? "quiz" : "card");
      return scores.card < tope("card") || scores.quiz < tope("quiz");
    },
    score: (correct, kind) => {
      const k = kind === "quiz" ? "quiz" : "card";
      const tope = Math.min(5, caps && Number.isFinite(caps[k]) ? caps[k] : 5);
      if (correct && scores[k] >= tope) return Promise.resolve();   // el módulo real lo ignora
      if (correct) scores[k]++;
      else wrong[k]++;
      return Promise.resolve();
    },
    pick: (bucket, items, n) => {
      picks.push({ bucket, asked: n, got: Math.min(n, items.length), pool: items.length });
      return items.slice(0, n);
    },
    onChange: () => {},
    open: () => {},
    // El doble juega como un niño de 7 años: Rayitos de Sol.
    clubClass: () => "Rayitos de Sol",
    clubClasses: () => ["Principiantes","Corderitos","Aves Madrugadoras","Abejitas Industriosas","Rayitos de Sol","Constructores","Manos Ayudadoras"],
    pending: () => 0,
    toast: () => {},
  };
  window.alert = (m) => errors.push("alert(): " + m);
  // Los juegos avanzan de ronda con setTimeout. Sin acelerarlos la prueba se
  // queda en la primera tarjeta y parece que el juego se trabó, cuando en el
  // navegador sí avanza. Se acortan los retardos, no se eliminan: el orden de
  // los temporizadores sigue siendo el que el juego espera.
  const setTimeoutReal = window.setTimeout;
  window.setTimeout = (fn, ms, ...rest) => setTimeoutReal(fn, Math.min(Number(ms) || 0, 1), ...rest);

  // jsdom no implementa el scroll; sin esto cada llamada ensucia el reporte.
  window.scrollTo = () => {};
  window.scrollBy = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  if (typeof window.matchMedia !== "function") {
    // Se prueba la ruta sin animación: es la accesible y la que corre sin temporizadores.
    window.matchMedia = (q) => ({ matches: /prefers-reduced-motion/.test(q), media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
  }

  // Los scripts inline se ejecutan a mano para poder inyectar el doble antes.
  const scripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  try {
    for (const code of scripts) window.eval(code);
  } catch (err) {
    errors.push("al cargar: " + String(err.message).slice(0, 200));
  }

  const visible = (el) => {
    if (el.hidden || el.disabled) return false;
    for (let n = el; n && n !== window.document.body; n = n.parentElement) {
      if (n.hidden) return false;
      const st = n.getAttribute("style") || "";
      if (/display:\s*none/.test(st)) return false;
      if (n.tagName === "SECTION" && !n.classList.contains("active")) return false;
    }
    return true;
  };

  let clicks = 0;
  const seen = new Set();
  await new Promise((r) => setImmediate(r));

  const ROTO = /undefined|\bNaN\b|\[object Object\]/;
  const roto = new Map();
  const revisarTexto = (etapa) => {
    for (const el of window.document.querySelectorAll("body *")) {
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE" || el.tagName === "TEMPLATE") continue;
      const propio = [...el.childNodes]
        .filter((n) => n.nodeType === 3).map((n) => n.textContent).join(" ").trim();
      if (!propio || !ROTO.test(propio)) continue;
      const clave = (el.parentElement ? el.parentElement.textContent : propio).replace(/\s+/g, " ").slice(0, 110);
      if (!roto.has(clave)) roto.set(clave, etapa + " <" + el.tagName.toLowerCase() + (el.id?"#"+el.id:"") + (el.className?"."+String(el.className).split(" ")[0]:"") + ">");
    }
  };

  // Cada pestaña del menú, para que el texto estático también se revise.
  for (const mi of window.document.querySelectorAll(".menu-item[data-tab]")) {
    try { mi.click(); await new Promise((r) => setImmediate(r)); revisarTexto("pestaña " + mi.dataset.tab); } catch {}
  }
  const primera = window.document.querySelector(".menu-item[data-tab]");
  if (primera) { try { primera.click(); } catch {} }
  await new Promise((r) => setImmediate(r));
  for (let i = 0; i < CLICKS; i++) {
    const cands = [...window.document.querySelectorAll(
      "button, [role=button], #juego svg path, #juego svg circle, #juego svg rect, #juego svg polygon, #juego [data-cell], #juego [data-zone]"
    )].filter(
      (b) => visible(b) && !b.closest(".menu-panel") && b.id !== "changePlayerBtn" && !b.classList.contains("menu-btn")
    );
    if (!cands.length) break;
    const botones = cands.filter((c) => c.tagName === "BUTTON");
    const orden = botones.length ? [...botones, ...cands.filter((c) => c.tagName !== "BUTTON")] : cands;
    // Determinista: recorre en orden, pero rota para no quedarse pegado en el mismo botón.
    const el = i % 3 === 0 && botones.length ? botones[i % botones.length] : orden[i % orden.length];
    const cls = String(el.getAttribute("class") || "").split(" ")[0];
    if (process.env.DBG) console.log("   clic:", el.tagName, el.id || String(el.getAttribute("class")||"").slice(0,20));
    seen.add(el.id || cls || el.tagName.toLowerCase() + ":" + el.textContent.trim().slice(0, 10));
    try {
      if (typeof el.click === "function") el.click();
      else el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
      clicks++;
      await new Promise((r) => window.setTimeout(r, 0));
      await new Promise((r) => setImmediate(r));
    } catch (err) {
      errors.push(`click en '${(el.id || el.textContent || "").trim().slice(0, 30)}': ${String(err.message).slice(0, 160)}`);
    }
    revisarTexto("jugando");
  }

  const shortPicks = picks.filter((p) => p.got < p.asked);
  const declarado = (k) => (window.__topes && Number.isFinite(window.__topes[k]) ? window.__topes[k] : 5);
  const overCap = scores.card > 5 || scores.quiz > 5;
  const ok = !errors.length && clicks > 10 && !overCap && !shortPicks.length && !roto.size;
  if (!ok) bad++;

  console.log(
    `${ok ? "✓" : "✗"} ${slug.padEnd(20)} clics=${String(clicks).padStart(3)} ` +
      `+card=${scores.card} +quiz=${scores.quiz} fallos=${wrong.card + wrong.quiz} ` +
      `picks=${picks.length} controles=${seen.size}` + (roto.size ? ` TEXTO_ROTO=${roto.size}` : "")
  );
  for (const [txt, etapa] of [...roto].slice(0, 6)) console.log(`    ✗ ${etapa}: "${txt}"`);
  if (overCap) console.log(`    ⚠ pasó el tope: card=${scores.card} quiz=${scores.quiz}`);
  for (const p of shortPicks.slice(0, 3)) {
    console.log(`    ⚠ bolsa corta: ${p.bucket} pidió ${p.asked} y solo hay ${p.pool}`);
  }
  for (const e of [...new Set(errors)].slice(0, 4)) console.log(`    ✗ ${e}`);
  dom.window.close();
}

console.log(bad ? `\n${bad} juego(s) con problemas.` : "\nTodos jugables.");
process.exit(bad ? 1 : 0);
