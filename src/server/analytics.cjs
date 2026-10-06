"use strict";
const v = require('./validation.cjs');
const { random } = require('../domain/reference.cjs');
const finite = (n,min,max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
function metrics(c,s) {
  const scheduled = c.shifts.reduce((n,[a,b])=>n+Math.max(0,Math.min(b,s.t)-Math.min(a,s.t)),0);
  const stations=s.stations.map(x=>({station:x.i, utilization:scheduled ? x.time.processing/scheduled : 0, processing:x.time.processing, blocked:x.time.blocked, starved:x.time.starved, operator:x.time.operator, repair:x.time.repair, offshift:x.time.offshift}));
  const demand=c.orders.reduce((n,o)=>n+o.qty,0);
  return {scheduled,stations,planCompletion:demand?s.shipped/demand:0,qualityYield:s.produced+s.scrapped ? s.produced/(s.produced+s.scrapped):null,throughputPerHour:s.t?s.produced*3600/s.t:0,lateOrders:s.orders.filter(o=>o.due<=s.t&&(o.completedAt===null||o.completedAt>o.due)).length};
}
async function diagnose(c,simulate) {
 const base=(await simulate(c,c.horizon)).snapshot;
 const sensitivity=[];
 for(let i=0;i<3;i++) {
  const alternative=structuredClone(c); alternative.cycles[i]=Math.max(30,Math.round(c.cycles[i]*.9));
  const s=(await simulate(alternative,c.horizon)).snapshot;
  sensitivity.push({station:i,cycleBefore:c.cycles[i],cycleAfter:alternative.cycles[i],extraShipped:s.shipped-base.shipped,extraProduced:s.produced-base.produced,lateOrdersReduced:metrics(c,base).lateOrders-metrics(alternative,s).lateOrders});
 }
 const best=[...sensitivity].sort((a,b)=>b.extraShipped-a.extraShipped||b.extraProduced-a.extraProduced||b.lateOrdersReduced-a.lateOrdersReduced);
 return {metrics:metrics(c,base),sensitivity,bottleneck:best[0].extraShipped>0||best[0].extraProduced>0||best[0].lateOrdersReduced>0?best[0].station:null,snapshot:base};
}
function summary(values) {
 const a=[...values].sort((a,b)=>a-b), q=p=>a[Math.floor((a.length-1)*p)];
 return {mean:a.reduce((s,n)=>s+n,0)/a.length,p05:q(.05),p50:q(.5),p95:q(.95)};
}
function wilson(hits,n) {
 const z=1.96,p=hits/n,d=1+z*z/n,center=(p+z*z/(2*n))/d,half=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
 return [Math.max(0,center-half),Math.min(1,center+half)];
}
async function forecast(input,simulate) {
 const c=v.configuration(input.config), baseline=v.configuration(input.baseline||v.DEFAULT), n=input.samples;
 if(c.horizon!==baseline.horizon||[...c.orders,...baseline.orders].some(o=>o.due>c.horizon)) v.fail();
 if(!Number.isInteger(n)||n<20||n>200) v.fail();
 const cycleVariation=input.cycleVariation,deliveryJitter=input.deliveryJitter;
 const failureProbability=input.failureProbability??0,repairMinutes=input.repairMinutes??30;
 if(!finite(failureProbability,0,1)||!Number.isInteger(repairMinutes)||repairMinutes<1||repairMinutes>120) v.fail();
 if(!finite(cycleVariation,0,.5)||!Number.isInteger(deliveryJitter)||deliveryJitter<0||deliveryJitter>7200) v.fail();
 const cost=input.cost;
 if(!cost||!['margin','scrap','late','investment','operating'].every(k=>finite(cost[k],0,1e9))) v.fail();
 const rows=[],orders=c.orders.map(o=>({id:o.id,hits:0}));
 const uncertainty=(source,seed)=>{
  const x=structuredClone(source); let counter=0; const rng=()=>random(seed,++counter,0); x.seed=seed;
  x.cycles=x.cycles.map(t=>Math.max(30,Math.min(3600,Math.round(t*(1+(rng()*2-1)*cycleVariation)))));
  x.deliveries=x.deliveries.map(d=>({...d,at:Math.max(0,Math.min(604800,Math.round(d.at+(rng()*2-1)*deliveryJitter)))}));
  if(rng()<failureProbability&&x.failures.length<20)x.failures.push({at:Math.round(rng()*Math.max(0,x.horizon-1)),station:Math.min(2,Math.floor(rng()*3)),duration:repairMinutes*60});
  return v.configuration(x);
 };
 for(let i=0;i<n;i++) {
  const seed=(c.seed+i)>>>0;
  const a=(await simulate(uncertainty(c,seed),c.horizon)).snapshot;
  const b=(await simulate(uncertainty(baseline,seed),baseline.horizon)).snapshot;
  let late=0;
  a.orders.forEach((o,j)=>{if(o.completedAt===null||o.completedAt>o.due){orders[j].hits++;late++;}});
  const baselineLate=b.orders.filter(o=>o.completedAt===null||o.completedAt>o.due).length;
  const benefit=(a.shipped-b.shipped)*cost.margin+(b.scrapped-a.scrapped)*cost.scrap+(baselineLate-late)*cost.late-cost.operating;
  rows.push({seed,shipped:a.shipped,baselineShipped:b.shipped,scrapped:a.scrapped,late,benefit,repairMinutes:a.stations.reduce((n,s)=>n+s.time.repair/60,0)});
 }
 const mean=summary(rows.map(x=>x.benefit)).mean;
 return {samples:n,assumptions:{cycleVariation,deliveryJitter,failureProbability,repairMinutes,qualityFail:c.qualityFail,reworkFail:c.reworkFail},repairMinutes:summary(rows.map(x=>x.repairMinutes)),shipped:summary(rows.map(x=>x.shipped)),baselineShipped:summary(rows.map(x=>x.baselineShipped)),benefit:summary(rows.map(x=>x.benefit)),paybackShifts:mean>0?cost.investment/mean:null,orders:orders.map(o=>({id:o.id,probability:o.hits/n,interval:wilson(o.hits,n)})),rows};
}
// Interpretable logistic model. Chronological holdout is never used to fit scaling or weights.
function train(input) {
 const target=input.target||'late';if(!['late','failure'].includes(target))v.fail();
 const rows=Array.isArray(input.rows)?input.rows.map(r=>({...r,late:r[target]})):input.rows,features=['cycle','operators','delay','demand'];
 if(!Array.isArray(rows)||rows.length<40||rows.length>400||!rows.every(r=>r&&finite(r.cycle,30,3600)&&finite(r.operators,1,3)&&finite(r.delay,0,7200)&&finite(r.demand,1,20000)&&(r.late===0||r.late===1)&&typeof r.date==='string'&&Number.isFinite(Date.parse(r.date)))) v.fail();
 const sorted=[...rows].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
 if(new Set(sorted.map(r=>Date.parse(r.date))).size!==sorted.length) v.fail();
 const cut=Math.floor(sorted.length*.8),training=sorted.slice(0,cut),test=sorted.slice(cut);
 if(!training.some(r=>r.late===0)||!training.some(r=>r.late===1)) v.fail();
 const means=features.map(k=>training.reduce((n,r)=>n+r[k],0)/cut),scales=features.map((k,i)=>Math.sqrt(training.reduce((n,r)=>n+(r[k]-means[i])**2,0)/cut)||1);
 const vector=r=>[1,...features.map((k,i)=>(r[k]-means[i])/scales[i])],sigmoid=x=>1/(1+Math.exp(-Math.max(-35,Math.min(35,x))));
 const weights=Array(5).fill(0);
 for(let epoch=0;epoch<500;epoch++) {
  const gradient=Array(5).fill(0);
  for(const r of training){const x=vector(r),p=sigmoid(x.reduce((s,n,i)=>s+n*weights[i],0));x.forEach((n,i)=>gradient[i]+=(p-r.late)*n/cut);}
  weights.forEach((w,i)=>weights[i]-=.1*(gradient[i]+(i?.01*w:0)));
 }
 const rate=training.reduce((n,r)=>n+r.late,0)/cut;
 const prediction=test.map(r=>({date:r.date,actual:r.late,probability:sigmoid(vector(r).reduce((s,n,i)=>s+n*weights[i],0))}));
 const brier=prediction.reduce((n,r)=>n+(r.probability-r.actual)**2,0)/test.length,baselineBrier=test.reduce((n,r)=>n+(rate-r.late)**2,0)/test.length;
 return {target,features,means,scales,ranges:features.map(k=>[Math.min(...training.map(r=>r[k])),Math.max(...training.map(r=>r[k]))]),weights,trainingRows:cut,testRows:test.length,trainingEnd:training.at(-1).date,testStart:test[0].date,brier,baselineBrier,improvesBaseline:brier<baselineBrier,prediction};
}
async function portfolio(input,simulate){
 if(!Array.isArray(input.lines)||input.lines.length<1||input.lines.length>6)v.fail();
 const lines=[];
 for(const line of input.lines){if(!line||typeof line.name!=='string'||line.name.length<1||line.name.length>60)v.fail();const config=v.configuration(line.config),snapshot=(await simulate(config,config.horizon)).snapshot;lines.push({name:line.name,config,metrics:metrics(config,snapshot),snapshot});}
 if(new Set(lines.map(l=>l.name)).size!==lines.length)v.fail();
 if(new Set(lines.map(l=>l.config.horizon)).size!==1)v.fail();
 return {lines,totals:{produced:lines.reduce((n,l)=>n+l.snapshot.produced,0),shipped:lines.reduce((n,l)=>n+l.snapshot.shipped,0),scrapped:lines.reduce((n,l)=>n+l.snapshot.scrapped,0)},sharedResources:false};
}
module.exports={metrics,diagnose,forecast,train,wilson,portfolio};
