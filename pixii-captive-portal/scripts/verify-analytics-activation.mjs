#!/usr/bin/env node
// Isolated, signed-router simulation. No production credentials/database.
// Optional --send-qa sends only a separate wifi_tracking_verification event
// to the existing public PostHog project, never production funnel events.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { chromium } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const origin = 'https://wifi.pixii.ai';
const fixture = JSON.parse(await fs.readFile(path.join(root, 'test/fixtures/opennds-level3-v10.3.json'), 'utf8'));
const buildResult = await build({entryPoints:[path.join(root,'src/index.ts')],bundle:true,write:false,format:'esm',platform:'browser',loader:{'.svg':'text','.webp':'binary'},logLevel:'silent'});
const captured = [];
const vendorDryRun = process.argv.includes('--vendor-dry-run');
const clickMode = process.argv.includes('--click');
const vendorRequests = [], cspViolations = [], scriptResults = [], browserErrors = [];
const qaRun = randomUUID();
const mf = new Miniflare(convertV4MiniflareOptions({modules:true,script:buildResult.outputFiles[0].text,compatibilityDate:'2026-09-23',cf:{country:'US'},
  d1Databases:['DB'],bindings:{ENVIRONMENT:'test',FAS_KEY:fixture.key,FORM_SIGNING_KEY:'synthetic-activation-signing-key-0123456789',BOOTSTRAP_HMAC_KEY:'synthetic-activation-bootstrap-key-0123456789',
    ANALYTICS_ENABLED:'true',ANALYTICS_ROLLOUT_AT:new Date().toISOString(),PRIVACY_US_REVIEWED:'true',POSTHOG_PROJECT_TOKEN:'synthetic-intercepted',PIXELS_ENABLED:String(vendorDryRun),META_ENABLED:String(vendorDryRun),GOOGLE_ENABLED:String(vendorDryRun)},
  serviceBindings:{ASSETS:async request=>{const pathname=new URL(request.url).pathname;const file=path.resolve(root,'public','.'+pathname);if(!file.startsWith(path.join(root,'public')+path.sep))return new Response('',{status:404});try{return new Response(await fs.readFile(file),{headers:{'Content-Type':pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.webp')?'image/webp':pathname.endsWith('.mp4')?'video/mp4':pathname.endsWith('.woff2')?'font/woff2':'application/octet-stream'}});}catch{return new Response('',{status:404});}}},
  outboundService:async request=>{assert.equal(new URL(request.url).hostname,'us.i.posthog.com');const payload=await request.json();captured.push(...payload.batch);return new Response('1');}
}));
let browser;
try {
  const db=await mf.getD1Database('DB');
  for(const file of (await fs.readdir(path.join(root,'migrations'))).filter(f=>f.endsWith('.sql')).sort()) {
    const sql=(await fs.readFile(path.join(root,'migrations',file),'utf8')).replace(/^\s*--.*$/gm,'');
    for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
  }
  const now=new Date().toISOString();
  await db.prepare("INSERT INTO events VALUES('evt_qa','qa','QA','America/Los_Angeles',?,'2030-01-01',365,?)").bind(now,now).run();
  await db.prepare("INSERT INTO routers VALUES('rtr_qa','evt_qa','gl-xe3000-stock-v1',?,?,1,?,?)").bind(fixture.fields.gatewayname,fixture.gatewayHash,now,now).run();
  async function authmon(payload) {
    const encoded=Buffer.from(payload).toString('base64');
    const signature=createHmac('sha256',fixture.key).update(`view\n${fixture.gatewayHash}\n${encoded}`).digest('hex');
    return mf.dispatchFetch(origin+'/router/fas',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({auth_get:'view',gatewayhash:fixture.gatewayHash,payload:encoded,signature})});
  }
  browser=await chromium.launch({headless:!process.argv.includes('--headed')});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',error=>browserErrors.push(error.message));
  page.on('console',message=>{if((['warning','error'].includes(message.type())||message.text().includes('Bot traffic'))&&!message.text().includes('Content Security Policy'))browserErrors.push(message.text().slice(0,500));});
  page.on('response',r=>{if(r.request().resourceType()==='script'&&!r.url().startsWith(origin))scriptResults.push({url:new URL(r.url()).origin+new URL(r.url()).pathname,status:r.status()});});
  await page.exposeFunction('qaCsp',value=>cspViolations.push(value));
  await page.addInitScript(()=>document.addEventListener('securitypolicyviolation',event=>window.qaCsp({directive:event.violatedDirective,blocked:event.blockedURI})));
  let completeAt=0,startedAt=0,connectedAt=0,destination='';
  await page.context().route(origin+'/**',async route=>{
    const req=route.request();
    const response=await mf.dispatchFetch(req.url(),{method:req.method(),headers:req.headers(),body:req.postDataBuffer()??undefined});
    if(req.url().endsWith('/ad/start')&&response.ok&&!startedAt)startedAt=Date.now();
    if(req.url().endsWith('/ad/complete')&&response.ok)completeAt=Date.now();
    if(new URL(req.url()).pathname==='/connected')connectedAt=Date.now();
    await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  await page.context().route('https://www.pixii.ai/**',async route=>{await route.fulfill({contentType:'text/html',body:'<h1>Website arrival QA</h1>'});});
  // Load real vendor JavaScript but intercept collectors: never add a simulated
  // router client to production advertising audiences.
  await page.context().route('https://**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    if(['wifi.pixii.ai','www.pixii.ai'].includes(url.hostname))return route.fallback();
    if(request.resourceType()==='script')return route.continue();
    vendorRequests.push({url:request.url(),body:request.postData()??''});
    await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*'}});
  });
  const fasUrl=new URL('/router/fas',origin);fasUrl.searchParams.set('fas',fixture.fas);fasUrl.searchParams.set('iv',fixture.iv);
  await page.goto(fasUrl.href);
  const adCompleted=page.waitForResponse(r=>r.url().endsWith('/ad/complete')&&r.status()===200,{timeout:25000});
  await page.fill('#fullName','ACTIVATION QA - isolated');await page.fill('#email','activation-qa@example.com');await page.fill('#phone','4155550138');await page.check('#consent');await page.click('#connect-button');
  await adCompleted;
  await page.waitForFunction(()=>document.querySelector('#status-message')?.textContent==='Finishing connection…',{},{timeout:20000});
  assert.ok(completeAt-startedAt>=6900,'ad must wait seven wall-clock seconds');
  const beforeAck=await db.prepare('SELECT authorization_status,ad_visible_ms FROM registrations').first();
  assert.equal(beforeAck.authorization_status,'pending');assert.equal(beforeAck.ad_visible_ms,7000);
  assert.equal(vendorRequests.length,0,'no advertising before authenticated router acknowledgement');
  assert.equal(scriptResults.length,0,'no vendor libraries before authenticated router acknowledgement');
  const list=await(await authmon('none')).text();assert.ok(list.includes(fixture.rhid),'router list contains only released signup');
  await authmon('* '+fixture.rhid);
  if(clickMode){
    await page.waitForURL(origin+'/connected',{timeout:10000});await page.waitForTimeout(3000);
    // Exercise the real click handler but simulate the OS rejecting its native
    // browser scheme. Follow the existing HTTPS fallback; no native-OS claim.
    await page.evaluate(()=>document.addEventListener('click',event=>event.preventDefault(),{capture:true,once:true}));
    await page.locator('.arrow-cta').click();await page.waitForTimeout(500);await page.locator('#open-here').click();
  }
  await page.waitForURL('https://www.pixii.ai/**',{timeout:15000});
  if(!clickMode)assert.ok(Date.now()-connectedAt>=4700,'final redirect keeps five seconds');
  destination=page.url();
  assert.ok(destination.includes('utm_campaign=amazon_unboxed_sf_2026'));
  const token=new URLSearchParams(new URL(destination).hash.slice(1)).get('pixii_wifi');assert.ok(token);
  const redeem=()=>mf.dispatchFetch(origin+'/attribution/redeem',{method:'POST',headers:{Origin:'https://www.pixii.ai','Content-Type':'application/json'},body:JSON.stringify({token})});
  const redeemed=await(await redeem()).json();assert.equal(redeemed.suppressed,false);assert.equal((await redeem()).status,410);
  await authmon('* '+fixture.rhid);
  const events=(await db.prepare('SELECT event,count(*) AS n FROM analytics_outbox GROUP BY event ORDER BY event').all()).results;
  assert.deepEqual(events,[{event:'wifi_connected',n:1},{event:'wifi_form_viewed',n:1},{event:'wifi_pixii_open_requested',n:1},{event:'wifi_signup_completed',n:1}]);
  assert.ok(captured.length>=4);
  assert.doesNotMatch(JSON.stringify(captured),/activation-qa@example|4155550138|clientmac|clientip|fas=|token=|registration_id/);
  const final=await db.prepare('SELECT authorization_status,ad_visible_ms FROM registrations').first();assert.equal(final.authorization_status,'acknowledged');
  const summary={qaRun,isolatedRouterSimulation:true,productionRouterVerified:false,adElapsedMs:completeAt-startedAt,visibleMs:final.ad_visible_ms,openMethod:clickMode?'click':'automatic',connectionToArrivalMs:Date.now()-connectedAt,events,handoffRedeemed:true,replayRejected:true,sensitiveDataAbsent:true};
  if(vendorDryRun){
    const traffic=decodeURIComponent(JSON.stringify([...vendorRequests,...cspViolations]));assert.ok(!traffic.includes(token),'handoff token never enters a vendor request');
    assert.doesNotMatch(traffic,/activation-qa@example|4155550138|fas=|token=|\/router\/fas\/wait\//,'vendor requests must not include router-session references');
    summary.vendorRequests=vendorRequests.map(({url,body})=>{const u=new URL(url);const params=new URLSearchParams(u.search.slice(1)+'&'+body);return {host:u.hostname,path:u.pathname,event:params.get('ev')??params.get('en'),destination:params.get('id')??params.get('tid')};});
    summary.cspViolations=cspViolations.map(v=>({directive:v.directive,blocked:new URL(v.blocked).origin+new URL(v.blocked).pathname}));
    summary.scriptResults=scriptResults;
    summary.browserErrors=browserErrors;
    assert.deepEqual(summary.cspViolations,[],'verified vendor dependencies are permitted');
    assert.deepEqual(browserErrors,[],'no browser runtime errors');
    for(const id of ['G-FRVEG530RV','G-E1JECZVBRZ','AW-18294844879'])assert.ok(summary.vendorRequests.some(r=>r.destination===id&&r.event==='wifi_connected'),'Google Wi-Fi event for '+id);
    // Meta deliberately filters headless bot user agents; use --headed to test it.
    if(process.argv.includes('--headed'))assert.ok(summary.vendorRequests.some(r=>r.destination==='571544668799364'&&r.event==='WifiConnected'),'Meta Wi-Fi event');
  }
  if(process.argv.includes('--send-qa')) {
    const website=await(await fetch('https://www.pixii.ai/')).text();
    const projectKey=website.match(/phc_[A-Za-z0-9]+/)?.[0];assert.ok(projectKey,'existing public project ingestion key');
    const batch=[...new Map(captured.map(e=>[e.uuid,e])).values()].map(e=>({...e,event:'wifi_tracking_verification',distinct_id:'wifi-qa:'+qaRun,properties:{...e.properties,wifi_source:'team_test',wifi_test:true,qa_run_id:qaRun,qa_original_event:e.event,$host:'localhost'}}));
    // Original serializer/envelope, separate QA event: no real leads, customers or audience.
    for(let attempt=0;attempt<2;attempt++){const r=await fetch('https://us.i.posthog.com/batch/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:projectKey,batch})});assert.ok(r.ok,'PostHog ingestion accepts QA batch');await r.body?.cancel();}
    summary.posthogAccepted=true;summary.qaEventIds=batch.map(e=>e.uuid);summary.deliveryAttempts=2;
  }
  console.log(JSON.stringify(summary));
} finally {await browser?.close();await mf.dispose();}
