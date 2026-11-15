const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../学习通AI助手.user.js'),'utf8');
const entry="    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
assert(source.includes(entry));
function fixture(markup='<div class="chapterVideoFaceMaskDiv"><img id="fcqrimg" src="https://mooc1.chaoxing.com/mock-qr.png"><p>二维码已过期</p><button>刷新二维码</button></div>'){
 const dom=new JSDOM(markup,
  {url:'https://mooc1.chaoxing.com/work/doHomeWorkNew',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,d=w.document;let clock=0;
 w.GM_getValue=(key,fallback)=>fallback;w.GM_setValue=()=>{};w.GM_getResourceText=()=> '{}';
 w.eval(source.replace(entry,'globalThis.verificationAPI={createCourseVerification};'));
 const image=d.getElementById('fcqrimg');
 for(const [key,value]of Object.entries({complete:true,naturalWidth:128,naturalHeight:128}))Object.defineProperty(image,key,{value,configurable:true});
 const verification=w.verificationAPI.createCourseVerification(d,{mode:'unlock',now:()=>clock});
 return {w,d,image,verification,tree:{documents:[d],inaccessible:[]},advance(ms){clock+=ms;},close(){verification.close();w.close();}};
}
{
 const f=fixture('<div class="maskDiv1 chapterVideoFaceQrMaskDiv"><div class="popDiv1 faceCollectQrPopVideo"><div class="ewmDiv"><img id="fcqrimg" src="https://mooc1.chaoxing.com/mock-qr.png"><div class="qrCover"></div><div class="qrCoverbar"><p><strong>二维码已失效</strong><br>请刷新后重新扫描</p><a class="u-btn2 reflashOrBtn" href="#"><span>刷新</span></a></div></div></div></div>');
 try{
  let clicks=0;f.d.querySelector('a').onclick=event=>{event.preventDefault();clicks++;};
  f.verification.poll(f.tree);const state=f.verification.pending;
  assert.equal(state.root,f.d.querySelector('.faceCollectQrPopVideo'));assert.equal(state.masks.length,1);
  assert.equal(state.expired,true);assert.equal(clicks,1);assert.equal(f.verification.passes,0);
  f.d.querySelector('.qrCoverbar').hidden=true;f.d.querySelector('.qrCover').hidden=true;
  f.image.dispatchEvent(new f.w.Event('load'));f.verification.poll(f.tree);
  assert.equal(state.expired,false);assert.equal(state.refreshSource,null);assert.equal(f.verification.passes,0);
 }finally{f.close();}
}
// This file is intentionally separate so the QR regression can be authorized on its own.
{
 const f=fixture();try{
  let clicks=0;const button=f.d.querySelector('button');button.onclick=()=>clicks++;
  f.verification.poll(f.tree);assert.equal(clicks,1);assert(f.verification.pending.refreshSource);
  f.advance(4999);f.verification.poll(f.tree);assert.equal(clicks,1);
  f.advance(1);f.verification.poll(f.tree);assert.equal(clicks,2);
  // The native page may reuse the same image URL; its load event completes refresh.
  f.d.querySelector('p').textContent='请扫码';f.image.dispatchEvent(new f.w.Event('load'));
  f.verification.poll(f.tree);assert.equal(f.verification.pending.refreshSource,null);assert.equal(f.verification.passes,0);
  f.image.hidden=true;f.verification.poll(f.tree);assert(f.verification.pending,'QR disappearance alone is not verification');
  f.d.querySelector('.chapterVideoFaceMaskDiv').dataset.faceVerified='true';f.verification.poll(f.tree);
  assert.equal(f.verification.pending,null);assert.equal(f.verification.passes,1);
 }finally{f.close();}
}
{
 const f=fixture();try{
  const root=f.d.querySelector('.chapterVideoFaceMaskDiv');let clicks=0;
  f.d.querySelector('button').remove();const outside=f.d.createElement('button');outside.textContent='刷新二维码';outside.onclick=()=>clicks++;f.d.body.append(outside);
  f.verification.poll(f.tree);assert.equal(clicks,0);assert.match(f.verification.pending.refreshMessage,/原页面/);
  root.insertAdjacentHTML('beforeend','<button>刷新二维码</button><button>刷新二维码</button>');
  root.querySelectorAll('button').forEach(button=>button.onclick=()=>clicks++);
  f.verification.poll(f.tree);assert.equal(clicks,0,'Ambiguous or unrelated controls are not clicked');
  f.advance(2500);f.verification.reset();assert.equal(f.verification.pending,null);assert.equal(f.verification.passes,0);assert.equal(f.verification.excludedMs,2500);
 }finally{f.close();}
}
console.log('PASS QR expiry refresh, explicit verification, source binding and reset');
