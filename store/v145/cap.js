const {chromium,devices}=require('playwright');const L=process.argv[2]||'it';
(async()=>{const b=await chromium.launch();
const mk=async()=>{const c=await b.newContext({...devices['iPhone 14 Pro'],viewport:{width:393,height:852},deviceScaleFactor:3,locale:L==='it'?'it-IT':'en-GB'});
 await c.route(/open-meteo\.com/,r=>r.abort());const p=await c.newPage();p.on('pageerror',e=>console.log('ERR',String(e).slice(0,200)));return p};
const hide=async p=>{await p.addStyleTag({content:'#cytour,.toast,#toast,#scrim,#sheet{display:none!important}'});await p.evaluate(()=>{document.querySelectorAll('main div,main section').forEach(e=>{const t=e.innerText||'';if(e.children.length<12&&t.length<400&&/salvata solo su questo|saved only on this device|barca di esempio|sample boat|dati di fantasia|sample data/i.test(t))e.style.display='none'})})};
const S=async(p,n)=>{await hide(p);await p.waitForTimeout(300);await p.screenshot({path:`${L}_${n}.png`})};
const url=L==='it'?'index.html':'en.html';
let p=await mk();await p.goto(`http://localhost:8765/${url}?web=1`);await p.waitForTimeout(2500);await p.evaluate(()=>wbDemo());await p.waitForTimeout(3500);
await p.evaluate(()=>{closeSheet();V.tab='plancia';V.sub=null;render();scrollTo(0,0)});await p.waitForTimeout(2500);await S(p,'dash');
await p.locator('[data-act="goto"][data-v="altro:scadenze"]').first().click().catch(e=>console.log('no scad',e.message.slice(0,80)));await p.waitForTimeout(2000);await p.evaluate(()=>scrollTo(0,0));await S(p,'scad');
// charter
p=await mk();await p.goto(`http://localhost:8765/${url}?web=1`);await p.waitForSelector('[data-act="wblocal"]',{timeout:25000});
await p.click('[data-act="wblocal"]');await p.fill('#qs_name','Blu');await p.fill('#qs_owner','Marco');await p.click('[data-act="qsgo"]');await p.waitForFunction(()=>/Salva i tuoi dati|Save your data/.test(document.querySelector('#sheet')?.innerText||''),null,{timeout:15000}).catch(()=>{});await p.waitForTimeout(800);
await p.evaluate(()=>{closeSheet();PLS={plan:'pro',exp:'',trial:false,at:Date.now()};V.sub='charter';render()});await p.waitForTimeout(600);
await p.click('[data-act="chdemos"]');await p.waitForTimeout(800);await p.locator('#sheet .row').nth(1).click();await p.waitForTimeout(1500);
await p.waitForTimeout(1500);await p.evaluate(()=>{closeSheet();V.sub='charter';V.chv='cal';render();scrollTo(0,0)});await p.waitForTimeout(1500);await p.evaluate(()=>closeSheet());await p.waitForTimeout(800);await S(p,'chhome');
await p.evaluate(()=>{const g=[...document.querySelectorAll('#view *')].find(e=>/PROSSIMA USCITA|NEXT TRIP/i.test(e.innerText||'')&&(e.innerText||'').length<200&&e.parentElement.id==='view')||[...document.querySelectorAll('#view > *')].find(e=>/PROSSIMA USCITA|NEXT TRIP/i.test(e.innerText||''));let n=g;while(n&&n.parentElement){let sb=n.previousElementSibling;while(sb){if(!sb.matches('header,nav'))sb.style.display='none';sb=sb.previousElementSibling}n=n.parentElement;if(n.tagName==='MAIN'||n.tagName==='BODY')break}document.querySelectorAll('#cytour,.toast,#toast,#scrim,#sheet').forEach(e=>e.style.display='none');scrollTo(0,0)});await p.screenshot({path:`${L}_chcal.png`});
await b.close()})();
