"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const a=require('../src/server/analytics.cjs'),{DEFAULT,run}=require('../src/domain/reference.cjs');
const simulate=async c=>({snapshot:run(c)});
const cost={margin:100,scrap:10,late:20,investment:1000,operating:0};
test('paired Monte Carlo is reproducible and identical plans have zero benefit',async()=>{
 const input={config:DEFAULT,baseline:DEFAULT,samples:20,cycleVariation:.5,deliveryJitter:7200,cost};
 const r=await a.forecast(input,simulate);
 assert.deepEqual(r,await a.forecast(input,simulate));
 assert.equal(r.benefit.mean,0);assert.equal(r.paybackShifts,null);
 assert.ok(new Set(r.rows.map(x=>x.shipped)).size>1);
 r.orders.forEach(o=>{assert.ok(o.interval[0]<=o.probability&&o.interval[1]>=o.probability);});
});
test('forecast refuses unknown deadline outcomes, excessive work and invalid costs',async()=>{
 const input={config:DEFAULT,baseline:DEFAULT,samples:20,cycleVariation:0,deliveryJitter:0,cost};
 for(const change of [{samples:201},{cycleVariation:-1},{cost:{...cost,margin:NaN}},{config:{...DEFAULT,orders:[{id:'future',qty:2,due:50000}]}},{baseline:{...DEFAULT,horizon:100}}])await assert.rejects(a.forecast({...input,...change},simulate));
});
test('utilization excludes off-shift time and diagnosis distinguishes no cycle improvement',async()=>{
 const c={...structuredClone(DEFAULT),qualityFail:0,reworkFail:0,stock:{body:0,engine:0,wheels:0},deliveries:[]};
 const r=await a.diagnose(c,simulate);assert.equal(r.bottleneck,null);assert.equal(r.metrics.planCompletion,0);
 assert.ok(r.metrics.stations.every(s=>s.utilization===0));
 assert.equal(r.metrics.scheduled,27000);
});
function history(){return Array.from({length:100},(_,i)=>({date:new Date(Date.UTC(2026,0,i+1)).toISOString(),cycle:i%2?1000:100,operators:2,delay:0,demand:28,late:i%2}));}
test('ML fits only earlier rows, improves a separable holdout and reports baseline score',()=>{
 const rows=history(),r=a.train({rows});assert.equal(r.trainingRows,80);assert.equal(r.testRows,20);
 assert.ok(Date.parse(r.trainingEnd)<Date.parse(r.testStart));assert.ok(r.improvesBaseline);assert.ok(r.brier<.1);
 const modified=structuredClone(rows);modified.slice(80).forEach(x=>x.cycle=3600);
 assert.deepEqual(a.train({rows:modified}).weights,r.weights);
 assert.deepEqual(a.train({rows:modified}).means,r.means);
});
test('ML rejects duplicate timestamps, insufficient data and single-class training',()=>{
 assert.throws(()=>a.train({rows:history().slice(0,20)}));
 const rows=history();rows[1].date=rows[0].date;assert.throws(()=>a.train({rows}));
 assert.throws(()=>a.train({rows:history().map(r=>({...r,late:0}))}));
});
test('independent line portfolio totals equal line snapshots and names must be unique',async()=>{
 const r=await a.portfolio({lines:[{name:'A',config:DEFAULT},{name:'B',config:DEFAULT}]},simulate);
 assert.equal(r.sharedResources,false);assert.equal(r.totals.shipped,r.lines[0].snapshot.shipped*2);
 await assert.rejects(a.portfolio({lines:[{name:'A',config:DEFAULT},{name:'A',config:DEFAULT}]},simulate));
});
test('forecast additional failure assumption changes repair exposure; failure classifier supports target',async()=>{
 const c={...structuredClone(DEFAULT),failures:[]};
 const input={config:c,baseline:c,samples:20,cycleVariation:0,deliveryJitter:0,cost};
 assert.equal((await a.forecast({...input,failureProbability:0},simulate)).repairMinutes.mean,0);
 assert.ok((await a.forecast({...input,failureProbability:1},simulate)).repairMinutes.mean>0);
 assert.equal(a.train({target:'failure',rows:history().map(r=>({...r,failure:r.late,late:undefined}))}).target,'failure');
});
