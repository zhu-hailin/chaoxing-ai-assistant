const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../sources/course-context.js'),'utf8');
const implementation=fs.readFileSync(path.join(__dirname,'../sources/course-context-collector.js'),'utf8');
const logs=[],failures=[];
async function test(name,run){try{await run();logs.push(`PASS ${name}`);}catch(error){failures.push(`${name}: ${error.stack}`);}}
function fixture(body=''){
 const dom=new JSDOM(body,{url:'https://mooc1.chaoxing.com/mycourse/studentstudy',runScripts:'outside-only'});
 dom.window.eval(source+'\nglobalThis.contextAPI={createCourseContext,collectCourseContext,mergeCourseContext,courseContextForPrompt,courseContextNoteText,courseContextPlainText,COURSE_CONTEXT_LIMITS};');
 return {w:dom.window,d:dom.window.document,api:dom.window.contextAPI,close:()=>dom.window.close()};
}
const plain=value=>JSON.parse(JSON.stringify(value));
function integration(f){
 const start=implementation.indexOf('    const chapterContextCache = new WeakMap();');
 const end=implementation.length;
 assert(start>=0&&end>start,'课程资料接入函数未找到');
 let documents=[f.d],scope='course:c1';
 f.w.studyOwnerDocument=()=>f.d;f.w.courseScoreKey=()=>scope;
 f.w.courseFrameTree=()=>({documents});f.w.courseDocumentReader=()=>null;
 f.w.eval(implementation.slice(start,end)+'\nglobalThis.contextIntegration={chapterContextIdentity,chapterContextStore,captureCurrentCourseContext};');
 return {api:f.w.contextIntegration,setDocuments(value){documents=value;},setScope(value){scope=value;}};
}
(async()=>{
 await test('无资料或空章身份时不产生课程上下文',()=>{
  const f=fixture();try{const store=f.api.createCourseContext('chapter-1');assert.deepEqual(plain(f.api.collectCourseContext({chapterId:'chapter-1'})),[]);assert.deepEqual(plain(f.api.courseContextForPrompt(store,'chapter-1')),[]);assert(!f.api.mergeCourseContext(store,'',[]));assert.deepEqual(plain(f.api.collectCourseContext({chapterId:''})),[]);}finally{f.close();}
 });
 await test('空笔记、富文本空段、NBSP、零宽与占位提示均省略',()=>{
  const f=fixture('<textarea placeholder="请输入笔记"></textarea><div id="html"><p><br></p><p>&nbsp;\u200b</p></div><div id="empty">暂无笔记</div><div id="placeholder" data-placeholder="请输入笔记">请输入笔记</div>');
  try{const roots=[...f.d.querySelectorAll('textarea,div')];assert.deepEqual(plain(f.api.collectCourseContext({chapterId:'a',notesRoots:roots})),[]);f.d.querySelector('textarea').value='请输入笔记';assert.equal(f.api.courseContextNoteText(f.d.querySelector('textarea')),'');}finally{f.close();}
 });
 await test('明确非空笔记才加入，去除工具控件且不抓作答区',()=>{
  const f=fixture('<section id="note"><p>重点：离散信号</p><button>保存笔记</button><span hidden>隐藏信息</span></section><section class="TiMu"><textarea id="answer">已提交答案</textarea></section>');
  try{const items=f.api.collectCourseContext({chapterId:'a',notesRoots:[f.d.getElementById('note'),f.d.getElementById('answer'),f.d.body]});assert.equal(items.length,1);assert.equal(items[0].kind,'note');assert.equal(items[0].text,'重点：离散信号');assert(!JSON.stringify(items).includes('已提交答案'));}finally{f.close();}
 });
 await test('只读已加载字幕轨道，排除 metadata，不修改 mode 或获取地址',()=>{
  const f=fixture('<video></video>');try{
   const video=f.d.querySelector('video');let modeWrites=0,fetches=0;
   const track={kind:'subtitles',label:'中文',cues:[{text:'<v 教师>传输介质</v>'},{text:'传输介质'},{text:'第二个知识点'}]};Object.defineProperty(track,'mode',{get:()=>'disabled',set:()=>modeWrites++});
   Object.defineProperty(video,'textTracks',{value:[track,{kind:'metadata',cues:[{text:'媒体地址或埋点'}]},{kind:'captions',cues:null}]});f.w.fetch=()=>{fetches++;throw new Error('不应请求网络');};
   const items=f.api.collectCourseContext({chapterId:'a',video});assert.equal(items.length,1);assert.equal(items[0].text,'传输介质\n第二个知识点');assert.equal(modeWrites,0);assert.equal(fetches,0);assert(!JSON.stringify(items).includes('媒体地址'));
  }finally{f.close();}
 });
 await test('字幕不存在、读取失败或空白时不发送伪字幕',()=>{
  const f=fixture('<video></video>');try{const video=f.d.querySelector('video');const broken={kind:'subtitles'};Object.defineProperty(broken,'cues',{get:()=>{throw new Error('未开放');}});Object.defineProperty(video,'textTracks',{value:[broken,{kind:'captions',cues:[{text:'<br>&nbsp;\u200b'}]}]});assert.deepEqual(plain(f.api.collectCourseContext({chapterId:'a',video})),[]);}finally{f.close();}
 });
 await test('课件只读取已知阅读器文字层，工具栏和图片型 PPT 不冒充资料',()=>{
  const f=fixture('<div class="pdfViewer" id="reader"><button>下一页</button><div class="page"><div class="textLayer"><span>课程中的定义</span><span>及其应用</span></div></div><div class="TiMu"><div class="textLayer">答案区域</div></div></div><div id="other"><div class="textLayer">无关课件</div></div><div class="continuous-reader" id="image"><img src="x.png"></div>');
  try{const items=f.api.collectCourseContext({chapterId:'a',reader:{contentRoot:f.d.getElementById('reader')}});assert.equal(items.length,1);assert.equal(items[0].text,'课程中的定义及其应用');assert(!JSON.stringify(items).includes('答案区域'));assert.deepEqual(plain(f.api.collectCourseContext({chapterId:'a',reader:{contentRoot:f.d.getElementById('other')}})),[]);assert.deepEqual(plain(f.api.collectCourseContext({chapterId:'a',reader:{contentRoot:f.d.getElementById('image')}})),[]);}finally{f.close();}
 });
 await test('同一来源再次加载时替换，不跨视频覆盖或跨章复用',()=>{
  const f=fixture('<video id="one"></video><video id="two"></video>');try{
   const store=f.api.createCourseContext('a');const track1={kind:'subtitles',label:'中文',cues:[{text:'视频一资料'}]},track2={kind:'subtitles',label:'中文',cues:[{text:'视频二资料'}]};
   Object.defineProperty(f.d.getElementById('one'),'textTracks',{value:[track1]});Object.defineProperty(f.d.getElementById('two'),'textTracks',{value:[track2]});
   const collect=video=>f.api.collectCourseContext({chapterId:'a',video});f.api.mergeCourseContext(store,'a',collect(f.d.getElementById('one')));track1.cues.push({text:'后续加载'});f.api.mergeCourseContext(store,'a',collect(f.d.getElementById('one')));f.api.mergeCourseContext(store,'a',collect(f.d.getElementById('two')));
   assert.equal(store.items.length,2);assert(store.items[0].text.includes('后续加载'));assert(!f.api.mergeCourseContext(store,'b',[{kind:'note',text:'其他章笔记'}]));assert.deepEqual(plain(f.api.courseContextForPrompt(store,'b')),[]);const prompt=f.api.courseContextForPrompt(store,'a');assert.equal(prompt.length,2);assert(prompt.every(item=>!('sourceId' in item)));assert(!JSON.stringify(prompt).includes('其他章'));
  }finally{f.close();}
 });
 await test('字符与资料条数有界，拒绝未知字段，不带 DOM 或媒体地址',()=>{
  const f=fixture();try{const store=f.api.createCourseContext('a');f.api.mergeCourseContext(store,'a',Array.from({length:50},(_,i)=>({kind:'note',title:'资料 '+i,text:'字'.repeat(20000),sourceId:String(i),node:'不发送',mediaUrl:'https://example.com/secret',key:'mock-secret'})));const prompt=f.api.courseContextForPrompt(store,'a');assert(prompt.length<=f.api.COURSE_CONTEXT_LIMITS.items);assert(prompt.every(item=>item.text.length<=f.api.COURSE_CONTEXT_LIMITS.itemCharacters));assert(prompt.reduce((sum,item)=>sum+item.text.length,0)<=f.api.COURSE_CONTEXT_LIMITS.totalCharacters);assert(prompt.every(item=>item.truncated===true));assert(!JSON.stringify(prompt).includes('mock-secret'));assert(!JSON.stringify(prompt).includes('https://'));}finally{f.close();}
 });
 await test('分离节点与整页笔记容器不自动采集',()=>{
  const f=fixture('<section id="note">有效笔记</section>');try{const note=f.d.getElementById('note');note.remove();assert.deepEqual(plain(f.api.collectCourseContext({chapterId:'a',notesRoots:[note,f.d.documentElement]})),[]);}finally{f.close();}
 });
 await test('视频画面资料允许入库，但身份和请求字段仍只保留纯文本',()=>{
  const f=fixture();try{const store=f.api.createCourseContext('a');f.api.mergeCourseContext(store,'a',[{kind:'video-frame',title:'采样 30 秒',text:'画面上清楚显示的内容',sourceId:'v1-f1',image:'data:image/jpeg;base64,secret'}]);const result=plain(f.api.courseContextForPrompt(store,'a'));assert.equal(result.length,1);assert.equal(result[0].kind,'video-frame');assert(!JSON.stringify(result).includes('data:'));assert.deepEqual(plain(f.api.courseContextForPrompt(store,'b')),[]);}finally{f.close();}
 });
 await test('资料条数上限丢弃完整项时必须标明材料不完整',()=>{
  const f=fixture();try{const store=f.api.createCourseContext('a');f.api.mergeCourseContext(store,'a',Array.from({length:25},(_,i)=>({kind:'video-frame',title:'采样 '+i,text:'画面资料 '+i,sourceId:'frame-'+i})));const result=plain(f.api.courseContextForPrompt(store,'a'));assert.equal(result.length,24);assert(result.some(item=>item.truncated===true),'丢弃后半段资料不能冒充完整材料');}finally{f.close();}
 });
 await test('总字数上限丢弃完整项时必须标明材料不完整',()=>{
  const f=fixture();try{const store=f.api.createCourseContext('a');f.api.mergeCourseContext(store,'a',Array.from({length:4},(_,i)=>({kind:'note',title:'笔记 '+i,text:String(i).repeat(4000),sourceId:'note-'+i})));const result=plain(f.api.courseContextForPrompt(store,'a'));assert.equal(result.reduce((sum,item)=>sum+item.text.length,0),12000);assert(result.some(item=>item.truncated===true),'整项丢弃也要标注资料范围');}finally{f.close();}
 });
 await test('画面滚动窗口保留新采样，并优先腾出字幕与课件的位置',()=>{
  const f=fixture();try{const store=f.api.createCourseContext('a');f.api.mergeCourseContext(store,'a',Array.from({length:26},(_,i)=>({kind:'video-frame',title:'采样 '+i,text:'画面资料 '+i,sourceId:'frame-'+i})));f.api.mergeCourseContext(store,'a',[{kind:'subtitle',title:'后续视频',text:'第二个视频字幕',sourceId:'v2'},{kind:'document',title:'课件',text:'课堂定义',sourceId:'ppt'}]);const result=plain(f.api.courseContextForPrompt(store,'a'));assert.equal(result.length,24);assert(!result.some(item=>item.title==='采样 0'));assert(result.some(item=>item.title==='采样 25'));assert(result.some(item=>item.text==='第二个视频字幕'));assert(result.some(item=>item.text==='课堂定义'));assert(result.some(item=>item.truncated));}finally{f.close();}
 });
 await test('总字数有界时先淘汰早期画面，最新画面不会全部丢失',()=>{
  const f=fixture();try{const store=f.api.createCourseContext('a');f.api.mergeCourseContext(store,'a',Array.from({length:3},(_,i)=>({kind:'video-frame',title:'画面 '+i,text:String(i).repeat(4000),sourceId:'frame-'+i})));f.api.mergeCourseContext(store,'a',[{kind:'document',title:'课件',text:'课'.repeat(4000),sourceId:'ppt'},{kind:'note',title:'笔记',text:'笔'.repeat(4000),sourceId:'note'}]);const result=plain(f.api.courseContextForPrompt(store,'a'));assert(result.some(item=>item.title==='画面 2'));assert(!result.some(item=>item.title==='画面 0'));assert(result.some(item=>item.kind==='document'));assert(result.some(item=>item.kind==='note'));assert.equal(result.reduce((sum,item)=>sum+item.text.length,0),12000);assert(result.some(item=>item.truncated));}finally{f.close();}
 });
 await test('同源文字刷新保留新内容并提示资料为有界采样',()=>{
  const f=fixture();try{const store=f.api.createCourseContext('a');f.api.mergeCourseContext(store,'a',[{kind:'subtitle',title:'字幕',text:'最初资料',sourceId:'video'}]);f.api.mergeCourseContext(store,'a',[{kind:'subtitle',title:'字幕',text:'最初资料\n新增资料',sourceId:'video'}]);const result=plain(f.api.courseContextForPrompt(store,'a'));assert.equal(result.length,1);assert(result[0].text.includes('新增资料'));assert(result[0].truncated);}finally{f.close();}
 });
 await test('换章后旧视频事件不能把旧字幕添加到新章缓存',()=>{
  const f=fixture('<input id="curChapterId" value="a"><iframe id="old"></iframe><iframe id="current"></iframe>');try{
   const i=integration(f),oldDoc=f.d.getElementById('old').contentDocument,currentDoc=f.d.getElementById('current').contentDocument;
   oldDoc.body.innerHTML='<video></video>';currentDoc.body.innerHTML='<video></video>';const oldVideo=oldDoc.querySelector('video'),currentVideo=currentDoc.querySelector('video');
   Object.defineProperty(oldVideo,'textTracks',{value:[{kind:'subtitles',cues:[{text:'旧章字幕'}]}]});Object.defineProperty(currentVideo,'textTracks',{value:[{kind:'subtitles',cues:[{text:'新章字幕'}]}]});
   i.setDocuments([f.d,oldDoc]);const before=i.api.chapterContextIdentity(f.d);assert.equal(i.api.captureCurrentCourseContext(f.d,{video:oldVideo,expectedIdentity:before.id}).length,1);
   f.d.getElementById('curChapterId').value='b';i.setDocuments([f.d,currentDoc]);assert(oldVideo.isConnected,'此用例必须保持旧 iframe 内节点连接');assert.deepEqual(plain(i.api.captureCurrentCourseContext(f.d,{video:oldVideo,expectedIdentity:before.id})),[]);
   const result=i.api.captureCurrentCourseContext(f.d,{video:currentVideo});assert.equal(result.length,1);assert.equal(result[0].text,'新章字幕');assert(!JSON.stringify(result).includes('旧章'));
  }finally{f.close();}
 });
 await test('同章 iframe 替换后仍 connected 的旧媒体也不采集',()=>{
  const f=fixture('<input id="curChapterId" value="a"><iframe id="old"></iframe><iframe id="current"></iframe>');try{
   const i=integration(f),oldDoc=f.d.getElementById('old').contentDocument,currentDoc=f.d.getElementById('current').contentDocument;oldDoc.body.innerHTML='<video></video>';const oldVideo=oldDoc.querySelector('video');Object.defineProperty(oldVideo,'textTracks',{value:[{kind:'subtitles',cues:[{text:'替换前旧媒体'}]}]});i.setDocuments([f.d,currentDoc]);assert(oldVideo.isConnected);assert.deepEqual(plain(i.api.captureCurrentCourseContext(f.d,{video:oldVideo})),[]);
  }finally{f.close();}
 });
 await test('明确章节笔记仅采集当前章非空内容，不抓答案和其他章',()=>{
  const f=fixture('<input id="curChapterId" value="a"><section data-course-notes data-chapter-id="a">当前章笔记</section><section data-course-notes data-chapter-id="b">其他章笔记</section><section data-course-notes data-chapter-id="a"><p><br></p></section><section class="TiMu"><section data-course-notes data-chapter-id="a">已提交答案</section></section>');try{const i=integration(f);const result=plain(i.api.captureCurrentCourseContext(f.d));assert.equal(result.length,1);assert.equal(result[0].text,'当前章笔记');assert(!JSON.stringify(result).includes('答案'));assert(!JSON.stringify(result).includes('其他章'));i.setScope('course:c2');assert.equal(i.api.chapterContextStore(f.d).store.items.length,0);}finally{f.close();}
 });
 for(const log of logs)console.log(log);for(const error of failures)console.error(error);console.log(`course-context: ${logs.length} passed, ${failures.length} failed`);if(failures.length)process.exitCode=1;
})();
