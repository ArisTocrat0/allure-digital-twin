'use strict';
const {spawn}=require('node:child_process'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const server=spawn(process.execPath,['src/server/main.cjs'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:'3120',DB_PATH:path.join(__dirname,'../artifacts/factory-'+Date.now()+'.sqlite')},windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
 try{
 await new Promise((r,j)=>{server.stdout.once('data',r);server.once('error',j);});
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:3120');await page.locator('#auth-switch').click();await page.locator('#auth-name').fill('Factory Tester');await page.locator('#auth-email').fill('factory@example.test');await page.locator('#auth-password').fill('factory-password-2026');await page.locator('#auth-submit').click();await page.locator('nav').waitFor();await page.evaluate(()=>location.hash='caseOverview');await page.locator('#factory-filter').waitFor();
 assert.deepEqual(await page.locator('.stats strong').allTextContents(),['241','242','-1','150']);
 await page.locator('#factory-from').fill('2026-10-01');await page.locator('#factory-to').fill('2026-10-01');await page.locator('#factory-filter').click();assert.equal(await page.locator('.stats strong').first().textContent(),'122');
 await page.evaluate(h=>location.hash=h,'#caseData');await page.locator('[data-case-path="performance.0.actual"]').fill('117');await page.locator('#factory-save').click();await page.waitForFunction(()=>document.querySelector('#factory-status').textContent.length>0);await page.reload();await page.locator('#factory-save').waitFor();assert.equal(await page.locator('[data-case-path="performance.0.actual"]').inputValue(),'117');
 await page.locator('#case-forecast').click();await page.locator('#case-report').waitFor();assert.ok((await page.locator('main').innerText()).includes('Chevrolet Onix'));
 await page.locator('[data-case-path="performance.0.line"]').fill('');await page.locator('#factory-save').click();await page.waitForFunction(()=>document.querySelector('#factory-status').textContent.includes('Проверьте'));assert.equal(await page.locator('[data-case-path="performance.0.line"]').inputValue(),'');
 await page.evaluate(h=>location.hash=h,'#caseOverview');assert.equal(await page.locator('.stats strong').first().textContent(),'241');
 for(const locale of ['ru','en','kk']){await page.locator('#language').selectOption(locale);await page.waitForFunction(l=>document.documentElement.lang===l,locale);await page.evaluate(h=>location.hash=h,'#caseLine');await page.locator('.factory-flow').waitFor();assert.equal(await page.locator('.factory-flow .station').count(),3);assert.ok(!(await page.locator('main').innerText()).includes('undefined'));await page.screenshot({path:'artifacts/factory-'+locale+'.png',fullPage:true});}
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'artifacts/factory-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS factory UI: source totals, filters, save/reload, invalid draft recovery, forecast, 3 locales and mobile');
 }finally{await browser?.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
