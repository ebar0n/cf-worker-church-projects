import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = join(root, "public");

const activities = [
  ...readFileSync(join(root, "src/index.js"), "utf8")
    .match(/const ACTIVITIES = \[([\s\S]*?)\];/)[1]
    .matchAll(/"([^"]+)"/g),
].map((m) => m[1]);

// Una actividad es cualquier carpeta con un index.html que arranque AvProfile.
const dirs = readdirSync(publicDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((d) => {
    const f = join(publicDir, d, "index.html");
    return existsSync(f) && readFileSync(f, "utf8").includes("AvProfile.init(");
  });
const failures = [];
const warnings = [];

const fail = (dir, msg) => failures.push(`${dir}: ${msg}`);
const warn = (dir, msg) => warnings.push(`${dir}: ${msg}`);

// Los <script> inline se validan por separado: el primero es el módulo compartido.
function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

function checkBalance(dir, html) {
  const voids = new Set(["area","base","br","col","embed","hr","img","input","link","meta","param","source","track","wbr","path","circle","rect","line","polygon","polyline","ellipse","use","stop","g"]);
  const stack = [];
  const body = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  for (const m of body.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g)) {
    const [, closing, tag, attrs] = m;
    const name = tag.toLowerCase();
    if (attrs.trimEnd().endsWith("/") || voids.has(name)) continue;
    if (closing) {
      const idx = stack.lastIndexOf(name);
      if (idx === -1) return fail(dir, `cierra <${name}> sin abrir`);
      if (idx !== stack.length - 1) return fail(dir, `<${stack[stack.length - 1]}> quedó sin cerrar antes de </${name}>`);
      stack.pop();
    } else {
      stack.push(name);
    }
  }
  if (stack.length) fail(dir, `etiquetas sin cerrar: ${stack.join(" > ")}`);
}

