'use strict';
const $=id=>document.getElementById(id);
const state={photos:[],selected:0,mode:'single',style:'frame',layout:'grid',loading:false,exporting:false};
const EXIF_TAGS=['Make','Model','LensModel','FocalLength','FNumber','ExposureTime','ISO','DateTimeOriginal'];
const scriptPromises=new Map();
function loadScript(src,test){
 if(test())return Promise.resolve(test());
 if(!scriptPromises.has(src))scriptPromises.set(src,new Promise((resolve,reject)=>{
  const el=document.createElement('script');let timer;
  const fail=()=>{clearTimeout(timer);el.remove();reject(new Error('library'))};
  el.src=src;el.onload=()=>{clearTimeout(timer);test()?resolve(test()):fail()};el.onerror=fail;
  timer=setTimeout(fail,30000);document.head.append(el);
 }).catch(e=>{scriptPromises.delete(src);throw e}));
 return scriptPromises.get(src);
}
function settings(){
 const s={};for(const id of ['signature','detail','font','position','color','background','format','fit'])s[id]=$(id).value;
 for(const id of ['size','opacity','margin','gap','aspect','resolution'])s[id]=Number($(id).value);
 for(const id of ['autoExif','showCamera','showLens','showExposure','showDate'])s[id]=$(id).checked;
 return s;
}
function selected(){return state.photos[state.selected]}
function formatExif(tags={}){
 const clean=v=>typeof v==='string'?v.trim().replace(/\0/g,''):'';
 const num=v=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):null;
 const round=v=>String(Math.round(v*100)/100);
 let make=clean(tags.Make),model=clean(tags.Model);
 const camera=model?(model.toLowerCase().startsWith(make.toLowerCase())?model:[make,model].filter(Boolean).join(' ')):make;
 const f=num(tags.FocalLength),a=num(tags.FNumber),t=num(tags.ExposureTime),iso=num(tags.ISO);
 const exposure=[f?round(f)+' mm':'',a?'f/'+round(a):'',t?(t<1?'1/'+Math.round(1/t)+' s':round(t)+' s'):'',iso?'ISO '+iso:''].filter(Boolean).join(' · ');
 let date='';const d=tags.DateTimeOriginal;
 if(d instanceof Date&&!Number.isNaN(d.getTime())){const p=n=>String(n).padStart(2,'0');date=d.getFullYear()+'.'+p(d.getMonth()+1)+'.'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())}
 else if(typeof d==='string'){const m=d.match(/^(\d{4})[:-](\d\d)[:-](\d\d)[ T](\d\d):(\d\d)/);if(m)date=m[1]+'.'+m[2]+'.'+m[3]+' '+m[4]+':'+m[5]}
 return {camera,lens:clean(tags.LensModel),exposure,date};
}
async function readExif(file){
 try{
  const exifr=await loadScript('./vendor/exifr.js',()=>window.exifr);
  const tags=await exifr.parse(file,{pick:EXIF_TAGS,gps:false,reviveValues:false});
  const data=formatExif(tags||{});return {data,status:Object.values(data).some(Boolean)?'ready':'none'};
 }catch{return {data:formatExif(),status:'error'}}
}
function exifLines(p,s){if(!s.autoExif||!p)return [];return [['showCamera','camera'],['showLens','lens'],['showExposure','exposure'],['showDate','date']].filter(([toggle,key])=>s[toggle]&&p.exif.data[key]).map(([,key])=>p.exif.data[key])}
async function isHeicFile(file){
 if(/\.hei[cf]$/i.test(file.name)||/^image\/(heic|heif)(-sequence)?$/i.test(file.type))return true;
 const b=new Uint8Array(await file.slice(0,64).arrayBuffer()),text=String.fromCharCode(...b);
 return text.slice(4,8)==='ftyp'&&/heic|heix|hevc|hevx|mif1|msf1/.test(text.slice(8));
}
async function decodeImage(blob){
 const url=URL.createObjectURL(blob),im=new Image();
 try{im.src=url;await im.decode();return im}finally{URL.revokeObjectURL(url)}
}
async function readImage(file){
 if(file.size>80*1024*1024)throw Error('80MBを超えています');
 const heic=await isHeicFile(file);
 if(!heic&&!['image/jpeg','image/png','image/webp'].includes(file.type)&&!/\.(jpe?g|png|webp)$/i.test(file.name))throw Error('対応していない形式です');
 let im;try{im=await decodeImage(file)}catch(e){
  if(!heic)throw Error('写真を読み込めませんでした');
  let convert;try{convert=await loadScript('./vendor/heic-to.js',()=>window.HeicTo)}catch{throw Error('HEIC変換機能を取得できませんでした')}
  try{im=await decodeImage(await convert({blob:file,type:'image/png'}))}catch{throw Error('このHEICを変換できませんでした')}
 }
 if(im.naturalWidth*im.naturalHeight>65000000)throw Error('6500万画素を超えています');
 return im;
}
function thumbnail(im){const c=document.createElement('canvas'),r=Math.min(1,180/Math.max(im.naturalWidth,im.naturalHeight));c.width=Math.max(1,Math.round(im.naturalWidth*r));c.height=Math.max(1,Math.round(im.naturalHeight*r));c.getContext('2d').drawImage(im,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.8)}
async function addFiles(files){
 if(state.loading||state.exporting){$('status').textContent='処理が終わってから写真を追加してください。';return}
 const list=Array.from(files),room=6-state.photos.length;
 if(!room){$('status').textContent='追加できる写真は6枚までです。写真を削除してから追加してください。';return}
 if(!list.length)return;state.loading=true;syncControls();
 let added=0;const errors=[];if(list.length>room)errors.push('6枚を超える分は追加していません');
 try{
  for(const file of list.slice(0,room)){
   $('status').textContent=file.name+' を読み込んでいます…';
   // Parse the original file, before any HEIC conversion can remove its metadata.
   const [imageResult,exifResult]=await Promise.allSettled([readImage(file),readExif(file)]);
   if(imageResult.status==='rejected'){errors.push(file.name+'：'+imageResult.reason.message);continue}
   const im=imageResult.value,total=state.photos.reduce((n,p)=>n+p.image.naturalWidth*p.image.naturalHeight,0)+im.naturalWidth*im.naturalHeight;
   if(total>100000000){errors.push(file.name+'：写真の合計が1億画素を超えるため追加できません');continue}
   state.photos.push({name:file.name,image:im,thumb:thumbnail(im),x:50,y:50,exif:exifResult.status==='fulfilled'?exifResult.value:{data:formatExif(),status:'error'}});
   state.selected=state.photos.length-1;added++;refreshPhotos();syncExif();draw();
  }
  $('status').textContent=[added?added+'枚の写真を追加しました。':'',...errors].join(' ');
 }finally{state.loading=false;syncControls();refreshPhotos()}
}
function syncControls(){
 $('empty').hidden=state.photos.length>0;
 $('singleControls').hidden=state.mode!=='single';$('collageControls').hidden=state.mode!=='collage';
 $('positionControl').hidden=state.mode==='collage';
 $('position').disabled=['center'].includes(state.style);
 for(const i of [2,3])$('position').options[i].disabled=['frame','film'].includes(state.style);
 if(['frame','film'].includes(state.style)&&$('position').value.startsWith('t'))$('position').value='b'+$('position').value[1];
 $('cropControls').hidden=state.mode!=='collage'||$('fit').value!=='cover';
 $('download').disabled=state.loading||state.exporting||!state.photos.length||(state.mode==='collage'&&state.photos.length<2);
 for(const id of ['add','choose'])$(id).disabled=state.loading||state.exporting;
 $('count').textContent=state.photos.length+' / 6';
 $('exportHint').textContent=state.mode==='collage'?'コラージュは指定した長辺のサイズで保存します。':'1枚の写真は元の解像度で保存。フレームは外側に追加します。';
 for(const id of ['size','opacity','margin','gap','focalX','focalY'])$(id+'Value').value=$(id).value+'%';
 if(state.mode==='collage'&&state.photos.length===1&&!state.loading)$('status').textContent='コラージュにするには、もう1枚写真を追加してください。';
}
function refreshPhotos(){
 $('photos').replaceChildren();state.photos.forEach((p,i)=>{
  const card=document.createElement('div');card.className='photo-card';
  const b=document.createElement('button');b.className='photo-select';b.setAttribute('aria-pressed',String(i===state.selected));b.setAttribute('aria-label',p.name+' を選択');
  const img=document.createElement('img');img.src=p.thumb;img.alt=p.name;b.append(img);const number=document.createElement('span');number.textContent=i+1;b.append(number);
  b.onclick=()=>{state.selected=i;$('focalX').value=p.x;$('focalY').value=p.y;refreshPhotos();syncExif();syncControls();draw()};card.append(b);
  const actions=document.createElement('div');actions.className='photo-actions';
  for(const [text,delta,title] of [['←',-1,'前へ移動'],['→',1,'後ろへ移動'],['×',0,'削除']]){
   const btn=document.createElement('button');btn.textContent=text;btn.setAttribute('aria-label',p.name+' を'+title);btn.disabled=state.loading||state.exporting||(delta===-1&&i===0)||(delta===1&&i===state.photos.length-1);
   btn.onclick=()=>{if(state.loading||state.exporting)return;const active=selected();if(!delta){state.photos.splice(i,1);state.selected=Math.max(0,Math.min(state.photos.length-1,state.photos.indexOf(active)))}else{const j=i+delta;[state.photos[i],state.photos[j]]=[state.photos[j],state.photos[i]];state.selected=state.photos.indexOf(active)}refreshPhotos();syncExif();syncControls();draw()};actions.append(btn);
  }
  card.append(actions);$('photos').append(card);
 });
}
function syncExif(){
 const p=selected();$('exifData').replaceChildren();
 $('exifStatus').textContent=!p?'写真から自動で読み取ります。':p.exif.status==='ready'?'選択中の写真から読み取りました。':p.exif.status==='none'?'この写真に撮影情報はありません。':'撮影情報を読み取れませんでした。写真の編集はできます。';
 if(p){$('focalX').value=p.x;$('focalY').value=p.y;for(const [key,label] of [['camera','機種'],['lens','レンズ'],['exposure','設定'],['date','日時']]){if(!p.exif.data[key])continue;const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=p.exif.data[key];$('exifData').append(dt,dd)}}
}
function fontFace(choice){return choice==='serif'||choice==='italic'?'Georgia, "Times New Roman", serif':choice==='mono'?'"Courier New", monospace':'-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif'}
function fontString(size,choice){return (choice==='italic'?'italic ':'')+size+'px '+fontFace(choice)}
function contrast(bg){const h=bg.replace('#',''),r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);return (r*.299+g*.587+b*.114)>155?'#20251f':'#fafbf8'}
function inkFor(s,onPaper){return s.color==='white'?'#fff':s.color==='black'?'#141714':onPaper?contrast(s.background):'#fff'}
function drawDots(x,text,left,top,size,ink){
 const c=document.createElement('canvas'),a=c.getContext('2d');a.font='bold 70px monospace';c.width=Math.max(1,Math.ceil(a.measureText(text).width+6));c.height=90;a.font='bold 70px monospace';a.fillText(text,3,70);
 const pixels=a.getImageData(0,0,c.width,c.height).data,scale=size/75;x.fillStyle=ink;
 for(let yy=2;yy<c.height;yy+=5)for(let xx=2;xx<c.width;xx+=5)if(pixels[(yy*c.width+xx)*4+3]>90){x.beginPath();x.arc(left+xx*scale,top+yy*scale,1.6*scale,0,Math.PI*2);x.fill()}
}
function textMetrics(x,s,lines,size,dot=false){
 const sig=s.signature.trim(),detail=s.detail.trim();const choice=s.font;
 x.font=fontString(size,choice);let width=sig?x.measureText(sig).width:0;
 if(dot&&sig){x.font='bold 70px monospace';width=(x.measureText(sig).width+6)*size/75}
 const small=size*.43,rows=[detail,...lines].filter(Boolean);x.font=fontString(small,'sans');for(const row of rows)width=Math.max(width,x.measureText(row).width);
 return {width:Math.max(1,width),height:(sig?size*1.35:0)+rows.length*small*1.55,sig,rows,small,size,choice,dot};
}
function paintText(x,m,left,top,maxW,maxH,ink,opacity,align='left'){
 if(!m.height)return;const k=Math.min(1,maxW/m.width,maxH/m.height);x.save();x.translate(left,top);x.scale(k,k);x.fillStyle=ink;x.globalAlpha=opacity;x.textBaseline='top';
 let yy=0;if(m.sig){x.font=fontString(m.size,m.choice);const offset=align==='center'?(m.width-(m.dot?m.width:x.measureText(m.sig).width))/2:0;if(m.dot)drawDots(x,m.sig,offset,0,m.size,ink);else x.fillText(m.sig,offset,0);yy=m.size*1.35}
 x.font=fontString(m.small,'sans');for(const row of m.rows){const offset=align==='center'?(m.width-x.measureText(row).width)/2:0;x.fillText(row,offset,yy);yy+=m.small*1.55}x.restore();
}
function canvasSetup(c,w,h,preview){const k=preview?Math.min(1,1500/Math.max(w,h)):1;c.width=Math.max(1,Math.round(w*k));c.height=Math.max(1,Math.round(h*k));const x=c.getContext('2d');x.scale(k,k);return x}
function renderSingle(c,preview,s){
 const p=selected(),im=p.image,w=im.naturalWidth,h=im.naturalHeight,base=Math.min(w,h),pad=base*s.margin/100,fs=base*s.size/100,style=state.style;
 const gallery=style==='frame',film=style==='film',framed=gallery||film;
 const calc=document.createElement('canvas').getContext('2d');const ts={...s,font:style==='editorial'?'serif':s.font};
 const m=textMetrics(calc,ts,exifLines(p,s),fs,style==='dot');const band=framed?Math.max(pad*1.4,m.height+pad):0,W=w+(gallery?pad*2:0),H=h+(gallery?pad*2:0)+band;
 const x=canvasSetup(c,W,H,preview);if(framed||s.format==='image/jpeg'){x.fillStyle=framed?s.background:'#fff';x.fillRect(0,0,W,H)}
 const ox=gallery?pad:0,oy=gallery?pad:0;x.drawImage(im,ox,oy,w,h);
 const ink=inkFor(s,framed);let availW=w-pad*2,availH=h-pad*2;
 if(gallery)availW=w;if(framed)availH=band-pad*.6;
 const extra=style==='label'?fs*.45:0;
 if(style==='vertical')[availW,availH]=[h-pad*2,w-pad*2];
 const fit=Math.min(1,(availW-extra)/m.width,availH/Math.max(1,m.height)),bw=m.width*fit,bh=m.height*fit;
 let left=s.position.endsWith('r')?W-ox-pad-bw:ox+pad,top=s.position.startsWith('t')?oy+pad:oy+h-pad-bh;
 if(framed){left=s.position.endsWith('r')?W-(gallery?pad:pad)-bw:pad;top=oy+h+(gallery?pad:0)+(band-bh)/2}
 if(style==='center'){left=(W-bw)/2;top=(H-bh)/2}
 if(style==='corners'){const len=base*.03;x.save();x.strokeStyle=ink;x.globalAlpha=s.opacity/100;x.lineWidth=Math.max(1,base*.001);for(const [cx,cy,dx,dy] of [[pad*.5,pad*.5,1,1],[w-pad*.5,pad*.5,-1,1],[pad*.5,h-pad*.5,1,-1],[w-pad*.5,h-pad*.5,-1,-1]]){x.beginPath();x.moveTo(cx+len*dx,cy);x.lineTo(cx,cy);x.lineTo(cx,cy+len*dy);x.stroke()}x.restore()}
 if(film){x.save();x.globalAlpha=s.opacity/100;x.fillStyle=ink;const hole=base*.005;for(let xx=pad;xx<W-pad;xx+=hole*4){x.fillRect(xx,h+hole,hole*2,hole);x.fillRect(xx,H-hole*2,hole*2,hole)}x.restore()}
 if(style==='vertical'){x.save();left=s.position.endsWith('r')?w-pad-bh:pad;top=s.position.startsWith('t')?pad:h-pad-bw;x.translate(left,top+bw);x.rotate(-Math.PI/2);paintText(x,m,0,0,availW,availH,ink,s.opacity/100);x.restore()}
 else{if(style==='label'&&m.height){x.save();x.fillStyle=ink;x.globalAlpha=s.opacity/100;x.fillRect(left,top,Math.max(1,fs*.04),bh);x.restore();if(s.position.endsWith('r'))left-=extra;left+=extra}paintText(x,m,left,top,availW-extra,availH,ink,s.opacity/100,style==='center'?'center':'left')}
 return {width:Math.round(W),height:Math.round(H)};
}
function collageSlots(n,layout,x,y,w,h,gap){
 if(n===1)return [{x,y,w,h}];
 if(layout==='editorial'){
  const hero=(w-gap)*.6,slots=[{x,y,w:hero,h}],rest=n-1,cols=rest>3?2:1,rows=Math.ceil(rest/cols),cw=(w-hero-gap-gap*(cols-1))/cols,ch=(h-gap*(rows-1))/rows;
  for(let i=0;i<rest;i++)slots.push({x:x+hero+gap+(i%cols)*(cw+gap),y:y+Math.floor(i/cols)*(ch+gap),w:cw,h:ch});return slots;
 }
 const cols=layout==='stack'?1:layout==='triptych'?Math.min(3,n):layout==='contact'?Math.min(3,n):Math.min(2,n),rows=Math.ceil(n/cols),cw=(w-gap*(cols-1))/cols,ch=(h-gap*(rows-1))/rows;
 return Array.from({length:n},(_,i)=>{const row=Math.floor(i/cols),items=Math.min(cols,n-row*cols),offset=(w-(items*cw+(items-1)*gap))/2;return {x:x+offset+(i%cols)*(cw+gap),y:y+row*(ch+gap),w:cw,h:ch}});
}
function paintImage(x,p,r,fit){
 const im=p.image,iw=im.naturalWidth,ih=im.naturalHeight;
 if(fit==='cover'){const k=Math.max(r.w/iw,r.h/ih),sw=r.w/k,sh=r.h/k,sx=(iw-sw)*p.x/100,sy=(ih-sh)*p.y/100;x.drawImage(im,sx,sy,sw,sh,r.x,r.y,r.w,r.h)}
 else{const k=Math.min(r.w/iw,r.h/ih),dw=iw*k,dh=ih*k;x.drawImage(im,r.x+(r.w-dw)/2,r.y+(r.h-dh)/2,dw,dh)}
}
function renderCollage(c,preview,s){
 const a=s.aspect,long=s.resolution,W=Math.round(a>=1?long:long*a),H=Math.round(a>=1?long/a:long),base=Math.min(W,H),pad=base*s.margin/100,gap=base*s.gap/100,ink=inkFor(s,true);
 const x=canvasSetup(c,W,H,preview);x.fillStyle=s.background;x.fillRect(0,0,W,H);
 const title=textMetrics(x,s,[],base*s.size/100),footer=title.height?Math.min(H*.2,title.height+pad*.7):0;
 const slots=collageSlots(state.photos.length,state.layout,pad,pad,W-pad*2,H-pad*2-footer,gap);
 slots.forEach((r,i)=>{
  const p=state.photos[i],lines=exifLines(p,s);if(state.layout==='contact')lines.unshift(String(i+1).padStart(2,'0'));
  const caption=textMetrics(x,{...s,signature:'',detail:'',font:'sans'},lines,base*s.size/100*.65);
  const capScale=Math.min(1,r.w/caption.width,(r.h*.26)/Math.max(caption.height,1)),capH=caption.height*capScale,spacing=capH?base*.008:0;
  paintImage(x,p,{...r,h:Math.max(1,r.h-capH-spacing)},s.fit);
  if(capH)paintText(x,caption,r.x,r.y+r.h-capH,r.w,capH,ink,s.opacity/100);
 });
 if(title.height)paintText(x,title,pad,H-pad-footer+pad*.7,W-pad*2,footer-pad*.7,ink,s.opacity/100);
 return {width:W,height:H};
}
function render(c,preview=false){if(!state.photos.length)return;const s=settings();return state.mode==='single'?renderSingle(c,preview,s):renderCollage(c,preview,s)}
function draw(){if(!state.photos.length){$('preview').width=$('preview').height=1;$('dimensions').textContent='写真を選んでください';return}try{const d=render($('preview'),true);$('dimensions').textContent=d.width.toLocaleString()+' × '+d.height.toLocaleString()+' px'}catch{$('status').textContent='プレビューを表示できませんでした。写真の枚数か出力サイズを減らしてください。'}}
let scheduled=false;function scheduleDraw(){if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;syncControls();draw()})}}
function choose(){if(state.loading||state.exporting)return;$('file').value='';$('file').click()}
$('choose').onclick=$('add').onclick=choose;$('file').onchange=e=>addFiles(e.target.files);
for(const b of document.querySelectorAll('[data-mode]'))b.onclick=()=>{state.mode=b.dataset.mode;for(const t of document.querySelectorAll('[data-mode]'))t.setAttribute('aria-pressed',String(t===b));syncControls();draw()};
for(const key of ['style','layout'])for(const b of document.querySelectorAll('[data-'+key+']'))b.onclick=()=>{state[key]=b.dataset[key];for(const t of document.querySelectorAll('[data-'+key+']'))t.setAttribute('aria-pressed',String(t===b));syncControls();draw()};
for(const el of document.querySelectorAll('aside input,aside select'))el.addEventListener('input',()=>{if(selected()&&['focalX','focalY'].includes(el.id))selected()[el.id==='focalX'?'x':'y']=Number(el.value);scheduleDraw()});
const stage=$('stage');stage.addEventListener('dragover',e=>{e.preventDefault();stage.classList.add('drag')});stage.addEventListener('dragleave',()=>stage.classList.remove('drag'));stage.addEventListener('drop',e=>{e.preventDefault();stage.classList.remove('drag');addFiles(e.dataTransfer.files)});
// Prevent an accidental drop outside the editor from navigating away from unsaved work.
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
$('download').onclick=async()=>{
 if(state.loading||state.exporting||!state.photos.length||(state.mode==='collage'&&state.photos.length<2))return;
 state.exporting=true;syncControls();refreshPhotos();$('status').textContent='画像を書き出しています…';const c=document.createElement('canvas');
 try{
  const mime=$('format').value,name=state.mode==='collage'?'collage':selected().name.replace(/\.[^.]+$/,'')+'-mark';
  render(c);const blob=await new Promise(resolve=>c.toBlob(resolve,mime,.96));if(!blob)throw Error('export');
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name+(mime==='image/png'?'.png':'.jpg');document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);$('status').textContent='画像を書き出しました。';
 }catch{$('status').textContent='書き出せませんでした。写真のサイズかコラージュの長辺を小さくして試してください。'}
 finally{c.width=c.height=1;state.exporting=false;syncControls();refreshPhotos()}
};
syncControls();
