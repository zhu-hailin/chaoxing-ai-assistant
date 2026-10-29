// Focused local fixtures. Execution requires separate user authorization.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const entry="    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
function fixture(html){
 const dom=new JSDOM(html,{url:'https://mooc1.chaoxing.com/work/doHomeWorkNew',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 w.GM_getValue=(_,fallback)=>fallback;w.GM_setValue=()=>{};
 w.HTMLElement.prototype.getBoundingClientRect=()=>({width:100,height:30,top:0,left:0,bottom:30,right:100});
 w.HTMLElement.prototype.getClientRects=function(){return this.style.display==='none'?[]:[this.getBoundingClientRect()];};
 const source=fs.readFileSync(path.join(__dirname,'../学习通AI助手.user.js'),'utf8');
 const code=source.replace(entry,'globalThis.api={parseQuestionGraph,createQuestionSnapshot,planQuestionActions,executeQuestionActions,normalize,animatedMedia,whiteStaticMedia,readChapterRowChoiceBindings,questionActionRowChoiceState};');
 assert.notEqual(code,source);w.eval(code);
 return {w,d:w.document,a:w.api,close:()=>w.close()};
}
function matching(chosen=false){return `<form><div class="singleQuesId" data-questionid="101"><div class="Zy_TItle">【连线题】对应概念</div><div class="matching"><ul class="firstUlList"><li><i>1</i>甲<img src="data:image/png;base64,AA=="></li><li><i>2</i>乙</li></ul><ul class="secondUlList"><li><i>A</i>概念甲</li><li><i>B</i>概念乙<img src="data:image/png;base64,AQ=="></li></ul><ul class="thirdUlList">${[1,2].map(i=>`<li class="lineOption" index="${i}"><span class="matchNum">${i}</span><select class="dept_select" ${chosen?'style="display:none"':''}><option value=""></option><option>A</option><option>B</option></select>${chosen?'<div class="chosen-container"><a class="chosen-single"><span></span></a></div>':''}</li>`).join('')}</ul></div><input type="hidden" id="answer101" value=""></div></form>`;}
function setup(f){
 const {w,d}=f;
 for(const select of d.querySelectorAll('select'))select.onchange=()=>{d.getElementById('answer101').value=JSON.stringify([...d.querySelectorAll('.lineOption')].map(row=>({name:row.getAttribute('index'),content:row.querySelector('select').value})));};
 const instances=new WeakMap();
 w.jQuery=select=>({data(){if(!instances.has(select))instances.set(select,{form_field:select,container:[select.nextElementSibling]});return instances.get(select);},trigger(name){assert.equal(name,'chosen:updated');select.nextElementSibling.querySelector('span').textContent=select.selectedOptions[0].textContent;}});
 return ()=>f.a.createQuestionSnapshot(f.a.parseQuestionGraph(d),{doc:d});
}
test('matching keeps ordered duplicate answers and separate image bindings',async()=>{
 const f=fixture(matching());try{const snapshot=setup(f)(),q=snapshot.questions[0];assert.equal(q.type,'matching');assert(q.capabilities.prefill);assert(snapshot.media.some(image=>image.location==='matching-left'&&image.optionKey==='1'));assert(snapshot.media.some(image=>image.location==='option'&&image.optionKey==='B'));
 const answer=f.a.normalize({answers:[{id:q.id,answer:['B','B'],reason:'fixture'}]},[q]);assert.equal(answer[0].answer.length,2);
 const result=await f.a.executeQuestionActions(f.a.planQuestionActions(snapshot,answer));assert.equal(result.filled,1);assert.deepEqual(JSON.parse(f.d.getElementById('answer101').value),[{name:'1',content:'B'},{name:'2',content:'B'}]);
 }finally{f.close();}
});
test('Chosen refreshes from native selections; missing native save remains unverified',async()=>{
 for(const sync of [true,false]){const f=fixture(matching(true));try{const snapshot=setup(f);if(!sync)for(const select of f.d.querySelectorAll('select'))select.onchange=null;
 const result=await f.a.executeQuestionActions(f.a.planQuestionActions(snapshot(),[{id:'101',answer:['A','B']} ]));assert.equal(result[sync?'filled':'unverified'],1);assert.equal(f.d.querySelector('.chosen-single span').textContent,'A');
 }finally{f.close();}}
});
test('matching protects existing answers, missing rows and replaced options',async()=>{
 const f=fixture(matching());try{const snapshot=setup(f);f.d.querySelector('select').value='A';f.d.querySelector('select').onchange();let result=await f.a.executeQuestionActions(f.a.planQuestionActions(snapshot(),[{id:'101',answer:['B','B']}]));assert.equal(result.skipped,1);assert.equal(f.d.querySelector('select').value,'A');
 f.d.querySelector('select').value='';f.d.querySelector('select').onchange();const plan=f.a.planQuestionActions(snapshot(),[{id:'101',answer:['B','B']}]);f.d.querySelector('select option[value=""]').replaceWith(f.d.createElement('option'));await assert.rejects(f.a.executeQuestionActions(plan));
 f.d.querySelector('.lineOption').remove();assert.equal(f.a.parseQuestionGraph(f.d).questions[0].capabilities.prefill,false);
 }finally{f.close();}
});
test('static media composites white before pixels; animated containers remain original',async()=>{
 const f=fixture('');try{const calls=[],ctx={fillStyle:'',fillRect(){calls.push(['fill',this.fillStyle]);},drawImage(){calls.push(['draw']);}};
 f.w.Image=class{naturalWidth=2;naturalHeight=2;set src(value){if(value)queueMicrotask(()=>this.onload?.());}};
 f.w.HTMLCanvasElement.prototype.getContext=()=>ctx;f.w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,AQID';
 const bytes=new f.w.Uint8Array([137,80,78,71,13,10,26,10]);const output=await f.a.whiteStaticMedia(bytes,'image/png',f.d,null,()=>{});assert.deepEqual(Array.from(output),[1,2,3]);assert.deepEqual(calls,[['fill','#ffffff'],['draw']]);
 const animated=new f.w.Uint8Array([82,73,70,70,0,0,0,0,87,69,66,80,65,78,73,77,0,0,0,0]);assert.equal(f.a.animatedMedia(animated,'image/webp'),true);assert.equal(await f.a.whiteStaticMedia(animated,'image/webp',f.d,null,()=>{}),animated);
 }finally{f.close();}
});
test('randomOptions compares saved data values to displayed letters and rejects duplicate mappings',()=>{
 const f=fixture(`<form><div class="singleQuesId" data-questionid="201"><ul>${[['A','3'],['B','1']].map(([key,value])=>`<li class="before-after-checkbox selected" onclick="addMultipleChoice(this)"><label class="fl before num_option_dx" data="${value}">${key}</label><a class="fl after">选项${key}</a><div class="clear"></div></li>`).join('')}</ul><input type="hidden" id="answer201" value="3,1"></div></form>`);
 try{const node=f.d.querySelector('.singleQuesId'),rows=[...node.querySelectorAll('li')],adapter=f.a.readChapterRowChoiceBindings(node,'201','multiple',rows);assert(adapter.valid);const binding={chapterRows:adapter,optionTargets:new Map([['A',rows[0]],['B',rows[1]]])};const state=f.a.questionActionRowChoiceState(binding,{type:'multiple'});assert.equal(state.unknownSaved,false);assert.deepEqual(Array.from(state.keys),['A','B']);rows[1].querySelector('label').setAttribute('data','3');assert.equal(f.a.readChapterRowChoiceBindings(node,'201','multiple',rows).valid,false);}finally{f.close();}
});

function legacySpanChoice(attribute='name'){
 return `<form><div class="singleQuesId" data-questionid="301"><div class="Zy_TItle">【单选题】本地选项夹具</div><ul class="Zy_ulTop">${[['A','3'],['B','1'],['C','2'],['D','4']].map(([key,value])=>`<li class="before-after" onclick="addChoice(this)"><label class="fl before num_option_dx" data="${value}">${key}</label><a class="fl after"><span ${attribute}="answer301">选项${key}</span></a><div class="clear"></div></li>`).join('')}</ul><input type="hidden" id="answer301" name="answer301" value=""></div></form>`;
}
function legacySpanSetup(f,sync=true){
 const rows=[...f.d.querySelectorAll('.Zy_ulTop li')],saved=f.d.querySelector('input[type="hidden"]');
 rows.forEach(row=>row.onclick=()=>{rows.forEach(item=>item.classList.remove('selected'));row.classList.add('selected');if(sync)saved.value=row.querySelector('label').getAttribute('data');});
 return {rows,saved,snapshot:()=>f.a.createQuestionSnapshot(f.a.parseQuestionGraph(f.d),{doc:f.d})};
}
test('legacy option spans with the answer name or ID retain native value mapping and save readback',async()=>{
 for(const attribute of ['name','id']){const f=fixture(legacySpanChoice(attribute));try{
  const {saved,snapshot}=legacySpanSetup(f),current=snapshot();assert.equal(current.questions[0].capabilities.prefill,true);
  const result=await f.a.executeQuestionActions(f.a.planQuestionActions(current,[{id:'301',answer:['B']}]));assert.equal(result.filled,1);assert.equal(saved.value,'1');
 }finally{f.close();}}
});
test('legacy option span exception keeps duplicate fields and unrelated same-name nodes blocked',()=>{
 for(const mode of ['duplicate-hidden','outside-span','cross-question','wrong-form','text-input']){const f=fixture(legacySpanChoice());try{
  const q=f.d.querySelector('.singleQuesId'),saved=f.d.querySelector('input[type="hidden"]');
  if(mode==='duplicate-hidden')q.append(saved.cloneNode(true));
  if(mode==='outside-span'){const span=f.d.createElement('span');span.setAttribute('name','answer301');q.append(span);}
  if(mode==='cross-question'){const other=f.d.createElement('div');other.className='singleQuesId';other.setAttribute('data-questionid','302');other.append(saved);f.d.querySelector('form').append(other);}
  if(mode==='wrong-form'){const form=f.d.createElement('form');f.d.body.append(form);form.append(saved);}
  if(mode==='text-input')saved.type='text';
  const binding=f.a.readChapterRowChoiceBindings(q,'301','single',[...q.querySelectorAll('.Zy_ulTop li')]);assert.equal(binding.valid,false,mode);
 }finally{f.close();}}
});
test('legacy option span exception preserves existing answers and stops on replacement or missing native save',async()=>{
 for(const mode of ['manual','replace','unsynced']){const f=fixture(legacySpanChoice());try{
  const {rows,saved,snapshot}=legacySpanSetup(f,mode!=='unsynced');
  if(mode==='manual')rows[0].click();
  const plan=f.a.planQuestionActions(snapshot(),[{id:'301',answer:['B']}]);
  if(mode==='replace'){saved.replaceWith(saved.cloneNode(true));await assert.rejects(f.a.executeQuestionActions(plan));}
  else {const result=await f.a.executeQuestionActions(plan);assert.equal(result[mode==='manual'?'skipped':'unverified'],1);assert.equal(saved.value,mode==='manual'?'3':'');}
 }finally{f.close();}}
});