for (const dir of dirs.sort()) {
  const file = join(publicDir, dir, "index.html");
  if (!existsSync(file)) {
    fail(dir, "no tiene index.html");
    continue;
  }
  const html = readFileSync(file, "utf8");
  const slug = dir.replace("conexion-biblica-", "");

  if (!activities.includes(slug)) fail(dir, `el slug '${slug}' no está en ACTIVITIES de src/index.js`);

  const initMatch = html.match(/AvProfile\.init\(\{([^}]*)\}/);
  if (!initMatch) fail(dir, "no llama a AvProfile.init");
  else if (!/activity:\s*(ACTIVITY|['"`])/.test(initMatch[1])) fail(dir, "AvProfile.init sin activity");

  const activityConst = html.match(/const ACTIVITY\s*=\s*['"]([^'"]+)['"]/);
  if (!activityConst) fail(dir, "falta const ACTIVITY");
  else if (activityConst[1] !== slug) fail(dir, `ACTIVITY es '${activityConst[1]}' pero la carpeta dice '${slug}'`);

  // Una actividad cuyo contenido es un texto único no tiene nada que rotar, pero
  // tiene que decirlo con "sin-rotacion:" y su razón, no callarse.
  const noRotation = html.match(/sin-rotacion:\s*(.+)/);
  if (!html.includes("AvProfile.pick(") && !noRotation) {
    fail(dir, "no usa AvProfile.pick y no declara 'sin-rotacion: <razón>': el contenido se repetiría");
  }
  if (!html.includes('src="/shared/profile.js"')) fail(dir, "no carga /shared/profile.js");
  if (!html.includes('href="/shared/profile.css"')) fail(dir, "no carga /shared/profile.css");

  for (const tag of ['rel="manifest"', 'rel="apple-touch-icon"', "apple-mobile-web-app-title"]) {
    if (!html.includes(tag)) fail(dir, `falta ${tag} en el <head>: no se instala como app`);
  }

  for (const id of ["playerChip", "changePlayerBtn"]) {
    if (!html.includes(`id="${id}"`)) fail(dir, `falta el elemento #${id}`);
  }
  // La sección donde se practice puede llamarse como le calce a la actividad
  // ("juego" en los de niños, "examen" en el de padres): lo que no puede faltar
  // es que exista alguna, además de leer/material/padres.
  const sections = [...html.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1]);
  const practice = sections.filter((x) => !["leer", "material", "padres"].includes(x));
  if (!practice.length) fail(dir, "no tiene ninguna sección donde practicar");
  if (!/<section id="padres"/.test(html)) fail(dir, "falta la sección para padres");
  if (!/@media print/.test(html)) fail(dir, "no tiene estilos de impresión");

  const ogUrl = html.match(/property="og:url" content="([^"]+)"/);
  if (!ogUrl) fail(dir, "falta og:url");
  else if (!ogUrl[1].endsWith(`/${dir}/`)) fail(dir, `og:url apunta a ${ogUrl[1]}`);

  for (const banned of ["alert(", "confirm(", "prompt("]) {
    if (new RegExp(`(^|[^.\\w])${banned.replace("(", "\\(")}`, "m").test(html)) {
      fail(dir, `usa ${banned}: bloquea la página en el celular`);
    }
  }
  if (/\son(drag|dragstart|dragover|drop)=/.test(html) || /addEventListener\(\s*['"]drag/.test(html)) {
    fail(dir, "usa drag & drop, prohibido en móvil");
  }

  // Solo se restringen los recursos que la página CARGA. Un <a href> a la fuente
  // de un texto es deseable: el club tiene que poder ir a leerla.
  const loadedFromNet = html
    .replace(/<a\b[^>]*>/g, "")
    .matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g);
  for (const m of loadedFromNet) {
    const host = new URL(m[1]).host;
    if (!["fonts.googleapis.com", "fonts.gstatic.com", "aventureros.iglesiajordanibague.org"].includes(host)) {
      fail(dir, `recurso externo no permitido: ${host}`);
    }
  }

  const scripts = inlineScripts(html);
  if (!scripts.length) fail(dir, "no tiene script inline");
  scripts.forEach((code, i) => {
    try {
      new vm.Script(code, { filename: `${dir}#script${i}` });
    } catch (err) {
      fail(dir, `error de sintaxis en el script ${i}: ${err.message}`);
    }
  });
  const code = scripts.join("\n");

  // Los ids referenciados desde el JS tienen que existir en el HTML.
  const declared = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of code.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!declared.has(m[1])) fail(dir, `getElementById('${m[1]}') pero ese id no existe en el HTML`);
  }

  for (const kind of ["card", "quiz"]) {
    if (!new RegExp(`['"\`]${kind}['"\`]`).test(code)) warn(dir, `no aparece el kind '${kind}'`);
  }
  if (!/canScore\(/.test(code)) fail(dir, "no consulta canScore: podría pasarse del tope diario");
  if (!/AvProfile\.score\(/.test(code)) fail(dir, "nunca llama a AvProfile.score");

  checkBalance(dir, html);
}

const slugs = dirs.map((d) => d.replace("conexion-biblica-", ""));
for (const a of activities.filter((a) => !slugs.includes(a))) {
  failures.push(`ACTIVITIES: '${a}' está registrado pero no existe su carpeta en public/`);
}

// El service worker precachea los juegos por nombre: si uno falta, no funciona offline.
const sw = readFileSync(join(publicDir, "sw.js"), "utf8");
const swSlugs = [
  ...(sw.match(/const GAMES = \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/"([^"]+)"/g),
].map((m) => m[1]);
const swDirs = [
  ...(sw.match(/const RUTAS = \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/"\/([^"]+)\/"/g),
].map((m) => m[1]);
for (const dir of dirs) {
  if (!swDirs.includes(dir)) failures.push(`sw.js: '${dir}' no está en RUTAS, no se cacheará para offline`);
}
for (const d of swDirs) {
  if (!dirs.includes(d)) failures.push(`sw.js: RUTAS lista '${d}', que no existe`);
}

// Si la versión del pie se desfasa de package.json deja de servir para saber
// si el teléfono se actualizó, y el desfase no se nota mirando la app.
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const sharedJs = readFileSync(join(publicDir, "shared/profile.js"), "utf8");
const shownVersion = (sharedJs.match(/const APP_VERSION = '([^']+)'/) || [])[1];
if (shownVersion !== pkg.version) {
  failures.push(`profile.js muestra la versión ${shownVersion} y package.json dice ${pkg.version}`);
}
const swVersion = (sw.match(/const VERSION = "([^"]+)"/) || [])[1];
if (swVersion !== pkg.version) {
  failures.push(`sw.js cachea como '${swVersion}' y package.json dice ${pkg.version}: una sola versión para todo`);
}

const manifest = JSON.parse(readFileSync(join(publicDir, "manifest.webmanifest"), "utf8"));
for (const key of ["name", "short_name", "start_url", "display", "theme_color", "icons"]) {
  if (!manifest[key]) failures.push(`manifest.webmanifest: falta '${key}'`);
}
// Un acceso rápido a una actividad borrada no falla en ningún lado: solo
// aparece muerto al mantener pulsado el icono de la app instalada.
for (const sc of manifest.shortcuts || []) {
  const dir = String(sc.url || "").replace(/^\/|\/$/g, "");
  if (!dir || !existsSync(join(publicDir, dir, "index.html"))) {
    failures.push(`manifest.webmanifest: el acceso rápido '${sc.short_name || sc.name}' apunta a ${sc.url}, que no existe`);
  }
}

if (!(manifest.icons || []).some((i) => i.purpose === "maskable")) {
  failures.push("manifest.webmanifest: falta un icono maskable (Android lo recorta en círculo)");
}
for (const icon of manifest.icons || []) {
  if (!existsSync(join(publicDir, icon.src.replace(/^\//, "")))) {
    failures.push(`manifest.webmanifest: el icono ${icon.src} no existe`);
  }
}

const indexHtml = readFileSync(join(publicDir, "index.html"), "utf8");
for (const dir of dirs) {
  if (!indexHtml.includes(`href="/${dir}/"`)) failures.push(`index.html: no enlaza ${dir}`);
}
// Y al revés: una tarjeta que apunte a una carpeta borrada es un enlace muerto.
for (const m of indexHtml.matchAll(/class="activity-card" href="\/([^"]+)\/"/g)) {
  if (!dirs.includes(m[1])) failures.push(`index.html: enlace muerto a /${m[1]}/`);
}

console.log(`Revisados ${dirs.length} juegos (${activities.length} actividades registradas).`);
for (const w of warnings) console.log(`  aviso  ${w}`);
if (failures.length) {
  console.error(`\n${failures.length} problema(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("Todo en orden.");
