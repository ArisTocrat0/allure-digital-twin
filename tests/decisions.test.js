"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict'),D=require('../src/server/decisions.cjs'),R=require('../src/domain/reference.cjs'),native=async(c,until)=>({snapshot:JSON.parse(require('node:child_process').execFileSync(require('node:path').join(__dirname,'../build/'+(process.platform==='win32'?'twin.exe':'twin')),[],{input:JSON.stringify({config:c,until})+'\n',encoding:'utf8',windowsHide:true})).snapshot});
test('native assessment detects actual and projected risks, ranks critical first',async()=>{
 const c=R.scenario(R.DEFAULT,'delay'),r=await D.assess({config:c,until:10800},native);
 assert.ok(r.risks.length);assert.ok(r.risks.some(x=>x.kind==='repair'));
 assert.equal(r.risks[0].level,'Critical');assert.ok(r.risks.every(x=>x.probability===null));
 assert.ok(r.events.every(x=>x.at>10800));assert.ok(r.events.length<=5);
 assert.deepEqual(r.projected,(await native(c,c.horizon)).snapshot);
 for(const risk of r.risks.filter(x=>x.kind==='order')){
  const atDeadline=(await native(c,risk.at)).snapshot.orders.find(o=>o.id===risk.order);
  assert.equal(risk.shortfallAtDeadline,atDeadline.qty-atDeadline.shipped);
 }
});
test('what-if recommendations are native, reproducible, bounded and do not mutate plan',async()=>{
 const c=R.scenario(R.DEFAULT,'delay'),before=structuredClone(c),input={config:c,until:0},a=await D.recommend(input,native),b=await D.recommend(input,native);
 assert.deepEqual(c,before);assert.deepEqual(a,b);assert.ok(a.options.length>0&&a.options.length<=3);assert.ok(a.evaluated<=7);
 for(const o of a.options){const snapshot=(await native(o.config,o.config.horizon)).snapshot;assert.deepEqual(o.kpi,D.measures(o.config,snapshot));assert.ok(o.delta.timely>=0&&o.delta.shipped>=0);}
});
test('no artificial risks or recommendations for a completed feasible plan',async()=>{
 const c=structuredClone(R.DEFAULT);c.orders=[{id:'OK',qty:1,due:c.horizon}];c.failures=[];c.qualityFail=0;c.reworkFail=0;c.operators=3;
 const r=await D.recommend({config:c,until:c.horizon},native);assert.deepEqual(r.assessment.risks,[]);assert.deepEqual(r.options,[]);assert.equal(r.evaluated,0);
});
test('invalid current time and invalid inputs are rejected before native simulation',async()=>{
 await assert.rejects(()=>D.assess({config:R.DEFAULT,until:-1},native));await assert.rejects(()=>D.recommend({config:{},until:0},native));
});
test('risk ranking and metrics distinguish factory clock from station-minute sums',()=>{
 const c=R.DEFAULT,s=new R.Twin(c).advance(10800),end=new R.Twin(c).advance(c.horizon),r=D.detect(c,s,end);
 assert.equal(r[0].kind,'repair');assert.ok(D.measures(c,end).downtime>=0);assert.equal(D.measures(c,end).timely,end.orders.filter(o=>o.completedAt!==null&&o.completedAt<=o.due).length);
});
