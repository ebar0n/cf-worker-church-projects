import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const code=readFileSync(new URL('../public/shared/profile.js',import.meta.url),'utf8');
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota'}).format(new Date());
const caps={card:3,quiz:1};
const profile=(doc='1111',n=0,day=today)=>({doc,id:Number(doc),name:'Local '+doc,age:7,points:n,today:{test:{card:n,quiz:0}},caps:{test:caps},limit:{card:5,quiz:5},day});
const response=p=>({ok:true,status:200,json:async()=>({player:{id:p.id,name:p.name,age:p.age,points:p.points},today:p.today,caps:p.caps,limit:p.limit,day:p.day})});
const dom=new JSDOM('<div><span id="chip"></span></div>',{url:'https://test.invalid/',runScripts:'outside-only'});
const w=dom.window;
w.matchMedia=()=>({matches:false});w.localStorage.setItem('aventureros-player',JSON.stringify(profile()));
let online=false, serverFailure=false, release;const sent=[];
Object.defineProperty(w.navigator,'onLine',{get:()=>online});
w.fetch=async(url,opts)=>{
 const body=JSON.parse(opts.body);
 if(url.endsWith('login'))throw new Error('offline');
 sent.push(body);
 if(release===true)await new Promise(r=>{release=r});
 if(serverFailure)return {ok:false,status:503,json:async()=>({error:'temporary'})};
 return response(profile(body.doc,1));
};
w.eval(code);w.AvProfile.init({activity:'test',caps,chip:w.document.querySelector('#chip')});
await new Promise(r=>setImmediate(r));
// Serialized offline answers reserve the remaining daily cap.
await Promise.all(Array.from({length:8},()=>w.AvProfile.score(true,'card')));
assert.equal(w.AvProfile.pending(),3);assert.equal(w.AvProfile.canScore('card'),false);
assert.equal(w.AvProfile.today().card,3);assert.match(w.document.querySelector('#chip').textContent,/3\/4 aquí hoy/);
let queue=JSON.parse(w.localStorage.getItem('aventureros-cola'));
assert.equal(new Set(queue.map(e=>e.requestId)).size,3);
// A transient server failure must retain exactly the same request IDs.
online=true;serverFailure=true;w.dispatchEvent(new w.Event('online'));
await new Promise(r=>setTimeout(r,5));
assert.deepEqual(JSON.parse(w.localStorage.getItem('aventureros-cola')),queue);
// Queued points from another child never replace the active profile.
w.dispatchEvent(new w.StorageEvent('storage',{key:'aventureros-player',newValue:JSON.stringify(profile('2222'))}));
assert.equal(w.AvProfile.pending(),0);
serverFailure=false;w.dispatchEvent(new w.Event('online'));await new Promise(r=>setTimeout(r,5));
assert.equal(w.AvProfile.get().doc,'2222');assert.equal(w.AvProfile.get().points,0);
assert.deepEqual(JSON.parse(w.localStorage.getItem('aventureros-cola')),[]);
assert.ok(sent.every(e=>e.doc==='1111'));
// Capture identity immediately, even when profile changes before the chain runs.
release=true;
const first=w.AvProfile.score(true,'card'),second=w.AvProfile.score(true,'card');
await new Promise(r=>setImmediate(r));
w.dispatchEvent(new w.StorageEvent('storage',{key:'aventureros-player',newValue:JSON.stringify(profile('3333'))}));
release();release=false;await Promise.all([first,second]);
assert.ok(sent.slice(-2).every(e=>e.doc==='2222'));assert.equal(w.AvProfile.get().doc,'3333');
// Yesterday's daily cap expires, even without a successful refresh.
w.dispatchEvent(new w.StorageEvent('storage',{key:'aventureros-player',newValue:JSON.stringify(profile('3333',3,'2000-01-01'))}));
assert.equal(w.AvProfile.today().card,0);assert.equal(w.AvProfile.canScore('card'),true);
assert.equal(w.AvProfile.cap('card'),3);
assert.equal(w.document.querySelector('.pf-version').textContent,'v1.0.1');
dom.window.close();console.log('✓ Shared profile: offline caps, retry identity, 503 retention, child isolation, day rollover, version');
