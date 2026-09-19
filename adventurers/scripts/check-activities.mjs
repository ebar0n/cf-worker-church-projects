// Behavioral regression tests: real DOM events, completed rounds, exact awards.
// The test-only reader observes generated questions; it never calls game handlers.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM, VirtualConsole} from 'jsdom';
const publicRoot = new URL('../public/', import.meta.url);
const cases = {
  'biblia-colores':[5,0], 'biblia-orden':[3,2], 'organiza-la-biblia':[1,1],
  'ideales-voto':[2,0], 'ideales-ley':[2,3], 'ideales-himno':[3,0],
  'pr39':[5,0], 'pr39-prueba10':[5,0], 'pr39-nombres':[3,2], 'pr39-colorear':[3,1],
  'pr41-secuencia':[5,1], 'pr41-versiculo':[1,1], 'pr41-estatua-sueno':[5,2],
  'pr44-diferencias':[5,2], 'pr44-quien-lo-dijo':[3,1], 'pr44-reloj':[3,2],
  'padres-cap17':[0,5], 'padres-cap18':[0,5]
};
function setup(slug, older=true){
  const dir=slug.startsWith('pr')?'conexion-biblica-'+slug:slug;
  const html=readFileSync(new URL(dir+'/index.html', publicRoot),'utf8');
  const errors=[]; const vc=new VirtualConsole();
  vc.on('jsdomError',e=>errors.push(e.message));
  const dom=new JSDOM(html,{url:'https://test.invalid/'+dir+'/',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
  const w=dom.window, d=w.document, scores={card:0,quiz:0}, wrong={card:0,quiz:0}; let caps;
  w.AvProfile={init:o=>{caps=o.caps},get:()=>({id:1,name:'Prueba local',age:older?9:4,points:scores.card+scores.quiz}),
    clubClass:()=>older?'Manos Ayudadoras':'Corderitos',clubClasses:()=>[],today:()=>({...scores}),
    canScore:k=>k?scores[k]<caps[k]:scores.card<caps.card||scores.quiz<caps.quiz,
    score:async(ok,k='card')=>{if(ok && scores[k]<caps[k]) scores[k]++; else if(!ok) wrong[k]++},
    pick:(_b,items,n)=>items.slice(0,n),onChange:()=>{},open:()=>{},toast:()=>{},pending:()=>0};
  w.scrollTo=()=>{};w.HTMLElement.prototype.scrollIntoView=()=>{};
  w.matchMedia=()=>({matches:true,addEventListener(){}});
  const timeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>timeout(fn,Math.min(ms||0,1),...args);
  for(const [,code] of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) w.eval(code+'\nwindow.__read = expression => eval(expression);');
  const read=s=>w.__read(s);
  const visible=e=>{for(let n=e;n;n=n.parentElement)if(n.hidden||n.disabled||(n.tagName==='SECTION'&&!n.classList.contains('active')))return false;return true};
  const click=(sel)=>{const e=typeof sel==='string'?d.querySelector(sel):sel;assert.ok(e,'Missing control '+sel);assert.ok(visible(e),'Unavailable control '+sel);e.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));};
  const settle=()=>new Promise(r=>setTimeout(r,5));
  const check=()=>{assert.deepEqual(errors,[]);for(const e of d.querySelectorAll('section')) assert.doesNotMatch(e.textContent,/undefined|\bNaN\b|\[object Object\]/)};
  const game=d.querySelector('[data-tab="juego"], [data-tab="practicar"], [data-tab="examen"]');game.click();
  return {dom,w,d,read,click,settle,check,scores,wrong,visible};
}
async function run(slug,older){
 const t=setup(slug,older),{d,w,read,click,settle,check,scores,visible}=t;
 try {
  if(slug==='pr44-reloj'){
   // A tap that repaints the cards must not discard the family's typed hour.
   const hour=d.querySelector('[data-hora="0"]');
   hour.value='Antes del desayuno';hour.dispatchEvent(new w.Event('input',{bubbles:true}));
   for(let i=0;i<3;i++){click(`[data-orar="${i}"]`);check();click(`[data-si="${i}"]`)}
   assert.equal(d.querySelector('[data-hora="0"]').value,'Antes del desayuno');
   read('cargar(); paint()');
   assert.equal(d.querySelector('[data-hora="0"]').value,'Antes del desayuno');
   click('#anclaVerBtn');click('#anclaSi');click('#charlaSi');
   // Clearing a habit marker must not repay the same moment.
   click('[data-desmarcar="0"]');click('[data-orar="0"]');click('[data-si="0"]');
  }else if(slug==='organiza-la-biblia'){
   click('[data-modo="clasificar"]');
   for(let i=0;i<5;i++){click(`[data-family="${read('cla.books[cla.i].fam')}"]`);check();click('#mainBtn')}
   click('#menuJuegoBtn');click('[data-modo="ordenar"]');click('.family-pick-btn');click('#mainBtn');
   for(let i=0;read('ord')&&i<15;i++){click(`.tile-btn[data-pos="${read('ord.i')}"]`);check()}
   assert.equal(read('ord'),null);
  }else{
   click('#mainBtn');
   for(let step=0;step<160;step++){
    await settle();check();
    const state=read(slug.startsWith('padres')?'exam':'match');
    if(!state || state.phase === 'fin')break;
    if(slug==='biblia-colores'&&!state.respondida)click(`[data-family="${state.actual.nombre}"]`);
    else if(slug==='biblia-orden'&&read('phase()')==='antes'&&!state.respondida){const r=state.antes[state.paso];const a=read('FAMILIES').find(f=>f.nombre===r.familia).libros[r.i+1];click(`[data-op="${a}"]`)}
    else if(slug==='biblia-orden'&&read('phase()')==='ordenar'&&d.querySelector('.tile:not(.placed)'))click(`[data-book="${state.orden.familia.libros[state.orden.puestos]}"]`);
    else if(slug==='ideales-ley'&&read('phase()')==='orden'&&!state.dicho){const r=state.orden[state.paso-2],law=read('LAW_POINTS');const a=r.tipo==='cual-numero'?r.palabra:r.tipo==='que-sigue'?law[Math.min(r.rank,8)+1].palabra:law[Math.min(r.rank,7)].palabra;click(`[data-op="${a}"]`)}
    else if(slug==='pr39'&&state.phase==='rafaga'&&!state.respondida)click(state.baraja[state.paso].side==='rey'?'#btnRey':'#btnDaniel');
    else if(slug==='pr39-prueba10'&&state.phase==='linea'&&!state.respondida)click(`[data-idx="${state.pasos[state.pos].idx}"]`);
    else if(slug==='pr39-colorear'&&state.paso<3&&!state.pintando){const l=read('laminaActual()');click(`.scene-holder[data-scene="${l.scene}"] [data-zone="${l.zone}"]`)}
    else if(slug==='pr39-nombres'&&d.querySelector('.tile:not(.done)')){
     const first=d.querySelector('.tile:not(.done)'),id=state.fichas[+first.dataset.i].id;
     const pair=[...d.querySelectorAll('.tile:not(.done)')].filter(b=>state.fichas[+b.dataset.i].id===id);click(pair[0]);click(pair[1]);
    }else if(slug==='pr39-nombres'&&d.querySelector('.opt:not(:disabled)'))click('[data-ok="1"]');
    else if(slug==='pr41-secuencia'&&state.phase==='armar'){
     const i=state.slots.indexOf(null);if(i>=0){click(`[data-tira="${i}"]`);click(`[data-slot="${i}"]`)}else click('#mainBtn');
    }else if(slug==='pr41-estatua-sueno'&&state.phase==='vestir'&&d.querySelector('#mainBtn').hidden){
     const part=read('PARTES').find(p=>p.id===(state.objetivo||state.pendientes[0]));
     for(const mat of part.materiales){click(`[data-mat="${mat}"]`);click(`[data-hit="${part.id}"]`)}
    }else if(slug==='pr41-estatua-sueno'&&state.phase==='reto'&&state.quizPaso===1)click(`[data-op="${state.retos[state.retoIdx].correct}"]`);
    else if(slug==='pr44-diferencias'&&state.phase==='buscar'){
     const svg=d.querySelector('#sceneWrap svg'),[x,y]=state.elems[state.roundLabel].zonas[0];
     svg.getBoundingClientRect=()=>({left:0,top:0,width:400,height:380});svg.dispatchEvent(new w.MouseEvent('click',{bubbles:true,clientX:x,clientY:y}));
    }else if(slug==='pr44-diferencias'&&state.phase==='nombrar')click(`[data-id="${state.elems[state.roundLabel].id}"]`);
    else if(slug==='pr44-diferencias'&&state.phase==='quiz')click(`[data-i="${state.quizzes[state.quizIdx].ok}"]`);
    else if(slug==='pr44-quien-lo-dijo'&&!state.respondida&&state.phase==='practica')click(`[data-who="${state.practica[state.i].who}"]`);
    else if(slug==='pr44-quien-lo-dijo'&&!state.respondida&&state.phase==='quiz')click(`[data-d="${state.aquien.a}"]`);
    else if(slug.startsWith('padres')&&!state.respondida){const q=state.qs[state.i];click(`[data-k="${q.options.indexOf(q.correct)}"]`)}
    else {const yes=d.querySelector('#juezSi, #judgeYes');if(yes&&visible(yes))click(yes);else if(visible(d.querySelector('#mainBtn')))click('#mainBtn')}
    if(step===159)throw Error('Activity did not finish: '+JSON.stringify({phase:state.phase,step:state.paso}));
   }
  }
  await settle();check();
  let expected=cases[slug];
  if(!older){expected=({'pr39-prueba10':[2,0],'pr39-nombres':[2,2],'pr41-versiculo':[1,0],'pr41-estatua-sueno':[5,0],'pr44-diferencias':[3,0],'pr44-quien-lo-dijo':[3,0]})[slug]||expected}
  assert.deepEqual([scores.card,scores.quiz],expected,slug+' awards');
  console.log(`✓ ${slug} (${older?'9':'4'} years): ${scores.card} card, ${scores.quiz} quiz`);
 }finally{t.dom.window.close()}
}
let failures=0;
for(const slug of Object.keys(cases))for(const older of [true,false]){
 if(process.argv[2]&&!slug.includes(process.argv[2]))continue;
 try{await run(slug,older)}catch(e){failures++;console.error('✗',slug,older?'older':'younger',e.stack)}
}
// Regression: wrong answers must not earn, and feedback must remain usable.
for(const slug of ['biblia-colores','biblia-orden','ideales-ley']){
 const t=setup(slug);try{
  t.click('#mainBtn');
  if(slug==='ideales-ley'){for(let i=0;i<2;i++){t.click('#mainBtn');t.click('#juezSi')}}
  let selector;
  if(slug==='biblia-colores')selector=[...t.d.querySelectorAll('.color-btn')].find(b=>b.dataset.family!==t.read('match.actual.nombre'));
  else if(slug==='biblia-orden'){const r=t.read('match.antes[0]'),f=t.read('FAMILIES').find(f=>f.nombre===r.familia);selector=[...t.d.querySelectorAll('.option')].find(b=>b.dataset.op!==f.libros[r.i+1])}
  else selector=[...t.d.querySelectorAll('.option')].find(b=>b.dataset.op!==t.read('match.orden[0].palabra'));
  t.click(selector);t.check();assert.equal(t.wrong[slug==='ideales-ley'?'quiz':'card'],1);
  assert.equal(t.scores[slug==='ideales-ley'?'quiz':'card'],0);assert.match(t.d.querySelector('.pista').textContent,/Era/);
 }catch(e){failures++;console.error('✗ wrong-answer regression',slug,e.stack)}finally{t.dom.window.close()}
}
// A partial two-material foot survives completing another part in free mode.
{
 const t=setup('pr41-estatua-sueno');try{
  t.click('#mainBtn');t.click('[data-mat="hierro"]');t.click('[data-hit="pies"]');
  t.click('[data-mat="oro"]');t.click('[data-hit="cabeza"]');t.click('#mainBtn');
  t.click('[data-mat="barro"]');t.click('[data-hit="pies"]');
  assert.equal(t.scores.card,2);assert.ok(!t.read('match.pendientes').includes('pies'));t.check();
 }catch(e){failures++;console.error('✗ partial feet regression',e.stack)}finally{t.dom.window.close()}
}
// The shortest furnace story still includes refusing worship and the rescue.
{
 const t=setup('pr41-secuencia',false);try{
  t.click('#mainBtn');assert.deepEqual(Array.from(t.read('match.tiras'),x=>x.id),[1,4,5,8,9]);
 }catch(e){failures++;console.error('✗ furnace content regression',e.stack)}finally{t.dom.window.close()}
}
if(failures)process.exitCode=1;
