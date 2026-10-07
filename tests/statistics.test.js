const {test}=require('node:test'),assert=require('node:assert/strict'),ExcelJS=require('exceljs'),F=require('../src/domain/factory.cjs'),S=require('../src/server/statistics.cjs');
test('daily filter and typed Excel export reconcile with source data',async()=>{
 const bytes=await S.workbook({dataset:F.DEFAULT,from:'2026-10-01',to:'2026-10-01',language:'ru'}),w=new ExcelJS.Workbook();await w.xlsx.load(bytes);
 assert.equal(w.worksheets.length,4);const summary=w.worksheets[0],daily=w.worksheets[1];assert.equal(summary.getCell('B4').value,122);assert.equal(summary.getCell('B5').value,122);assert.equal(summary.getCell('B7').value,65);
 assert.equal(daily.rowCount,2);assert.ok(daily.getCell('A2').value instanceof Date);assert.equal(daily.getCell('C2').value,122);assert.equal(w.worksheets[2].rowCount,4);assert.equal(w.worksheets[3].rowCount,3);
 assert.equal(S.daily(F.DEFAULT,'2026-10-03','2026-10-04').days.length,0);assert.throws(()=>S.daily(F.DEFAULT,'2026-10-02','2026-10-01'));
});
