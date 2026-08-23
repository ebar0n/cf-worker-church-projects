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

const dirs = readdirSync(publicDir).filter((d) => d.startsWith("conexion-biblica-"));
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

  if (!html.includes("AvProfile.pick(")) fail(dir, "no usa AvProfile.pick: el contenido se repetiría");
  if (!html.includes('src="/shared/profile.js"')) fail(dir, "no carga /shared/profile.js");
  if (!html.includes('href="/shared/profile.css"')) fail(dir, "no carga /shared/profile.css");

  for (const id of ["playerChip", "changePlayerBtn"]) {
    if (!html.includes(`id="${id}"`)) fail(dir, `falta el elemento #${id}`);
  }
  if (!/<section id="juego"/.test(html)) fail(dir, "falta <section id=\"juego\">");
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

  for (const m of html.matchAll(/(?:src|href)="(https?:\/\/[^"]+)"/g)) {
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

const missing = activities.filter((a) => !dirs.includes(`conexion-biblica-${a}`));
for (const a of missing) failures.push(`ACTIVITIES: '${a}' está registrado pero no existe public/conexion-biblica-${a}/`);

const indexHtml = readFileSync(join(publicDir, "index.html"), "utf8");
for (const dir of dirs) {
  if (!indexHtml.includes(`href="/${dir}/"`)) failures.push(`index.html: no enlaza ${dir}`);
}

console.log(`Revisados ${dirs.length} juegos (${activities.length} actividades registradas).`);
for (const w of warnings) console.log(`  aviso  ${w}`);
if (failures.length) {
  console.error(`\n${failures.length} problema(s):`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log("Todo en orden.");
