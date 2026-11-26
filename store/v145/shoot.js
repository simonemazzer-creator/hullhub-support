const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1290,height:2796}});
for(const L of ['it','en'])for(const i of [1,2,3]){await p.goto('file://'+process.cwd()+`/slide_${L}_${i}.html`);await p.waitForTimeout(400);await p.screenshot({path:`out_${L}_1290_${i}.jpg`,type:'jpeg',quality:92})}
await b.close()})();
