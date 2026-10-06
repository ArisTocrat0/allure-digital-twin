"use strict";
const v=require('./validation.cjs');
function measures(c,s){
 const scheduled=c.shifts.reduce((n,[a,b])=>n+Math.max(0,Math.min(s.t,b)-Math.min(s.t,a)),0);
 const demand=c.orders.reduce((n,o)=>n+o.qty,0),timely=s.orders.filter(o=>o.completedAt!==null&&o.completedAt<=o.due).length;
 return {produced:s.produced,shipped:s.shipped,completion:demand?s.shipped/demand:null,timely,orders:s.orders.length,downtime:s.stations.reduce((n,x)=>n+x.time.repair+x.time.materials+x.time.operator+x.time.blocked+x.time.starved,0),scrapped:s.scrapped,quality:s.produced+s.scrapped?s.produced/(s.produced+s.scrapped):null,scheduled};
}
const priority={Critical:4,High:3,Medium:2,Low:1};
function detect(c,now,end){
 const risks=[],add=(kind,level,object,at,impact,chain,extra={})=>risks.push({id:kind+':'+object,kind,level,object,at,impact,chain,probability:null,...extra});
 const late=end.orders.filter(o=>o.due<=c.horizon&&(o.completedAt===null||o.completedAt>o.due));
 for(const s of now.stations){
  if(s.state==='repair')add('repair','Critical',s.i,now.t,Math.max(0,s.downUntil-now.t),['repair','capacity'],{station:s.i});
  if(s.state==='materials')add('materials','High',s.i,now.t,null,['materials','capacity'],{station:s.i,parts:Object.keys(c.bom).filter(k=>now.stock[k]<c.bom[k])});
  if(s.state==='blocked')add('buffer','Medium',s.i,now.t,null,['buffer','capacity'],{station:s.i});
  if(s.state==='operator')add('operators','High',s.i,now.t,null,['operators','capacity'],{station:s.i});
 }
 for(const f of c.failures.filter(f=>f.at>now.t&&f.at<c.horizon))add('failure','High',f.station,f.at,f.duration,['failure','repair','capacity'],{station:f.station});
 if(!risks.some(r=>r.kind==='materials')&&end.stations[0].time.materials>now.stations[0].time.materials)add('materials','High',0,null,end.stations[0].time.materials-now.stations[0].time.materials,['materials','capacity'],{station:0,parts:Object.keys(c.bom).filter(k=>c.stock[k]+c.deliveries.filter(d=>d.at<=c.horizon).reduce((n,d)=>n+(d.parts[k]||0),0)<c.bom[k]*c.orders.reduce((n,o)=>n+o.qty,0)),forecast:true});
 if(!risks.some(r=>r.kind==='operators')&&end.stations.some((s,i)=>s.time.operator>now.stations[i].time.operator))add('operators','Medium','line',null,null,['operators','capacity'],{forecast:true});
 const contributors=[end.stations.some(s=>s.time.materials>0)?'materials':null,end.stations.some(s=>s.time.operator>0)?'operators':null,end.stations.some(s=>s.time.repair>0)?'repair':null,end.reworked>0?'qualityRisk':null].filter(Boolean);
 for(const o of late){
  const shippedAtDeadline=end.timeline.filter(x=>x.at<=o.due).at(-1)?.shipped??0;
  const preceding=end.orders.slice(0,end.orders.findIndex(x=>x.id===o.id)).reduce((n,x)=>n+x.qty,0);
  const shortfallAtDeadline=o.qty-Math.max(0,Math.min(o.qty,shippedAtDeadline-preceding));
  add('order',o.due<=now.t?'Critical':'High',o.id,o.due,shortfallAtDeadline,[...contributors,'capacity','order'],{order:o.id,shortfallAtDeadline,shortfallAtHorizon:o.qty-o.shipped,completedAt:o.completedAt,forecast:true,causality:'Observed contributors, not individually proven causes; use what-if comparison to test an intervention'});
 }
 if(end.scrapped>now.scrapped)add('quality','Medium',2,null,end.scrapped-now.scrapped,['quality','scrap'],{station:2,forecast:true});
 return risks.sort((a,b)=>priority[b.level]-priority[a.level]||Number(b.kind==='order')-Number(a.kind==='order')||(a.at??Infinity)-(b.at??Infinity)||String(a.id).localeCompare(String(b.id)));
}
async function assess(input,simulate){
 const c=v.configuration(input.config),until=input.until??0;
 if(!Number.isInteger(until)||until<0||until>c.horizon)v.fail();
 const current=(await simulate(c,until)).snapshot,end=until===c.horizon?current:(await simulate(c,c.horizon)).snapshot;
 const events=[...c.deliveries.map((d,i)=>({at:d.at,kind:'delivery',object:i})),...c.failures.flatMap(f=>[{at:f.at,kind:'failure',object:f.station},{at:f.at+f.duration,kind:'repair',object:f.station}]),...c.orders.map(o=>({at:o.due,kind:'order',object:o.id})),...c.shifts.flatMap(([a,b])=>[{at:a,kind:'shiftStart',object:''},{at:b,kind:'shiftEnd',object:''}])].filter(e=>e.at>until&&e.at<=c.horizon).sort((a,b)=>a.at-b.at).slice(0,5);
 return {until,current,projected:end,kpi:measures(c,current),projectedKpi:measures(c,end),risks:detect(c,current,end),events,method:'Deterministic C++ replay with configured seed; probabilities unavailable; cumulative station downtime is not factory wall-clock downtime'};
}
function candidates(c){
 const rows=[],add=(kind,object,change)=>{const config=structuredClone(c);change(config);rows.push({kind,object,config:v.configuration(config)});};
 if(c.operators<3)add('operators',null,x=>x.operators++);
 c.cycles.forEach((n,i)=>{if(n>30)add('speed',i,x=>x.cycles[i]=Math.max(30,Math.round(n*.9)));});
 const delivery=c.deliveries.map((d,i)=>({i,at:d.at})).filter(d=>d.at>0&&d.at<=c.horizon).sort((a,b)=>a.at-b.at)[0];
 if(delivery)add('delivery',delivery.i,x=>x.deliveries[delivery.i].at=Math.max(0,delivery.at-3000));
 c.bufferCaps.forEach((n,i)=>{if(n<20)add('buffer',i,x=>x.bufferCaps[i]++);});
 return rows;
}
async function recommend(input,simulate){
 const c=v.configuration(input.config),assessment=await assess(input,simulate),base=assessment.projectedKpi;
 if(!assessment.risks.length)return {assessment,options:[],evaluated:0};
 const options=[];let evaluated=0;
 for(const candidate of candidates(c)){
  const snapshot=(await simulate(candidate.config,c.horizon)).snapshot,kpi=measures(candidate.config,snapshot);evaluated++;
  const delta={produced:kpi.produced-base.produced,shipped:kpi.shipped-base.shipped,timely:kpi.timely-base.timely,downtime:kpi.downtime-base.downtime,scrapped:kpi.scrapped-base.scrapped};
  // Avoid recommending a trade-off that worsens deadlines or shipped output.
  if(delta.timely>=0&&delta.shipped>=0&&(delta.timely>0||delta.shipped>0||delta.produced>0&&delta.scrapped<=0||delta.downtime<0&&delta.produced>=0&&delta.scrapped<=0))options.push({...candidate,kpi,delta,orders:snapshot.orders});
 }
 options.sort((a,b)=>b.delta.timely-a.delta.timely||b.delta.shipped-a.delta.shipped||b.delta.produced-a.delta.produced||a.delta.scrapped-b.delta.scrapped||a.delta.downtime-b.delta.downtime||a.kind.localeCompare(b.kind));
 return {assessment,evaluated,options:options.slice(0,3),method:'Alternatives replay the full shift from the beginning with the same seed; no plan change is applied; benefits are model comparisons, not calibrated factory effects'};
}
module.exports={measures,detect,candidates,assess,recommend};
