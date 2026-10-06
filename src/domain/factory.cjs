"use strict";
(function(){
const invalid = message => { throw Object.assign(Error(message), {status:400}); };
const sections = ['Сварка','Окраска','Сборка'];
const DEFAULT = {
  source: {name:'Тестовые данные для кейса «Цифровой двойник завода»',kind:'screenshot',pagesReceived:[1],totalPages:3,complete:false},
  performance:[
    {date:'2026-10-01',line:'Сварка-1',section:'Сварка',plan:120,actual:118,workHours:7.8,loadPct:98},
    {date:'2026-10-01',line:'Окраска-1',section:'Окраска',plan:120,actual:115,workHours:7.5,loadPct:94},
    {date:'2026-10-01',line:'Сборка-1',section:'Сборка',plan:122,actual:122,workHours:8,loadPct:100},
    {date:'2026-10-02',line:'Сварка-1',section:'Сварка',plan:120,actual:111,workHours:7.2,loadPct:91},
    {date:'2026-10-02',line:'Окраска-1',section:'Окраска',plan:120,actual:116,workHours:7.7,loadPct:96},
    {date:'2026-10-02',line:'Сборка-1',section:'Сборка',plan:120,actual:119,workHours:7.9,loadPct:99}
  ],
  downtimes:[
    {date:'2026-10-01',section:'Сварка',equipment:'ABB-01',reason:'Ошибка датчика',minutes:25},
    {date:'2026-10-01',section:'Окраска',equipment:'Печь-02',reason:'Замена фильтра',minutes:40},
    {date:'2026-10-02',section:'Сборка',equipment:'Конвейер-01',reason:'Обрыв цепи',minutes:55},
    {date:'2026-10-02',section:'Сварка',equipment:'ABB-01',reason:'Плановое ТО',minutes:30}
  ],
  productionPlan:[{model:'Chevrolet Onix',quantity:2500},{model:'Chevrolet Cobalt',quantity:1800}],
  planPeriod:{start:null,end:null},
  quality:[],
  schedule:{hoursPerShift:8,shiftsPerDay:1},
  allocations:[]
};
const finite=(n,min,max)=>typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
const text=s=>typeof s==='string'&&s.length>0&&s.length<=120&&s.isWellFormed();
const date=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
function validate(input){
 const d=structuredClone(input);if(!d||!Array.isArray(d.performance)||!d.performance.length||d.performance.length>500||!Array.isArray(d.downtimes)||d.downtimes.length>500||!Array.isArray(d.productionPlan)||!d.productionPlan.length||d.productionPlan.length>30)invalid('factory_invalid');
 const unique=new Set();
 for(const r of d.performance){if(!date(r.date)||!text(r.line)||!sections.includes(r.section)||![r.plan,r.actual].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000)||!finite(r.workHours,0,24)||!finite(r.loadPct,0,100)||(r.actual>0&&r.workHours===0))invalid('factory_invalid');const k=r.date+'|'+r.line;if(unique.has(k))invalid('factory_duplicate');unique.add(k);}
 for(const r of d.downtimes)if(!date(r.date)||!sections.includes(r.section)||!text(r.equipment)||!text(r.reason)||!finite(r.minutes,0,1440))invalid('factory_invalid');
 const models=new Set();for(const r of d.productionPlan){if(!text(r.model)||!Number.isSafeInteger(r.quantity)||r.quantity<0||r.quantity>1000000||models.has(r.model))invalid('factory_invalid');models.add(r.model);}
 if(!d.schedule||!finite(d.schedule.hoursPerShift,1,24)||!Number.isInteger(d.schedule.shiftsPerDay)||d.schedule.shiftsPerDay<1||d.schedule.shiftsPerDay>3||d.schedule.hoursPerShift*d.schedule.shiftsPerDay>24)invalid('factory_invalid');
 if(!d.planPeriod||((d.planPeriod.start===null)!==(d.planPeriod.end===null))||d.planPeriod.start!==null&&(!date(d.planPeriod.start)||!date(d.planPeriod.end)||d.planPeriod.end<d.planPeriod.start))invalid('factory_invalid');
 d.quality??=[];d.allocations??=[];
 if(!Array.isArray(d.quality)||d.quality.length>500||!Array.isArray(d.allocations)||d.allocations.length>500)invalid('factory_invalid');
 const qualityKeys=new Set();for(const q of d.quality){const key=q.date+'|'+q.model;if(!date(q.date)||!models.has(q.model)||![q.inspected,q.defective].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=100000)||q.defective>q.inspected||qualityKeys.has(key))invalid('factory_invalid');qualityKeys.add(key);}
 const allocationKeys=new Set();for(const a of d.allocations){const key=a.date+'|'+a.model;if(!date(a.date)||!models.has(a.model)||!Number.isSafeInteger(a.quantity)||a.quantity<0||a.quantity>100000||allocationKeys.has(key))invalid('factory_invalid');allocationKeys.add(key);}
 for(const day of new Set(d.allocations.map(a=>a.date))){const assigned=d.allocations.filter(a=>a.date===day).reduce((n,a)=>n+a.quantity,0),completed=d.performance.filter(r=>r.date===day&&r.section==='Сборка').reduce((n,r)=>n+r.actual,0);if(assigned>completed)invalid('factory_allocation');}
 // Source metadata is descriptive; it never changes validation or access control.
 d.source={name:text(d.source?.name)?d.source.name:'Импорт данных',kind:d.source?.kind==='screenshot'?'screenshot':'import',complete:d.source?.complete===true,pagesReceived:Array.isArray(d.source?.pagesReceived)?d.source.pagesReceived.filter(Number.isSafeInteger).slice(0,30):[],totalPages:Number.isSafeInteger(d.source?.totalPages)?d.source.totalPages:null};
 return d;
}
function overview(input,from=null,to=null){
 const d=validate(input);if(from!==null&&!date(from)||to!==null&&!date(to)||from&&to&&from>to)invalid('factory_invalid');
 const inRange=r=>(!from||r.date>=from)&&(!to||r.date<=to),rows=d.performance.filter(inRange),stops=d.downtimes.filter(inRange),finished=rows.filter(r=>r.section==='Сборка');
 const stages=sections.map(section=>{const r=rows.filter(r=>r.section===section),p=r.reduce((n,x)=>n+x.plan,0),actual=r.reduce((n,x)=>n+x.actual,0),hours=r.reduce((n,x)=>n+x.workHours,0);return {section,plan:p,actual,deviation:actual-p,completion:p?actual/p:null,reportedLoadPct:r.length?r.reduce((n,x)=>n+x.loadPct,0)/r.length:null,workHours:hours,outputPerReportedHour:hours?actual/hours:null,downtimeMinutes:stops.filter(x=>x.section===section).reduce((n,x)=>n+x.minutes,0)};});
 const reasons=Object.entries(stops.reduce((o,r)=>(o[r.reason]=(o[r.reason]||0)+r.minutes,o),{})).map(([reason,minutes])=>({reason,minutes})).sort((a,b)=>b.minutes-a.minutes);
 const equipment=[...new Set(d.downtimes.map(r=>r.equipment))].map(id=>({id,section:d.downtimes.find(r=>r.equipment===id).section,minutes:stops.filter(r=>r.equipment===id).reduce((n,r)=>n+r.minutes,0),events:stops.filter(r=>r.equipment===id).length}));
 const completed=finished.reduce((n,r)=>n+r.actual,0),plan=finished.reduce((n,r)=>n+r.plan,0),assigned=d.allocations.filter(inRange),allocated=assigned.reduce((n,r)=>n+r.quantity,0);
 const inspected=d.quality.filter(inRange).reduce((n,q)=>n+q.inspected,0),defective=d.quality.filter(inRange).reduce((n,q)=>n+q.defective,0);
 return {rows,stops,stages,equipment,reasons,completed,plan,completion:plan?completed/plan:null,unallocated:completed-allocated,quality:inspected?{inspected,defective,defectRate:defective/inspected}:null,models:d.productionPlan.map(p=>({...p,actual:assigned.filter(a=>a.model===p.model).reduce((n,a)=>n+a.quantity,0),allocationKnown:assigned.length>0})),dates:[...new Set(rows.map(r=>r.date))].sort()};
}
function forecast(input){
 const d=validate(input.dataset),days=input.days,extraDowntime=input.extraDowntime,speedup=input.speedup;
 if(!Number.isInteger(days)||days<1||days>366||!Array.isArray(extraDowntime)||extraDowntime.length!==3||!extraDowntime.every(n=>finite(n,0,d.schedule.hoursPerShift*d.schedule.shiftsPerDay*60))||!Array.isArray(speedup)||speedup.length!==3||!speedup.every(n=>finite(n,-.5,.5)))invalid('factory_invalid');
 const cost=input.cost;if(!cost||!['margin','downtimeHour','operating','investment'].every(k=>finite(cost[k],0,1e9)))invalid('factory_invalid');
 const samples=sections.map((section,i)=>{const r=d.performance.filter(x=>x.section===section);if(!r.length)invalid('factory_missing_stage');const daily=Object.values(r.reduce((o,x)=>(o[x.date]=(o[x.date]||0)+x.actual,o),{})),avg=daily.reduce((n,x)=>n+x,0)/daily.length;return {section,observedDays:daily.length,baselineDaily:avg,scenarioDaily:Math.max(0,avg*(1+speedup[i])*(1-extraDowntime[i]/(d.schedule.hoursPerShift*d.schedule.shiftsPerDay*60))),historicalMinimum:Math.min(...daily),historicalMaximum:Math.max(...daily)};});
 const baselineDaily=Math.min(...samples.map(s=>s.baselineDaily)),scenarioDaily=Math.min(...samples.map(s=>s.scenarioDaily)),bottleneck=samples.find(s=>s.scenarioDaily===scenarioDaily).section;
 const plan=d.productionPlan.reduce((n,p)=>n+p.quantity,0),additionalUnits=(scenarioDaily-baselineDaily)*days;
 const change=additionalUnits*cost.margin-extraDowntime.reduce((n,x)=>n+x,0)/60*days*cost.downtimeHour-cost.operating*days;
 const observed=overview(d);
 const availablePlanDays=d.planPeriod.start?Math.round((Date.parse(d.planPeriod.end)-Date.parse(d.planPeriod.start))/86400000)+1:null;
 const periodCapacity=availablePlanDays===null?null:scenarioDaily*availablePlanDays;
 // Allocation is a proposed proportional schedule, never reported as historical model output.
 const proposedMix=d.productionPlan.map(p=>({model:p.model,planned:p.quantity,proposedPerDay:plan?scenarioDaily*p.quantity/plan:0}));
 return {days,stages:samples,baselineDaily,scenarioDaily,bottleneck,baselineUnits:baselineDaily*days,scenarioUnits:scenarioDaily*days,additionalUnits,benefit:change,paybackDays:change>0?cost.investment/(change/days):null,estimatedDaysForPlan:scenarioDaily>0?Math.ceil(plan/scenarioDaily):null,availablePlanDays,periodCapacity,planGap:periodCapacity===null?null:periodCapacity-plan,proposedMix,observedAssembly:observed.completed,assumptions:{hoursPerShift:d.schedule.hoursPerShift,shiftsPerDay:d.schedule.shiftsPerDay,extraDowntime,speedup,cost,everyCalendarDayIsWorking:true},method:'Empirical daily means; steady-state serial flow limited by minimum stage throughput; no inferred buffers or double subtraction of historical downtime',limitedHistory:samples.some(s=>s.observedDays<30)};
}
const api={DEFAULT,sections,validate,overview,forecast};
if(typeof module!=='undefined')module.exports=api;else window.FactoryDomain=api;
})();
