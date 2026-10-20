const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {JSDOM,VirtualConsole}=require('jsdom');
const {withModelFixture}=require('./model-fixture.cjs');
const source=fs.readFileSync(path.join(__dirname,'../学习通AI助手.user.js'),'utf8');
const entry="    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
const code=source.replace(entry,'globalThis.api={parseQuestionGraph,buildQuestionRequestUnits,createQuestionSnapshot,assertQuestionSnapshot,planQuestionActions,executeQuestionActions,prefill,courseVideoQuizCandidate,courseVideoQuizSnapshot,courseVideoQuizAnswers,exportCxDiagnostics};');
assert.notEqual(code,source);
const passed=[],failed=[];
async function test(name,fn){try{await fn();passed.push(name);console.log('PASS '+name);}catch(error){failed.push({name,error:error.stack});console.log('FAIL '+name+' '+error.message);}}
function q(id='q1',kind='单选题',text='请选择甲'){
 const controls=/简答|填空/.test(kind)?'<textarea></textarea>':kind==='未知题'?'<select><option>甲</option></select>':['A','B','C'].map(k=>`<label><input type="${kind==='多选题'?'checkbox':'radio'}" name="${id}" value="${k}">${k}. ${k==='A'?'甲':k==='B'?'乙':'丙'}</label>`).join('');
 return `<div class="singleQuesId" data-questionid="${id}" data-question-type="${kind}"><div class="Zy_TItle">【${kind}】${text}</div>${controls}</div>`;
}
function fixture(html=q(),video=false){
 const vc=new VirtualConsole(),errors=[];vc.on('jsdomError',error=>errors.push(error.message));
 const dom=new JSDOM(video?`<div data-video-player><video id="v1"></video><div class="ans-videoquiz" data-cue-seconds="10">${html.replaceAll('class="Zy_TItle"','class="question-stem"')}<button id="videoquiz-submit">确认</button></div></div>`:html,{url:'https://mooc1.chaoxing.com/test',runScripts:'outside-only',pretendToBeVisual:true,virtualConsole:vc});
 const w=dom.window,d=w.document,storage=new Map();w.GM_getValue=withModelFixture((key,fallback)=>storage.has(key)?storage.get(key):fallback);w.GM_setValue=(key,value)=>storage.set(key,value);w.GM_getResourceText=()=> '{}';w.eval(code);const a=w.api;
 const snapshot=()=>video?a.courseVideoQuizSnapshot(a.courseVideoQuizCandidate(d.querySelector('video'))):a.createQuestionSnapshot(a.parseQuestionGraph(d),{doc:d});
 return {w,d,a,snapshot,close(){dom.window.close();assert.deepEqual(errors,[]);}};
}
const answer=(id='q1',values=['A'])=>({id,answer:values,answerPolicy:{status:'auto',category:'objective',reason:'mock-only'}});
const cx=(error,code)=>error?.cxCode===code;
(async()=>{
 await test('规划阶段没有点击、focus、输入事件或属性写入，公开计划没有DOM',async()=>{const f=fixture();try{let effects=0;f.d.addEventListener('click',()=>effects++);f.d.addEventListener('input',()=>effects++);f.d.querySelector('input').focus=()=>effects++;const original=f.d.body.innerHTML,snapshot=f.snapshot();const plan=f.a.planQuestionActions(snapshot,[answer()]);assert.equal(effects,0);assert.equal(f.d.body.innerHTML,original);assert.equal(plan.actions.length,1);assert(plan.actions.every(action=>snapshot.graph.controls.some(control=>control.id===action.targetId)));assert(!JSON.stringify(plan).includes('singleQuesId'));assert(!('node'in plan.actions[0]));assert(Object.isFrozen(plan));}finally{f.close();}});
 for(const [kind,values]of [['单选题',['B']],['多选题',['A','C']],['判断题',['A']]])await test('执行原生选项并回读 '+kind,async()=>{const f=fixture(q('q1',kind));try{const plan=f.a.planQuestionActions(f.snapshot(),[answer('q1',values)]),summary=await f.a.executeQuestionActions(plan);assert.equal(summary.filled,1);assert.deepEqual(Array.from(f.d.querySelectorAll('input:checked'),node=>node.value),values);assert.equal(summary.perQuestion[0].status,'filled');}finally{f.close();}});
 await test('文字使用原生setter及input/change事件',async()=>{const f=fixture(q('q1','简答题','解释课程概念'));try{let input=0,change=0;const el=f.d.querySelector('textarea');el.addEventListener('input',()=>input++);el.addEventListener('change',()=>change++);const plan=f.a.planQuestionActions(f.snapshot(),[answer('q1',['模拟文字'])]);assert.equal(el.value,'');const s=await f.a.executeQuestionActions(plan);assert.equal(el.value,'模拟文字');assert.equal(input,1);assert.equal(change,1);assert.equal(s.filled,1);}finally{f.close();}});
 await test('普通入口保留手工文字、不同选择和隐藏保存答案',async()=>{for(const kind of ['text','choice','hidden']){const f=fixture(q('q1',kind==='text'?'简答题':'单选题','解释课程概念'));try{if(kind==='text')f.d.querySelector('textarea').value='人工文字';if(kind==='choice')f.d.querySelector('input[value=B]').checked=true;if(kind==='hidden')f.d.querySelector('.singleQuesId').insertAdjacentHTML('beforeend','<input type="hidden" name="answerq1" value="B">');const s=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('q1',kind==='text'?['AI文字']:['A'])]));assert.equal(s.skipped,1);assert.equal(s.filled,0);if(kind==='text')assert.equal(f.d.querySelector('textarea').value,'人工文字');else assert(!f.d.querySelector('input[value=A]').checked);}finally{f.close();}}});
 await test('人工要求不能由模型非空答案或auto策略解除',async()=>{const f=fixture(q('q1','简答题','请手写拍照上传答案'));try{const s=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('q1',['模型错误返回'])]));assert.equal(s.skipped,1);assert.equal(f.d.querySelector('textarea').value,'');}finally{f.close();}});
 await test('旧文字结果缺少分类策略时拒绝自动填入',async()=>{const f=fixture(q('q1','简答题','解释课程概念'));try{const s=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[{id:'q1',answer:['答案']} ]));assert.equal(s.skipped,1);assert.equal(f.d.querySelector('textarea').value,'');}finally{f.close();}});
 await test('不支持控件和非法选项不会写入',async()=>{const f=fixture(q('q1','未知题'));try{const s=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer()]));assert.equal(s.skipped,1);}finally{f.close();}const g=fixture();try{const s=await g.a.executeQuestionActions(g.a.planQuestionActions(g.snapshot(),[answer('q1',['Z'])]));assert.equal(s.skipped,1);assert(!g.d.querySelector('input:checked'));assert.throws(()=>g.a.planQuestionActions(g.snapshot(),[answer(),answer()]),error=>cx(error,'CX-RES-006'));}finally{g.close();}});
 await test('完整计划预检：后一道控件替换时前一道也零写入',async()=>{const f=fixture(q()+q('q2'));try{const plan=f.a.planQuestionActions(f.snapshot(),[answer(),answer('q2')]);const node=f.d.querySelectorAll('.singleQuesId')[1];node.replaceWith(node.cloneNode(true));await assert.rejects(f.a.executeQuestionActions(plan),error=>cx(error,'CX-CTL-006'));assert(!f.d.querySelector('input:checked'));}finally{f.close();}});
 await test('执行中下一题节点被替换，保留已写入状态并停止后续动作',async()=>{const f=fixture(q()+q('q2'));try{const plan=f.a.planQuestionActions(f.snapshot(),[answer(),answer('q2')]);f.d.querySelector('input').onclick=()=>{const node=f.d.querySelectorAll('.singleQuesId')[1];node.replaceWith(node.cloneNode(true));};await assert.rejects(f.a.executeQuestionActions(plan),error=>cx(error,'CX-CTL-006'));assert(f.d.querySelector('input').checked);assert(!f.d.querySelectorAll('.singleQuesId')[1].querySelector('input:checked'));}finally{f.close();}});
 await test('规划后内容变化与用户输入变化均禁止执行',async()=>{for(const type of ['stem','input']){const f=fixture(q('q1','简答题','解释课程概念'));try{const plan=f.a.planQuestionActions(f.snapshot(),[answer('q1',['AI文字'])]);if(type==='stem')f.d.querySelector('.Zy_TItle').textContent='【简答题】新问题';else f.d.querySelector('textarea').value='人工输入';await assert.rejects(f.a.executeQuestionActions(plan),error=>cx(error,type==='stem'?'CX-PAR-008':'CX-EXE-004'));assert.notEqual(f.d.querySelector('textarea').value,'AI文字');}finally{f.close();}}});
 await test('规划后控件只读/禁用不能写入',async()=>{const f=fixture(q('q1','简答题','解释课程概念'));try{const plan=f.a.planQuestionActions(f.snapshot(),[answer('q1',['AI文字'])]);f.d.querySelector('textarea').readOnly=true;await assert.rejects(f.a.executeQuestionActions(plan));assert.equal(f.d.querySelector('textarea').value,'');}finally{f.close();}});
 await test('取消与重复执行均不产生后续写入',async()=>{const f=fixture();try{const abort=new AbortController(),plan=f.a.planQuestionActions(f.snapshot(),[answer()],{signal:abort.signal});abort.abort();await assert.rejects(f.a.executeQuestionActions(plan),error=>cx(error,'CX-EXE-005'));assert(!f.d.querySelector('input:checked'));await assert.rejects(f.a.executeQuestionActions(plan),error=>cx(error,'CX-PAR-008'));await assert.rejects(f.a.executeQuestionActions(JSON.parse(JSON.stringify(plan))),error=>cx(error,'CX-PAR-008'));}finally{f.close();}});
 await test('只有当前视频同节点自己写入的答案可替换',async()=>{const f=fixture(q('q1','多选题'),true);try{const first=f.snapshot();await f.a.executeQuestionActions(f.a.planQuestionActions(first,[answer('q1',['A','B'])]));const owned=f.a.courseVideoQuizAnswers(first),snap=f.snapshot();const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(snap,[answer('q1',['B','C'])],{ownedAnswers:owned}));assert.equal(summary.filled,1);assert.deepEqual(Array.from(f.d.querySelectorAll('input:checked'),node=>node.value),['B','C']);}finally{f.close();}});
 await test('视频隐藏正确答案不参与选择与用户已有作答判定',async()=>{const f=fixture(q(),true);try{f.d.querySelector('.singleQuesId').insertAdjacentHTML('beforeend','<input type="hidden" name="answerq1" value="B">');const s=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer()]));assert.equal(s.filled,1);assert(f.d.querySelector('input[value=A]').checked);assert.equal(f.d.querySelector('input[type=hidden]').value,'B');}finally{f.close();}});
 await test('普通入口伪造ownedAnswers不能覆盖手工选择',async()=>{const f=fixture();try{const snap=f.snapshot(),binding=snap.bindings.get('q1');f.d.querySelector('input[value=B]').checked=true;const owned=new Map([['q1',{node:binding.node,keys:['B']}]]);const s=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer()],{ownedAnswers:owned}));assert.equal(s.skipped,1);assert(f.d.querySelector('input[value=B]').checked);}finally{f.close();}});
 await test('脚本owned状态之后被人工改变则拒绝覆盖',async()=>{const f=fixture(q(),true);try{const snap=f.snapshot();await f.a.executeQuestionActions(f.a.planQuestionActions(snap,[answer()]));const owned=f.a.courseVideoQuizAnswers(snap);f.d.querySelector('input[value=B]').checked=true;assert.throws(()=>f.a.planQuestionActions(f.snapshot(),[answer('q1',['C'])],{ownedAnswers:owned}),error=>cx(error,'CX-EXE-004'));assert(f.d.querySelector('input[value=B]').checked);}finally{f.close();}});
 await test('执行器从不点击提交/继续或修改任务完成标记',async()=>{const f=fixture(q()+'<button id="submit">提交</button><button id="continue">继续</button><span class="ans-job-icon"></span>');try{let submits=0;f.d.querySelectorAll('button').forEach(button=>button.onclick=()=>submits++);await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer()]));assert.equal(submits,0);assert(f.d.querySelector('.ans-job-icon'));}finally{f.close();}});
 await test('明确label关联的多个文本单元按ID填写并归集原题',async()=>{const html='<div class="singleQuesId" data-questionid="multi"><div class="Zy_TItle">【填空题】填写概念名称</div><label for="first">概念甲</label><input id="first" type="text"><label for="second">概念乙</label><input id="second" type="text"></div>',f=fixture(html);try{const snap=f.snapshot(),projection=f.a.buildQuestionRequestUnits(snap.graph);assert.equal(projection.questions.length,2);const first=projection.questions.find(item=>item.question.endsWith('概念甲')),second=projection.questions.find(item=>item.question.endsWith('概念乙'));const plan=f.a.planQuestionActions(snap,[answer(second.id,['第二答案']),answer(first.id,['第一答案'])]);const summary=await f.a.executeQuestionActions(plan);assert.equal(summary.filled,2);assert.equal(summary.perQuestion.length,1);assert.equal(f.d.getElementById('first').value,'第一答案');assert.equal(f.d.getElementById('second').value,'第二答案');}finally{f.close();}});
 await test('多文本框缺少明确槽位关联时不按位置猜测',async()=>{const f=fixture('<div class="singleQuesId" data-questionid="multi"><div class="Zy_TItle">【填空题】填写概念名称</div><input type="text"><input type="text"></div>');try{const snap=f.snapshot(),projection=f.a.buildQuestionRequestUnits(snap.graph),summary=await f.a.executeQuestionActions(f.a.planQuestionActions(snap,projection.questions.map(item=>answer(item.id,['答案']))));assert.equal(summary.filled,0);assert(summary.skipped>0);assert(Array.from(f.d.querySelectorAll('input')).every(input=>!input.value));}finally{f.close();}});
 await test('首次点击后取消保留部分选择并阻止后续选项',async()=>{const f=fixture(q('q1','多选题'));try{const abort=new AbortController(),plan=f.a.planQuestionActions(f.snapshot(),[answer('q1',['A','B'])],{signal:abort.signal});f.d.querySelector('input[value=A]').onclick=()=>abort.abort();await assert.rejects(f.a.executeQuestionActions(plan),error=>{assert.equal(error.cxCode,'CX-EXE-005');assert.equal(error.prefillSummary.unverified,1);return true;});assert(f.d.querySelector('input[value=A]').checked);assert(!f.d.querySelector('input[value=B]').checked);}finally{f.close();}});
 // Confirmed legacy checkbox DOM; addcheck below is a local platform mock, never a real request.
 function legacyCheckboxHtml(id='406210116') {
  return `<div class="singleQuesId" data-questionid="${id}"><div class="Zy_TItle">【多选题】请选择课程概念</div><ul class="Zy_ulTop">`+['A','B','C'].map(key=>`<li class="before-after-checkbox" onclick="addcheck(${id});"><label class="fl before"><input name="answercheck${id}" type="checkbox" value="${key}">${key}</label><a class="fl after">选项${key}</a></li>`).join('')+`</ul><input type="hidden" id="answer${id}" name="answer${id}" value=""></div>`;
 }
 function legacyCheckboxFixture(extra='',sync=true) {
  const f=fixture('<form>'+legacyCheckboxHtml()+extra+'</form>');f.w.history.replaceState({},'','/mooc-ans/work/doHomeWorkNew');const clicks=[],bubbles=[],updates=[];
  const rows=[...f.d.querySelectorAll('li.before-after-checkbox')];
  for(const row of rows){const input=row.querySelector('input');input.addEventListener('click',()=>clicks.push(input.value));row.addEventListener('click',()=>{bubbles.push(input.value);if(sync)f.w.setTimeout(()=>{const value=[...f.d.getElementsByName('answercheck406210116')].filter(node=>node.checked).map(node=>node.value).join('');f.d.getElementById('answer406210116').value=value;updates.push(value);},200);});}
  return {...f,clicks,bubbles,updates,rows};
 }
 await test('旧版checkbox：li.click不勾选的真实回归形态，改为一次input点击并冒泡同步',async()=>{
  const f=legacyCheckboxFixture();try{
   f.rows[0].click();assert.equal(f.rows[0].querySelector('input').checked,false);await new Promise(resolve=>f.w.setTimeout(resolve,225));assert.equal(f.d.getElementById('answer406210116').value,'');f.bubbles.length=0;
   const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('406210116',['A'])]));assert.equal(summary.filled,1);assert.deepEqual(f.clicks,['A']);assert.deepEqual(f.bubbles,['A']);assert.equal(f.d.getElementById('answer406210116').value,'A');assert(f.rows[0].querySelector('input').checked);
  }finally{f.close();}
 });
 await test('旧版checkbox：多选按模型次序点击但隐藏答案按页面DOM次序，200ms后才报告成功',async()=>{
  const f=legacyCheckboxFixture();try{
   const pending=f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('406210116',['C','A'])]));await new Promise(resolve=>f.w.setTimeout(resolve,30));assert.equal(f.d.getElementById('answer406210116').value,'');let done=false;pending.then(()=>done=true);assert.equal(done,false);
   const summary=await pending;assert.equal(summary.filled,1);assert.deepEqual(f.clicks,['C','A']);assert.deepEqual(f.bubbles,['C','A']);assert.equal(f.d.getElementById('answer406210116').value,'AC');assert.equal(f.updates.at(-1),'AC');assert.deepEqual([...f.d.querySelectorAll('input:checked')].map(input=>input.value),['A','C']);
  }finally{f.close();}
 });
 await test('旧版checkbox：原生点击未改变checked时只尝试一次并停止后续题',async()=>{
  const f=legacyCheckboxFixture(q('q2'));try{
   f.rows[0].querySelector('input').addEventListener('click',event=>event.preventDefault());const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('406210116',['A']),answer('q2',['B'])]));assert.equal(summary.filled,0);assert.equal(summary.unverified,1);assert.deepEqual(f.clicks,['A']);assert(!f.d.querySelector('input:checked'));assert.equal(f.d.getElementById('answer406210116').value,'');
  }finally{f.close();}
 });
 await test('旧版checkbox：隐藏答案未同步时不报告成功且不点击第二个选项或下一题',async()=>{
  const f=legacyCheckboxFixture(q('q2'),false);try{
   const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('406210116',['A','C']),answer('q2',['B'])]));assert.equal(summary.filled,0);assert.equal(summary.unverified,1);assert.deepEqual(f.clicks,['A']);assert(f.rows[0].querySelector('input').checked);assert(!f.rows[2].querySelector('input').checked);assert(!f.d.querySelector('input[name=q2]:checked'));
  }finally{f.close();}
 });
 await test('旧版checkbox：已有手工选择或保存答案时保留原样，不能追加覆盖',async()=>{
  for(const savedOnly of [false,true]){const f=legacyCheckboxFixture();try{
   f.d.getElementById('answer406210116').value='A';if(!savedOnly)f.rows[0].querySelector('input').checked=true;
   const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('406210116',['A','C'])]));assert.equal(summary.skipped,1);assert.equal(summary.filled,0);assert.equal(f.clicks.length,0);assert.equal(f.d.getElementById('answer406210116').value,'A');assert.equal(f.rows[2].querySelector('input').checked,false);
  }finally{f.close();}}
 });
 await test('旧版checkbox：已有同一答案必须checkbox与保存字段均一致才算already',async()=>{
  const f=legacyCheckboxFixture();try{f.rows[0].querySelector('input').checked=true;f.d.getElementById('answer406210116').value='A';const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('406210116',['A'])]));assert.equal(summary.already,1);assert.equal(summary.filled,0);assert.equal(f.clicks.length,0);}finally{f.close();}
  const g=legacyCheckboxFixture();try{g.d.getElementById('answer406210116').value='A';const summary=await g.a.executeQuestionActions(g.a.planQuestionActions(g.snapshot(),[answer('406210116',['A'])]));assert.equal(summary.already,0);assert.equal(summary.unverified,1);assert.equal(g.clicks.length,0);}finally{g.close();}
 });
 await test('旧版checkbox：唯一性禁用跨题共享及原生节点替换均先阻断',async()=>{
  for(const change of [f=>f.rows[0].insertAdjacentHTML('beforeend','<input type="checkbox">'),f=>f.rows[0].querySelector('input').disabled=true,f=>f.d.querySelector('form').insertAdjacentHTML('beforeend','<input name="answercheck406210116" type="checkbox" value="X">'),f=>f.d.getElementById('answer406210116').insertAdjacentHTML('afterend','<input type="hidden" id="answer406210116">')]){const f=legacyCheckboxFixture();try{change(f);assert.throws(()=>f.a.planQuestionActions(f.snapshot(),[answer('406210116',['A'])]));assert.equal(f.clicks.length,0);}finally{f.close();}}
  const f=legacyCheckboxFixture();try{const plan=f.a.planQuestionActions(f.snapshot(),[answer('406210116',['A'])]),input=f.rows[0].querySelector('input');input.replaceWith(input.cloneNode(true));await assert.rejects(f.a.executeQuestionActions(plan));assert(!f.d.querySelector('input:checked'));}finally{f.close();}
 });
 await test('旧版checkbox：原生答案字段在题目外仍按明确ID绑定且保护已有内容',async()=>{
  const f=legacyCheckboxFixture();try{f.d.querySelector('form').append(f.d.getElementById('answer406210116'));const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('406210116',['B'])]));assert.equal(summary.filled,1);assert.equal(f.d.getElementById('answer406210116').value,'B');}finally{f.close();}
 });
 await test('旧版checkbox：首题完成后第二三题radio判断和填空保持原有执行',async()=>{
  const f=legacyCheckboxFixture(q('q2')+q('q3','判断题')+q('q4','填空题','填写课程名称'));try{
   const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('406210116',['A','B']),answer('q2',['B']),answer('q3',['A']),answer('q4',['课程名称'])]));assert.equal(summary.filled,4);assert.equal(f.d.querySelector('input[name=q2]:checked').value,'B');assert.equal(f.d.querySelector('input[name=q3]:checked').value,'A');assert.equal(f.d.querySelector('textarea').value,'课程名称');assert.equal(f.d.getElementById('answer406210116').value,'AB');
  }finally{f.close();}
 });
 await test('旧版checkbox：同步等待期间取消或控件替换保留实际状态并停止下一项',async()=>{
  for(const mode of ['abort','replace']){const f=legacyCheckboxFixture();try{
   const abort=new AbortController(),plan=f.a.planQuestionActions(f.snapshot(),[answer('406210116',['A','C'])],{signal:abort.signal});f.rows[0].querySelector('input').addEventListener('click',()=>f.w.setTimeout(()=>{if(mode==='abort')abort.abort();else{const input=f.rows[2].querySelector('input');input.replaceWith(input.cloneNode(true));}},50));await assert.rejects(f.a.executeQuestionActions(plan));assert.deepEqual(f.clicks,['A']);assert.equal(f.rows[2].querySelector('input').checked,false);
  }finally{f.close();}}
 });

 await test('旧版checkbox专项边界：普通Zy_ulTop自定义选项仍点击原li',async()=>{
  const html='<div class="singleQuesId" data-questionid="ordinary"><div class="Zy_TItle">【单选题】请选择甲</div><ul class="Zy_ulTop"><li><span class="num_option" data="A">A</span><a class="after">甲</a></li><li><span class="num_option" data="B">B</span><a class="after">乙</a></li></ul></div>',f=fixture(html);try{
   f.w.history.replaceState({},'','/mooc-ans/work/doHomeWorkNew');let clicks=0;const rows=[...f.d.querySelectorAll('li')];for(const row of rows)row.addEventListener('click',()=>{clicks++;rows.forEach(other=>other.setAttribute('aria-checked',String(other===row)));});
   const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('ordinary',['B'])]));assert.equal(summary.filled,1);assert.equal(clicks,1);assert.equal(rows[1].getAttribute('aria-checked'),'true');
  }finally{f.close();}
 });
 await test('旧版checkbox专项边界：第二三题的chapter-choice原生radio和判断题保持兼容',async()=>{
  const radio=(id,kind,keys)=>`<div class="singleQuesId" data-questionid="${id}"><div class="Zy_TItle">【${kind}】请选择正确选项</div><ul class="Zy_ulTop">`+keys.map(key=>`<li class="before-after-radio"><label class="before"><input type="radio" name="radio${id}" value="${key}"></label><span class="num_option" data="${key}"></span><a class="after">选项${key}</a></li>`).join('')+'</ul></div>';
  const f=legacyCheckboxFixture(radio('q2','单选题',['A','B'])+radio('q3','判断题',['true','false']));try{
   f.d.querySelectorAll('li.before-after-radio').forEach(row=>row.addEventListener('click',event=>{if(event.target===row)row.querySelector('input').click();}));
   const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('406210116',['A']),answer('q2',['B']),answer('q3',['true'])]));assert.equal(summary.filled,3);assert.equal(f.d.querySelector('input[name=radioq2]:checked').value,'B');assert.equal(f.d.querySelector('input[name=radioq3]:checked').value,'true');assert.deepEqual(f.clicks,['A']);
  }finally{f.close();}
 });

 // Real radio shape supplied by the user: before-after + label.fl.before, no LI click handler.
 function legacyPlainRadio(id='radio1',kind='单选题',keys=['A','B']) {
  return `<div class="singleQuesId" data-questionid="${id}"><div class="Zy_TItle">【${kind}】请选择正确选项</div><ul class="Zy_ulTop">`+keys.map(key=>`<li class="before-after"><label class="fl before"><input name="answer${id}" type="radio" value="${key}">${key}</label><a class="fl after">选项${key}</a></li>`).join('')+'</ul></div>';
 }
 await test('旧版原生选项：无onclick的LI点击不勾选，预填只点击内部radio一次',async()=>{
  const f=fixture(legacyPlainRadio());try{
   f.w.history.replaceState({},'','/mooc-ans/work/doHomeWorkNew');const rows=f.d.querySelectorAll('li'),input=rows[1].querySelector('input');assert.equal(rows[1].getAttribute('onclick'),null);rows[1].click();assert.equal(input.checked,false);
   const clicks=[];f.d.querySelectorAll('input').forEach(node=>node.addEventListener('click',()=>clicks.push(node.value)));const snap=f.snapshot(),logical=snap.bindings.get('radio1');assert.equal(logical.writer,'chapter-choice');assert.equal(logical.optionTargets.get('B'),rows[1]);
   const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(snap,[answer('radio1',['B'])]));assert.equal(summary.filled,1);assert.equal(input.checked,true);assert.deepEqual(clicks,['B']);
  }finally{f.close();}
 });
 await test('旧版原生选项：LI样式不替代radio.checked，人工原答案仍保护',async()=>{
  const f=fixture(legacyPlainRadio());try{
   f.d.querySelector('li').className+=' active';let clicks=0;f.d.querySelector('input').addEventListener('click',()=>clicks++);const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('radio1',['A'])]));assert.equal(summary.filled,1);assert.equal(clicks,1);assert(f.d.querySelector('input[value=A]').checked);
   const next=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('radio1',['B'])]));assert.equal(next.skipped,1);assert(f.d.querySelector('input[value=A]').checked);assert.equal(clicks,1);
  }finally{f.close();}
 });
 await test('旧版原生选项：radio点击被取消时停止，不能用LI样式伪报成功',async()=>{
  const f=fixture(legacyPlainRadio()+q('later'));try{
   const input=f.d.querySelector('input');input.addEventListener('click',event=>{event.preventDefault();input.closest('li').classList.add('active');});let clicks=0;input.addEventListener('click',()=>clicks++);
   const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('radio1',['A']),answer('later',['B'])]));assert.equal(summary.filled,0);assert.equal(summary.unverified,1);assert.equal(input.checked,false);assert.equal(clicks,1);assert(!f.d.querySelector('input[name=later]:checked'));
  }finally{f.close();}
 });
 await test('旧版原生选项：同一radio答案重复预填返回already且不反选',async()=>{
  const f=fixture(legacyPlainRadio());try{
   let clicks=0;f.d.querySelector('input[value=B]').addEventListener('click',()=>clicks++);let summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('radio1',['B'])]));assert.equal(summary.filled,1);summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('radio1',['B'])]));assert.equal(summary.already,1);assert.equal(clicks,1);assert(f.d.querySelector('input[value=B]').checked);
  }finally{f.close();}
 });
 await test('旧版原生选项：内部input替换禁用多候选或radio跨题共享均拒绝',async()=>{
  for(const mode of ['replace','disabled','multiple','shared']){const f=fixture(legacyPlainRadio());try{
   let plan;if(mode==='replace'){plan=f.a.planQuestionActions(f.snapshot(),[answer('radio1',['A'])]);const input=f.d.querySelector('input');input.replaceWith(input.cloneNode(true));await assert.rejects(f.a.executeQuestionActions(plan));}
   else{if(mode==='disabled')f.d.querySelector('input').disabled=true;if(mode==='multiple')f.d.querySelector('li').insertAdjacentHTML('beforeend','<input type="radio" name="answerradio1" value="Z">');if(mode==='shared')f.d.body.insertAdjacentHTML('beforeend','<input type="radio" name="answerradio1" value="Z">');assert.throws(()=>f.a.planQuestionActions(f.snapshot(),[answer('radio1',['A'])]));}
   assert(!f.d.querySelector('input:checked'));
  }finally{f.close();}}
 });
 await test('旧版原生选项：多选无隐藏字段时仍验证checkbox且不生成字段',async()=>{
  const f=legacyCheckboxFixture('',false);try{
   f.d.getElementById('answer406210116').remove();const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('406210116',['A','C'])]));assert.equal(summary.filled,1);assert.deepEqual(f.clicks,['A','C']);assert.equal(f.d.getElementById('answer406210116'),null);assert.deepEqual([...f.d.querySelectorAll('input:checked')].map(node=>node.value),['A','C']);
  }finally{f.close();}
 });
 await test('旧版原生选项：多选异步同步后继续真实before-after单选与判断radio',async()=>{
  const f=legacyCheckboxFixture(legacyPlainRadio('radio2')+legacyPlainRadio('radio3','判断题',['true','false']));try{
   const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('406210116',['C','A']),answer('radio2',['B']),answer('radio3',['true'])]));assert.equal(summary.filled,3);assert.equal(f.d.getElementById('answer406210116').value,'AC');assert.equal(f.d.querySelector('input[name=answerradio2]:checked').value,'B');assert.equal(f.d.querySelector('input[name=answerradio3]:checked').value,'true');assert(f.d.querySelectorAll('li.before-after').length===4);
  }finally{f.close();}
 });

 await test('旧版原生选项：仅隐藏值或LI样式匹配时不伪报radio已选中',async()=>{
  const f=fixture(legacyPlainRadio());try{
   f.d.querySelector('.singleQuesId').insertAdjacentHTML('beforeend','<input type="hidden" name="answerradio1" value="A">');f.d.querySelector('li').classList.add('active');let clicks=0;f.d.querySelector('input[type=radio]').addEventListener('click',()=>clicks++);
   const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('radio1',['A'])]));assert.equal(summary.filled,0);assert.equal(summary.already,0);assert.equal(summary.unverified,1);assert.equal(clicks,0);assert.equal(f.d.querySelector('input[type=radio]').checked,false);assert.equal(f.d.querySelector('input[type=hidden]').value,'A');
  }finally{f.close();}
 });


 // User-provided mooc2 DOM, with a local simulation of the described addChoice
 // behavior. This fixture does not claim live-platform acceptance.
 function mooc2Question(id='215393175',kind='单选题',count=4) {
  const rows=['C','B','A','D','F','E'].slice(0,count).map((value,index)=>
   '<div class="clearfix answerBg workTextWrap" onclick="addChoice(this)" role="radio" qid="'+id+'" qtype="0"><span class="choice'+id+' num_option fl" data="'+value+'">'+String.fromCharCode(65+index)+'</span><div class="fl answer_p">选项内容'+(index+1)+'</div></div>').join('');
  return '<div class="questionLi singleQuesId" data-questionid="'+id+'" typename="'+kind+'"><div class="mark_name">选择符合题意的选项</div><div class="stem_answer">'+rows+'</div><input type="hidden" id="answer'+id+'" value=""></div>';
 }
 function mooc2Fixture(html=mooc2Question(),broken='') {
  const f=fixture('<form><div class="fanyaMarking_left"><div class="TiMu">'+html+'</div></div></form>');
  f.w.history.replaceState({},'','/mooc-ans/mooc2/work/dowork');f.clicks=[];
  f.d.querySelectorAll('.questionLi.singleQuesId').forEach(question=>{
   const rows=[...question.querySelectorAll('.answerBg')],hidden=question.querySelector('input[type=hidden]');
   rows.forEach(row=>row.addEventListener('click',()=>{
    f.clicks.push(row.querySelector('.num_option').textContent);
    if(broken==='no-change')return;
    const multiple=question.getAttribute('typename')==='多选题',previous=row.querySelector('.num_option').classList.contains('check_answer');
    rows.forEach(other=>{
     const marker=other.querySelector('.num_option'),state=multiple?(other===row?!previous:marker.classList.contains('check_answer')):other===row;
     marker.classList.toggle('check_answer',state);other.setAttribute('aria-checked',String(state));other.setAttribute('aria-pressed',String(state));
    });
    hidden.value=rows.filter(other=>other.querySelector('.num_option').classList.contains('check_answer')).map(other=>other.querySelector('.num_option').getAttribute('data')).join('');
    if(broken==='class')row.querySelector('.num_option').classList.remove('check_answer');
    if(broken==='aria')row.setAttribute('aria-checked','false');
    if(broken==='hidden')hidden.value=row.querySelector('.num_option').textContent;
    if(broken==='single-extra'){rows[1].querySelector('.num_option').classList.add('check_answer');rows[1].setAttribute('aria-checked','true');rows[1].setAttribute('aria-pressed','true');hidden.value='CB';}
   }));
  });return f;
 }
 await test('mooc2解析：typename、显示字母与data分离，TiMu不合并题目',async()=>{
  const f=mooc2Fixture(mooc2Question()+mooc2Question('215393176','多选题',6));try{
   const snap=f.snapshot(),projection=f.a.buildQuestionRequestUnits(snap.graph),question=projection.questions[0],binding=snap.bindings.get(question.id);
   assert.equal(snap.graph.questions.length,2);assert.equal(question.type,'single');assert.equal(projection.questions[1].type,'multiple');assert.equal(question.question,'选择符合题意的选项');
   assert.deepEqual(Array.from(question.options,item=>item.key),['A','B','C','D']);assert.equal(question.options[0].text,'选项内容1');assert.equal(projection.questions[1].options.length,6);
   assert.equal(binding.optionTargets.get('A').querySelector('.num_option').getAttribute('data'),'C');assert.equal(binding.optionTargets.get('C').querySelector('.num_option').getAttribute('data'),'A');assert.equal(binding.writer,'mooc2-choice');
   assert(!JSON.stringify(projection.questions).includes('savedInput'));assert(question.options.every(item=>!('value'in item)&&!('data'in item)));
   const original=f.d.body.innerHTML,plan=f.a.planQuestionActions(snap,[answer(question.id,['A'])]);assert.equal(f.d.body.innerHTML,original);assert.equal(f.clicks.length,0);assert.equal(plan.actions[0].value,'A');
  }finally{f.close();}
 });
 for(const count of [4,5,6])await test('mooc2单选：'+count+'选项显示C保存内部A',async()=>{
  const f=mooc2Fixture(mooc2Question('215393175','单选题',count));try{
   const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('215393175',['C'])]));assert.equal(summary.filled,1);assert.deepEqual(f.clicks,['C']);assert.equal(f.d.getElementById('answer215393175').value,'A');const selected=f.d.querySelectorAll('.num_option.check_answer');assert.equal(selected.length,1);assert.equal(selected[0].textContent,'C');assert.equal(selected[0].parentElement.getAttribute('aria-checked'),'true');
  }finally{f.close();}
 });
 await test('mooc2显示A保存内部C，重复预填不重复点击',async()=>{
  const f=mooc2Fixture();try{
   let summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('215393175',['A'])]));assert.equal(summary.filled,1);assert.equal(f.d.getElementById('answer215393175').value,'C');summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('215393175',['A'])]));assert.equal(summary.already,1);assert.deepEqual(f.clicks,['A']);
  }finally{f.close();}
 });
 await test('mooc2六选多选按显示字母点击，保存值按DOM顺序验证',async()=>{
  const f=mooc2Fixture(mooc2Question('215393175','多选题',6));try{
   const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('215393175',['F','A','C'])]));assert.equal(summary.filled,1);assert.deepEqual(f.clicks,['F','A','C']);assert.equal(f.d.getElementById('answer215393175').value,'CAE');assert.deepEqual([...f.d.querySelectorAll('.check_answer')].map(node=>node.textContent),['A','C','F']);assert.equal(f.d.querySelectorAll('[aria-checked=true]').length,3);
  }finally{f.close();}
 });
 await test('mooc2判断题沿用实际显示字母，不把内部data当模型key',async()=>{
  const f=mooc2Fixture(mooc2Question('215393175','判断题',2));try{
   assert.equal(f.snapshot().graph.questions[0].type,'judge');const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('215393175',['A'])]));assert.equal(summary.filled,1);assert.equal(f.d.getElementById('answer215393175').value,'C');assert.deepEqual(f.clicks,['A']);
  }finally{f.close();}
 });
 await test('mooc2已有不同答案及部分多选不覆盖',async()=>{
  for(const kind of ['单选题','多选题']){const f=mooc2Fixture(mooc2Question('215393175',kind));try{
   f.d.querySelector('.answerBg').click();f.clicks.length=0;const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('215393175',kind==='多选题'?['A','C']:['C'])]));assert.equal(summary.skipped,1);assert.deepEqual(f.clicks,[]);assert.equal(f.d.getElementById('answer215393175').value,'C');
  }finally{f.close();}}
 });
 await test('mooc2仅有保存值时不猜显示答案且不点击',async()=>{
  const f=mooc2Fixture();try{
   f.d.getElementById('answer215393175').value='C';const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('215393175',['C'])]));assert.equal(summary.skipped,1);assert.equal(summary.already,0);assert.deepEqual(f.clicks,[]);assert.equal(f.d.querySelector('.check_answer'),null);
  }finally{f.close();}
 });
 for(const broken of ['class','aria','hidden','no-change','single-extra'])await test('mooc2回读失败停止后续题：'+broken,async()=>{
  const f=mooc2Fixture(mooc2Question()+mooc2Question('215393176'),broken);try{
   const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('215393175',['A']),answer('215393176',['C'])]));assert.equal(summary.filled,0);assert.equal(summary.unverified,1);assert.deepEqual(f.clicks,['A']);assert.equal(f.d.getElementById('answer215393176').value,'');
  }finally{f.close();}
 });
 await test('mooc2重复键、内部值重复、qid冲突、缺失字段及未知结构降级',async()=>{
  for(const mode of ['duplicate-key','duplicate-data','qid','missing-hidden','duplicate-hidden','unknown-type','missing-marker','missing-stem','handler']){const f=mooc2Fixture();try{
   const rows=f.d.querySelectorAll('.answerBg');if(mode==='duplicate-key')rows[1].querySelector('.num_option').textContent='A';if(mode==='duplicate-data')rows[1].querySelector('.num_option').setAttribute('data','C');if(mode==='qid')rows[1].setAttribute('qid','99');if(mode==='missing-hidden')f.d.querySelector('input[type=hidden]').remove();if(mode==='duplicate-hidden')f.d.querySelector('form').append(f.d.querySelector('input[type=hidden]').cloneNode(true));if(mode==='unknown-type')f.d.querySelector('.questionLi').setAttribute('typename','未适配题');if(mode==='missing-marker')rows[1].querySelector('.num_option').remove();if(mode==='missing-stem')f.d.querySelector('.mark_name').remove();if(mode==='handler')rows[1].setAttribute('onclick','otherChoice(this)');
   const summary=await f.a.executeQuestionActions(f.a.planQuestionActions(f.snapshot(),[answer('215393175',['A'])]));assert.equal(summary.filled,0);assert.equal(summary.skipped,1);assert.deepEqual(f.clicks,[]);
  }finally{f.close();}}
 });
 await test('mooc2快照映射或节点变化后禁止执行',async()=>{
  for(const mode of ['data','marker','hidden','row','handler','role','qid','qtype']){const f=mooc2Fixture();try{
   const plan=f.a.planQuestionActions(f.snapshot(),[answer('215393175',['A'])]),row=f.d.querySelector('.answerBg');
   if(mode==='data')row.querySelector('.num_option').setAttribute('data','Z');if(mode==='marker'){const marker=row.querySelector('.num_option');marker.replaceWith(marker.cloneNode(true));}if(mode==='hidden'){const hidden=f.d.querySelector('input[type=hidden]');hidden.replaceWith(hidden.cloneNode(true));}if(mode==='row')row.replaceWith(row.cloneNode(true));if(mode==='handler')row.setAttribute('onclick','otherChoice(this)');if(mode==='role')row.setAttribute('role','checkbox');if(mode==='qid')row.setAttribute('qid','99');if(mode==='qtype')row.setAttribute('qtype','9');
   await assert.rejects(f.a.executeQuestionActions(plan));assert.deepEqual(f.clicks,[]);assert.equal(f.d.querySelector('.check_answer'),null);
  }finally{f.close();}}
 });
 await test('mooc2规划后用户介入、取消或禁用时零点击',async()=>{
  for(const mode of ['edit','abort','disabled']){const f=mooc2Fixture();try{
   const signal=new AbortController(),plan=f.a.planQuestionActions(f.snapshot(),[answer('215393175',['A'])],{signal:signal.signal});if(mode==='edit'){f.d.querySelector('.answerBg:nth-child(2)').click();f.clicks.length=0;}if(mode==='abort')signal.abort();if(mode==='disabled')f.d.querySelector('.answerBg').setAttribute('aria-disabled','true');await assert.rejects(f.a.executeQuestionActions(plan));assert.deepEqual(f.clicks,[]);
  }finally{f.close();}}
 });
 await test('mooc2缺失真实题目边界时不把TiMu包装解析为一道题',async()=>{
  const f=mooc2Fixture('<div class="mark_name">包装页题干</div><div class="stem_answer"></div>');try{assert.throws(()=>f.snapshot());assert.deepEqual(f.clicks,[]);}finally{f.close();}
 });

 const result={passed:passed.length,failed:failed.length,tests:passed,failures:failed};fs.writeFileSync(path.join(__dirname,'question-actions-results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(failed.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
