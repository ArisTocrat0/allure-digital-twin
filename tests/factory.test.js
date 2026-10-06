const {test}=require('node:test'),assert=require('node:assert/strict');
const F=require('../src/domain/factory.cjs');
const options=()=>({dataset:structuredClone(F.DEFAULT),days:30,extraDowntime:[0,0,0],speedup:[0,0,0],cost:{margin:0,downtimeHour:0,operating:0,investment:0}});
test('case tables preserve reported values and serial output',()=>{
 const o=F.overview(F.DEFAULT);
 assert.equal(o.completed,241);assert.equal(o.plan,242);assert.equal(o.unallocated,241);
 assert.deepEqual(o.stages.map(s=>s.actual),[229,231,241]);
 assert.deepEqual(o.stages.map(s=>s.reportedLoadPct),[94.5,95,99.5]);
 assert.equal(o.stops.reduce((n,s)=>n+s.minutes,0),150);
 assert.equal(o.models.reduce((n,s)=>n+s.quantity,0),4300);
 assert.equal(o.models[0].allocationKnown,false);assert.equal(o.quality,null);
 const day=F.overview(F.DEFAULT,'2026-10-01','2026-10-01');assert.equal(day.completed,122);assert.equal(day.stops.reduce((n,s)=>n+s.minutes,0),65);
});
test('empirical scenarios use limiting capacity and additional downtime only',()=>{
 const p=options(),r=F.forecast(p);assert.equal(r.baselineDaily,114.5);assert.equal(r.scenarioDaily,114.5);assert.equal(r.estimatedDaysForPlan,38);assert.equal(r.limitedHistory,true);
 p.extraDowntime=[480,0,0];assert.equal(F.forecast(p).scenarioDaily,0);
 p.dataset.schedule.shiftsPerDay=2;assert.equal(F.forecast(p).scenarioDaily,57.25);
 p.extraDowntime=[0,0,0];p.speedup=[.1,0,0];p.cost.margin=100;assert.equal(F.forecast(p).benefit,3000);
});
test('invalid dates, duplicate data, quality and excess allocations rejected',()=>{
 for(const change of [d=>d.performance[0].date='2026-02-30',d=>d.performance.push({...d.performance[0]}),d=>d.quality.push({date:'2026-10-01',model:'Chevrolet Onix',inspected:2,defective:3}),d=>d.allocations.push({date:'2026-10-01',model:'Chevrolet Onix',quantity:123})]){const d=structuredClone(F.DEFAULT);change(d);assert.throws(()=>F.validate(d));}
 const d=structuredClone(F.DEFAULT);d.quality=[{date:'2026-10-01',model:'Chevrolet Onix',inspected:100,defective:2}];assert.equal(F.overview(d).quality.defectRate,.02);
});
