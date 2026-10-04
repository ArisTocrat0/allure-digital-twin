(function(root){
'use strict';
const clone=x=>JSON.parse(JSON.stringify(x));
const DEFAULT={seed:2026,horizon:28800,cycles:[360,600,420],bufferCaps:[2,2],operators:2,bom:{body:1,engine:1,wheels:4},stock:{body:12,engine:8,wheels:48},deliveries:[{at:7200,parts:{body:20,engine:24,wheels:80}}],shifts:[[0,12600],[14400,28800]],failures:[{at:10200,station:1,duration:1800}],qualityFail:0.12,reworkFail:0.15,shipEvery:3600,orders:[{id:'A-101',qty:12,due:14400},{id:'A-102',qty:16,due:28800}]};
const STATES=['processing','blocked','starved','materials','operator','offshift','repair','horizon'];
function validate(c){
 const int=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
 if(!int(c.seed)||!int(c.horizon,1)||c.horizon>604800||!int(c.operators,1)||c.operators>3||!int(c.shipEvery,1))throw Error('Invalid seed, horizon, operators or shipment interval');
 if(c.cycles.length!==3||c.cycles.some(x=>!int(x,1))||c.bufferCaps.length!==2||c.bufferCaps.some(x=>!int(x,1)))throw Error('Invalid line');
 for(const [k,v] of Object.entries(c.bom))if(!int(v,1)||!int(c.stock[k]))throw Error('Invalid BOM/stock');
 for(const v of Object.values(c.stock))if(!int(v))throw Error('Invalid stock');
 for(const d of c.deliveries)if(!int(d.at)||Object.entries(d.parts).some(([k,v])=>!(k in c.stock)||!int(v)))throw Error('Invalid delivery');
 let end=-1;for(const [a,b] of c.shifts){if(!int(a)||!int(b)||a>=b||a<end)throw Error('Invalid shift');end=b;}
 for(const f of c.failures)if(!int(f.at)||!int(f.station)||f.station>2||!int(f.duration,1))throw Error('Invalid failure');
 for(const p of [c.qualityFail,c.reworkFail])if(!Number.isFinite(p)||p<0||p>1)throw Error('Invalid quality rate');
 if(!c.orders.length||new Set(c.orders.map(o=>o.id)).size!==c.orders.length||c.orders.some(o=>!int(o.qty,1)||!int(o.due)))throw Error('Invalid orders');
}
// Counter-based random stream: quality of a vehicle is stable across scenarios.
function random(seed,id,attempt){let x=(seed ^ Math.imul(id,0x9e3779b1) ^ Math.imul(attempt+1,0x85ebca6b))>>>0;x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;x=Math.imul(x,0x846ca68b);x^=x>>>16;return (x>>>0)/4294967296;}
function scenario(base,key){const c=clone(base);if(key==='delay')c.deliveries[0].at+=7200;if(key==='breakdown')c.failures.push({at:5400,station:1,duration:3600});if(key==='operator')c.operators=Math.min(3,c.operators+1);if(key==='expedite')c.deliveries[0].at=Math.max(0,c.deliveries[0].at-3600);return c;}
class Twin{
 constructor(config=DEFAULT){validate(config);this.c=clone(config);config=this.c;this.t=0;this.started=0;this.scrapped=0;this.produced=0;this.reworked=0;this.shipped=0;this.stock=clone(config.stock);this.received=Object.fromEntries(Object.keys(this.stock).map(k=>[k,0]));this.buffers=[[],[]];this.finished=[];this.stations=config.cycles.map((cycle,i)=>({i,cycle,job:null,remaining:0,downUntil:0,state:'starved',time:Object.fromEntries(STATES.map(s=>[s,0]))}));this.orders=clone(config.orders).sort((a,b)=>a.due-b.due).map(o=>({...o,shipped:0,completedAt:null}));this.log=[];this.timeline=[];this.events=[];let seq=0;const add=(at,type,data={},priority=0)=>this.events.push({at,type,data:clone(data),priority,seq:seq++});
 config.deliveries.forEach(d=>add(d.at,'delivery',d,0));config.failures.forEach(f=>{add(f.at,'failure',f,1);add(f.at+f.duration,'repair',{station:f.station},2);});config.shifts.forEach(([a,b])=>{add(a,'shift',{on:true},3);add(b,'shift',{on:false},3);});for(let at=config.shipEvery;at<=config.horizon;at+=config.shipEvery)add(at,'ship',{},5);config.orders.forEach(o=>add(o.due,'deadline',{id:o.id},6));this.events.sort((a,b)=>a.at-b.at||a.priority-b.priority||a.seq-b.seq);this.index=0;this.process();this.assert();
 }
 note(type,message){this.log.push({at:this.t,type,message});}
 onShift(){return this.c.shifts.some(([a,b])=>this.t>=a&&this.t<b);}
 hasParts(){return Object.entries(this.c.bom).every(([k,v])=>this.stock[k]>=v);}
 demand(){return this.orders.reduce((n,o)=>n+o.qty,0);}
 stabilize(){
  // Downstream-first movement; a completed machine retains its vehicle if the buffer is full.
  for(let loop=0;loop<12;loop++){
   let changed=false;
   for(let i=2;i>=0;i--){const s=this.stations[i];if(!s.job||s.remaining!==0)continue;
    if(i===2){const j=s.job;const fail=random(this.c.seed,j.id,j.attempt)<(j.attempt?this.c.reworkFail:this.c.qualityFail);if(fail&&j.attempt===0){if(this.t===this.c.horizon){j.pendingRework=true;this.note('quality',`#${j.id}: переделка требуется, но не запущена — горизонт завершён`);continue;}j.attempt=1;this.reworked++;s.remaining=s.cycle;this.note('quality',`#${j.id}: переделка на контроле качества`);}else{if(fail){this.scrapped++;this.note('scrap',`#${j.id}: брак после переделки`);}else{this.finished.push(j);this.produced++;this.note('ready',`#${j.id}: готово, ожидает отгрузки`);}s.job=null;}changed=true;
    }else if(this.buffers[i].length<this.c.bufferCaps[i]){this.buffers[i].push(s.job);s.job=null;changed=true;}
   }
   // Terminal boundary accepts completions, but never starts/resumes an operation.
   if(this.t===this.c.horizon){for(const s of this.stations)s.state='horizon';break;}
   let free=this.c.operators;
   for(let i=2;i>=0;i--){const s=this.stations[i];if(s.downUntil>this.t){s.state='repair';continue;}if(!this.onShift()){s.state='offshift';continue;}if(s.job&&s.remaining===0){s.state='blocked';continue;}
    if(!s.job){if(i===0){if(this.started>=this.demand()+this.scrapped){s.state='starved';continue;}if(!this.hasParts()){s.state='materials';continue;}}else if(!this.buffers[i-1].length){s.state='starved';continue;}}
    if(!free){s.state='operator';continue;}free--;
    if(!s.job){if(i===0){for(const [k,v]of Object.entries(this.c.bom))this.stock[k]-=v;s.job={id:++this.started,attempt:0};this.note('start',`#${s.job.id}: BOM списан атомарно`);}else s.job=this.buffers[i-1].shift();s.remaining=s.cycle;changed=true;}
    s.state='processing';
   }
   if(!changed)break;
  }
 }
 ship(){for(const o of this.orders){const qty=Math.min(o.qty-o.shipped,this.finished.length);if(!qty)continue;this.finished.splice(0,qty);o.shipped+=qty;this.shipped+=qty;this.note('shipment',`${o.id}: отгружено ${qty} шт.`);if(o.shipped===o.qty)o.completedAt=this.t;}}
 process(){
  const batch=[];while(this.index<this.events.length&&this.events[this.index].at===this.t)batch.push(this.events[this.index++]);
  for(const e of batch){const d=e.data;if(e.type==='delivery'){for(const [k,v]of Object.entries(d.parts)){this.stock[k]+=v;this.received[k]+=v;}this.note('delivery','Поставка компонентов принята');}if(e.type==='failure'){this.stations[d.station].downUntil=Math.max(this.stations[d.station].downUntil,this.t+d.duration);this.note('failure',`Станция ${d.station+1}: поломка, ремонт ${d.duration} с`);}if(e.type==='repair'&&this.stations[d.station].downUntil<=this.t)this.note('repair',`Станция ${d.station+1}: ремонт завершён`);if(e.type==='shift')this.note('shift',d.on?'Начало смены':'Конец смены');}
  this.stabilize();
  for(const e of batch){if(e.type==='ship')this.ship();if(e.type==='deadline'){const o=this.orders.find(o=>o.id===e.data.id);this.note('deadline',`${o.id}: к сроку отгружено ${o.shipped}/${o.qty}`);}}
  this.timeline.push({at:this.t,produced:this.produced,shipped:this.shipped});
 }
 advance(target){if(!Number.isSafeInteger(target)||target<this.t||target>this.c.horizon)throw Error('Invalid target time');while(this.t<target){let next=Math.min(target,this.events[this.index]?.at??Infinity);for(const s of this.stations)if(s.state==='processing')next=Math.min(next,this.t+s.remaining);if(next<=this.t)throw Error('Event loop stalled');const dt=next-this.t;for(const s of this.stations){s.time[s.state]+=dt;if(s.state==='processing')s.remaining-=dt;}this.t=next;this.process();this.assert();}return this.snapshot();}
 assert(){const wip=this.buffers.flat().length+this.stations.filter(s=>s.job).length;if(this.started!==wip+this.scrapped+this.finished.length+this.shipped)throw Error('Vehicle conservation');for(const [k,v]of Object.entries(this.stock))if(v<0||!Number.isSafeInteger(v)||v!==this.c.stock[k]+this.received[k]-this.started*(this.c.bom[k]??0))throw Error('Component conservation');if(this.buffers.some((b,i)=>b.length>this.c.bufferCaps[i]))throw Error('Buffer capacity');if(this.stations.filter(s=>s.state==='processing').length>this.c.operators)throw Error('Operator capacity');if(this.produced!==this.shipped+this.finished.length)throw Error('Finished conservation');const jobs=[...this.buffers.flat(),...this.stations.flatMap(s=>s.job?[s.job]:[]),...this.finished];if(new Set(jobs.map(j=>j.id)).size!==jobs.length)throw Error('Duplicate vehicle');return true;}
 snapshot(){return clone({t:this.t,started:this.started,produced:this.produced,shipped:this.shipped,scrapped:this.scrapped,reworked:this.reworked,finished:this.finished.length,stock:this.stock,received:this.received,buffers:this.buffers,stations:this.stations,orders:this.orders,log:this.log,timeline:this.timeline});}
}
function run(c){const m=new Twin(c);return m.advance(c.horizon);}
const api={Twin,DEFAULT,scenario,run,random,validate,STATES};if(typeof module!=='undefined')module.exports=api;else root.DigitalTwin=api;
})(typeof globalThis!=='undefined'?globalThis:this);
