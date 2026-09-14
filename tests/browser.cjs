const {chromium}=require('playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');const http=require('node:http');const path=require('node:path');
// A tiny real JPEG APP1/TIFF block makes automatic EXIF parsing testable without personal photos.
function withExif(jpeg,model){
 const camera=Buffer.from(model+'\0');const t=Buffer.alloc(26+camera.length);t.write('II',0);t.writeUInt16LE(42,2);t.writeUInt32LE(8,4);t.writeUInt16LE(1,8);t.writeUInt16LE(0x0110,10);t.writeUInt16LE(2,12);t.writeUInt32LE(camera.length,14);t.writeUInt32LE(26,18);camera.copy(t,26);
 const payload=Buffer.concat([Buffer.from('Exif\0\0'),t]),header=Buffer.alloc(4);header.writeUInt16BE(0xffe1,0);header.writeUInt16BE(payload.length+2,2);return Buffer.concat([jpeg.subarray(0,2),header,payload,jpeg.subarray(2)]);
}
(async()=>{
 const root=path.resolve('_site');const server=http.createServer((req,res)=>{const rel=decodeURIComponent(req.url.split('?')[0]),p=path.resolve(root,'.'+(rel==='/'?'/index.html':rel));if(!p.startsWith(root+path.sep)){res.writeHead(403).end();return}fs.readFile(p,(e,b)=>{if(e){res.writeHead(404).end();return}res.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':'text/html');res.end(b)})}).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const b=await chromium.launch({headless:true,args:['--no-sandbox']});const p=await b.newPage({viewport:{width:1440,height:1100}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
 try{
  await p.goto('http://127.0.0.1:'+server.address().port);await p.locator('#empty').waitFor();
  const bytes=await p.evaluate(()=>{let c=document.createElement('canvas');c.width=1200;c.height=800;let x=c.getContext('2d');x.fillStyle='#516653';x.fillRect(0,0,1200,800);return c.toDataURL('image/jpeg').split(',')[1]});const jpeg=Buffer.from(bytes,'base64');
  await p.locator('#file').setInputFiles([{name:'one.jpg',mimeType:'image/jpeg',buffer:withExif(jpeg,'Camera Alpha')},{name:'two.jpg',mimeType:'image/jpeg',buffer:withExif(jpeg,'Camera Beta')}]);
  await p.waitForFunction(()=>document.querySelector('#count').textContent==='2 / 6'&&!document.querySelector('#add').disabled,{},{timeout:60000});
  assert.match(await p.locator('#exifData').textContent(),/Camera Beta/);
  await p.locator('.photo-select').first().click();assert.match(await p.locator('#exifData').textContent(),/Camera Alpha/);assert(!/Camera Beta/.test(await p.locator('#exifData').textContent()));
  await p.locator('#signature').fill('Quiet moments');await p.locator('#detail').fill('日々の記録');
  for(const style of ['minimal','editorial','frame','label','vertical','corners','center','film','dot']){await p.locator('[data-style='+style+']').click();assert(await p.locator('#preview').evaluate(c=>c.width>0&&c.height>0))}
  await p.locator('[data-style=frame]').click();fs.mkdirSync('test-results',{recursive:true});await p.screenshot({path:'test-results/single-desktop.png',fullPage:true});
  await p.locator('[data-mode=collage]').click();
  for(const layout of ['grid','triptych','editorial','stack','contact']){await p.locator('[data-layout='+layout+']').click();for(const aspect of ['0.8','1','1.5','0.5625']){await p.locator('#aspect').selectOption(aspect);await p.waitForTimeout(35);assert(await p.locator('#preview').evaluate(c=>c.width>0&&c.height>0))}}
  await p.locator('#aspect').selectOption('0.8');await p.locator('[data-layout=editorial]').click();await p.locator('#fit').selectOption('cover');await p.locator('#focalX').evaluate(el=>{el.value='80';el.dispatchEvent(new Event('input',{bubbles:true}))});
  await p.locator('.photo-actions button[aria-label="one.jpg を後ろへ移動"]').click();assert.equal(await p.locator('.photo-select img').first().getAttribute('alt'),'two.jpg');
  for(const format of ['image/png','image/jpeg']){await p.locator('#format').selectOption(format);const [d]=await Promise.all([p.waitForEvent('download'),p.locator('#download').click()]);const location=await d.path();const file=fs.readFileSync(location);assert(file.length>1000);if(format==='image/png'){assert.equal(file.readUInt32BE(16),2400);assert.equal(file.readUInt32BE(20),3000)}else assert.equal(file.readUInt16BE(0),0xffd8)}
  await p.screenshot({path:'test-results/collage-desktop.png',fullPage:true});
  await p.locator('#file').setInputFiles({name:'none.jpg',mimeType:'image/jpeg',buffer:jpeg});await p.waitForFunction(()=>document.querySelector('#count').textContent==='3 / 6'&&!document.querySelector('#add').disabled);assert.match(await p.locator('#exifStatus').textContent(),/ありません/);assert.equal(await p.locator('#exifData').textContent(),'');
  const slots=await p.evaluate(()=>{const issues=[];for(let n=2;n<=6;n++)for(const l of ['grid','triptych','editorial','stack','contact']){const r=collageSlots(n,l,100,100,1800,2200,90);if(r.length!==n||r.some(s=>s.w<=0||s.h<=0||s.x<99||s.y<99||s.x+s.w>1901||s.y+s.h>2301))issues.push({n,l})}return issues});assert.deepEqual(slots,[]);
  await p.setViewportSize({width:390,height:844});await p.screenshot({path:'test-results/mobile.png',fullPage:true});assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
  await p.locator('#autoExif').uncheck();assert(await p.evaluate(()=>exifLines(selected(),settings()).length===0));
  assert.deepEqual(errors,[]);console.log('PASS: real browser EXIF read/isolation/absence, nine watermark styles, five collage layouts, all aspect ratios, ordering, focal point, JPEG/PNG export dimensions, mobile overflow, no browser exceptions.');
 }finally{await b.close();server.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
