"""构建离线模拟课程：生产脚本 + 合成任务/进度/模型响应，禁止真实请求。"""
from pathlib import Path
import json

root = Path(__file__).resolve().parent.parent
source = (root / '学习通AI助手.user.js').read_text(encoding='utf-8')
entry = "    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();"
assert entry in source
source = source.replace(entry, 'globalThis.courseAPI={initStudyAssistant,createCourseRunner,courseTabs,courseFrameTree,courseDocumentReader,courseSubmitButton,courseQuizComplete,courseReportText,courseRunActive,get controller(){return controller},replaceRunner(r){courseRunner=r}};')
# 仅预览替换页面识别；交付脚本保留真实域名与路径检查。
source = source.replace('function pageURL(doc) {', "function pageURL(doc) { if(doc === window.top.document) return new URL('https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=mock-demo-course&clazzid=mock-demo-class&cpi=mock-demo-account');")
test = (root / 'tests/course-runner-dom.cjs').read_text(encoding='utf-8')
fixture = test[test.index('function fixture('):test.index('\nconst video=')]
# 浏览器预览不依赖测试进程的 VirtualConsole / assert；外部 DOM 验证自行收集异常。
fixture = fixture.replace(" const runtimeErrors=[],virtualConsole=new VirtualConsole();virtualConsole.on('jsdomError',error=>runtimeErrors.push(error.message));\n", '')
fixture = fixture.replace('pretendToBeVisual:true,virtualConsole', 'pretendToBeVisual:true')
fixture = fixture.replace("assert.deepEqual(runtimeErrors,[],'页面或已销毁 iframe 存在未处理异常');", '')
assert 'VirtualConsole' not in fixture and 'runtimeErrors' not in fixture
fixture = fixture.replace('},10);timers.add(playing)', '},350);timers.add(playing)')
fixture = fixture.replace("const doc=frame.contentDocument;doc.body.innerHTML=", "const doc=frame.contentDocument;doc.head.innerHTML='<style>body{font:15px/1.6 system-ui;color:#27354a;margin:18px}video{display:block;width:100%;height:160px;background:#17233b;border-radius:8px}textarea{width:100%;min-height:80px;padding:10px;border:1px solid #dae2ed}button{padding:6px 12px}label{display:block;margin:8px 0}</style>';doc.body.innerHTML=")
fixture = fixture.replace('container.append(video);let time=', "container.append(video);const caption=doc.createElement('p');caption.textContent='模拟视频 '+(i+1)+'（合成时间进度，不请求视频资源）';container.prepend(caption);let time=")
fixture = fixture.replace('dom.window.close();', '')
html = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>v1.06 自动课程模拟</title>
<style>*{box-sizing:border-box}body{font:14px/1.6 "Microsoft YaHei",system-ui;color:#26354a;background:#f1f4f8;margin:0;padding:20px}.demo-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:0 0 16px}.demo-head h1{font-size:20px;margin:0}.demo-head p{width:100%;margin:0;color:#63748b}.demo-head button,.demo-head select{font:inherit;padding:7px 11px;border:1px solid #dce3ec;border-radius:6px;background:#fff;color:#26354a;cursor:pointer}#mainid{max-width:940px;padding:20px;background:white;border:1px solid #dde4ee;border-radius:12px}#prev_tab{display:flex;gap:8px;margin-bottom:14px}#prev_tab li{list-style:none;padding:6px 14px;border-radius:16px;background:#eef2fb;cursor:pointer}#prev_tab li.active{background:#426ddd;color:#fff}#mainid>iframe{width:100%;height:460px;border:1px solid #e3e8ef;border-radius:8px}.demo-log{font-size:12px;color:#6b7b90;margin-top:12px}#content1{display:none}</style>
<script>const code=__SOURCE__;
class JSDOM { constructor(html) {document.body.innerHTML=html;this.window=window;} }
const LIMITS={pollMs:100,settleMs:150,loadMs:5000,videoLoadMs:5000,completionMs:1800,stallMs:5000,resumeMs:200,maxResumes:8,slideMs:500,submitMs:2500};
__FIXTURE__
const video=(extra={})=>({title:'视频',tasks:[{kind:'video',duration:6,...extra}]});
const ppt=()=>({title:'资料',tasks:[{kind:'ppt'}]});
const quiz=(extra={})=>({title:'章节测验',tasks:[{kind:'quiz',essay:true,confirm:true,...extra}]});
window.addEventListener('DOMContentLoaded',()=>{
 const scene=new URL(location.href).searchParams.get('scene')||'normal';
 let chapters=[{title:'多视频与测验',tabs:[{title:'视频',tasks:[{kind:'video',duration:6,start:1,pauseAt:3},{kind:'video',duration:5}]},ppt(),quiz()]},{title:'纯文字材料',tabs:[{title:'资料',text:'这一章只有文字材料，没有视频，也没有章节测验。'}]},{title:'单视频章节',tabs:[video()]}],opts={requestMs:400};
 if(scene==='face')chapters=[{title:'人脸识别演示',tabs:[video({faceOnPlay:true})]}];
 if(scene==='unanswered')chapters=[{title:'未知题型演示',tabs:[quiz({essay:false,unknown:true,count:2})]}];
 if(scene==='ppt-failed'){chapters=[{title:'PPT 完成状态未确认',tabs:[ppt()]}];opts.noAck=true;}
 if(scene==='survey')chapters=[{title:'需手动问卷',tabs:[{title:'问卷',tasks:[{kind:'survey'}]}]},{title:'问卷后的视频',tabs:[video()]}];
 if(scene==='scroll-ppt')chapters=[{title:'视频与滚动PPT混合',tabs:[video(),{title:'PPT',tasks:[{kind:'scroll'}]}]}];
 if(scene==='no-task')chapters=[{title:'无任务点资料',unknownStatus:true,tabs:[{title:'PPT',tasks:[{kind:'scroll',optional:true}]}]},{title:'后续视频',tabs:[video()]}];
 if(scene==='completed-quiz')chapters=[{title:'先完成测验的章节',tabs:[quiz({complete:true}),video()]}];
 if(scene==='pause'){chapters=[{title:'暂停自动恢复',tabs:[video({pauseAt:3})]}];}
 const f=fixture(chapters,opts);window.courseDemo=f;
 const header=document.createElement('header');header.className='demo-head';header.innerHTML='<h1>自动课程 · 本地模拟 v1.06</h1><select aria-label="模拟场景"><option value="normal">完整流程</option><option value="pause">视频暂停恢复</option><option value="face">人脸识别停止</option><option value="unanswered">无法自动作答</option><option value="ppt-failed">PPT 未确认完成</option><option value="survey">问卷与跳过本章节</option><option value="scroll-ppt">视频与滚动 PPT 混合</option><option value="no-task">无任务点直接下一节</option><option value="completed-quiz">已完成测验跳过作答</option></select><button id="open-demo">打开章节助手</button><button id="reset-demo">重置模拟</button><p>仅合成页面、模拟进度和模拟 AI 回答，不访问课程或 DeepSeek。打开助手后，在章节页点击「开始刷课」。</p>';document.body.prepend(header);
 header.querySelector('select').value=scene;header.querySelector('select').onchange=e=>{location.search='scene='+e.target.value;};
 header.querySelector('#open-demo').onclick=()=>f.api.controller.openPanel('chapters');header.querySelector('#reset-demo').onclick=()=>location.reload();
 const note=document.createElement('p');note.className='demo-log';note.textContent='正常场景包含：同页两个视频 → PPT 末页 → 简答题提交 → 无视频/测验章节 → 下一视频。';document.body.append(note);
 f.api.controller.openPanel('chapters');
});</script></html>'''
html = html.replace('__SOURCE__', json.dumps(source, ensure_ascii=False).replace('</', '<\\/')).replace('__FIXTURE__', fixture.replace('</', '<\\/'))
(root / 'tests/自动课程模拟.html').write_text(html, encoding='utf-8', newline='\n')
print('Built offline course demo (mock only)')
