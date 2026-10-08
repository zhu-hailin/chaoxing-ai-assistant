'use strict';
(async () => {
    const source = window.deliverySource || await (await fetch('../学习通AI助手.user.js')).text();
    const entry = "    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
    if (!source.includes(entry)) throw new Error('测试导出入口未匹配');
    const instrumented = source.replace(entry, `globalThis.testAPI = { initQuizAssistant, ensureFontDecoded, extract, signature, normalize, prefill, prefillChecked, resolveQuizHeader, runAnswerFlow, splitQuestionBatches, savedKeys, startQuizObserver, getWebEvidence, readCourseCatalog, readQuizScore, refreshCourseSidebar, navigateCourseChapter, get controller(){ return controller; } };`);
    const template = `<style>body{font:14px/1.5 system-ui;margin:0;color:#172038}.newTestTitle{padding:16px 24px;background:#f6f8fb;border-bottom:1px solid #dde3ef;display:flex;justify-content:space-between}.CeYan{padding:28px}.ceyan_name h3{font-size:20px;margin:0 0 12px}.ceyan_name p{color:#8693ab}.singleQuesId{padding-top:28px}.Zy_ulTop{padding:0;list-style:none}.Zy_ulTop li{display:flex;gap:16px;padding:10px;cursor:pointer}.num_option{border:1px solid #dce3ef;border-radius:50%;width:28px;height:28px;display:inline-flex;justify-content:center;align-items:center}.num_option.check{background:#5b80fa;color:white}input,textarea{max-width:100%}</style>
    <div id="RightCon"><div class="newTestTitle"><span>章节测验</span><span class="testTit_status">待完成</span></div><div class="radiusBG"><div class="CeYan"><div class="ceyan_name"><h3>计算机网络的定义和分类</h3><p>题量：4　满分：100</p></div><form><div class="ZyBottom" id="questions"></div><button type="button" id="save">暂时保存</button><button type="submit" id="submit">提交</button></form></div></div></div>`;
    const choice = (id, type, values) => `<div class="singleQuesId" ${id ? `data="${id}" id="question${id}"` : ''}><div class="Zy_TItle"><div class="fontLabel">【${type}题】测试题目${id || '无ID'}</div></div><ul class="Zy_ulTop">${values.map(([key, text]) => `<li role="${type === '多选' ? 'checkbox' : 'radio'}"><span class="num_option" data="${key}">${key}</span><a class="after">${text}</a></li>`).join('')}</ul><input type="hidden" name="answer${id || 'local-1'}"></div>`;
    const blank = `<div class="singleQuesId" data="4"><div class="Zy_TItle"><div class="fontLabel">【填空题】填写一个词</div></div><textarea></textarea></div>`;
    const allQuestions = choice('1', '单选', [['A', 'WAN'], ['B', 'LAN']]) + choice('2', '多选', [['A', '甲'], ['B', '乙'], ['C', '丙']]) + choice('3', '判断', [['true', '对'], ['false', '错']]) + blank;
    const answers = [{id:'1',answer:['B'],reason:'模拟'}, {id:'2',answer:['A','C'],reason:'模拟'}, {id:'3',answer:['true'],reason:'模拟'}, {id:'4',answer:['网络'],reason:'模拟'}];
    const courseTree = `<div id="content1"><div id="coursetree" class="posCatalog"><ul>
      <li><div class="posCatalog_select firstLayer" id="100"><span class="posCatalog_title" title="数据通信"><em class="posCatalog_sbar">1</em> 数据通信</span></div>
        <div class="posCatalog_level" style="display:none"><ul>
          <li><div class="posCatalog_select" id="cur101"><span class="posCatalog_name" title="通信方式"><em class="posCatalog_sbar">1.1</em> 通信方式</span><span class="icon_Completed"></span></div></li>
          <li><div class="posCatalog_select posCatalog_active" id="cur102"><span class="posCatalog_name" title="数据同步方式"><em class="posCatalog_sbar">1.2</em> 数据同步方式</span><span class="orangeNew">2</span></div>
            <ul><li><div class="posCatalog_select" id="cur103"><span class="posCatalog_name" title="同步传输"><em class="posCatalog_sbar">1.2.1</em> 同步传输</span><span class="orangeNew">1</span></div></li></ul>
          </li>
        </ul></div>
      </li>
      <li><div class="posCatalog_select firstLayer" id="200"><span class="posCatalog_title" title="网络应用"><em class="posCatalog_sbar">2</em> 网络应用</span></div>
        <div class="posCatalog_level"><ul><li><div class="posCatalog_select" id="cur201"><span class="posCatalog_name" title="阅读"><em class="posCatalog_sbar">2.1</em> 阅读</span><span class="orangeNew">0</span></div></li></ul></div>
      </li></ul></div></div>`;
    const logs = [];
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function fixture({questions = allQuestions, key = 'mock-key-not-real', preview = false, unpublished = false,
        catalog = false, ancestorCatalog = false, finalScore, stored = [],
        baseURL = 'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=test-course&classId=test-class&cpi=test-account&knowledgeid=102&workId=mock-work'} = {}) {
        let ancestor;
        if (catalog && ancestorCatalog) { ancestor=document.createElement('div');ancestor.innerHTML=courseTree;document.body.append(ancestor); }
        const frame = preview ? document.getElementById('preview') : document.createElement('iframe');
        if (!preview) document.getElementById('lab').append(frame);
        await new Promise(resolve => { frame.onload = resolve; frame.srcdoc = template; });
        const w = frame.contentWindow, d = w.document;
        d.getElementById('questions').innerHTML = questions;
        if(catalog) {
            const base=d.createElement('base');base.href=baseURL;d.head.append(base);
            if(!ancestorCatalog){const wrapper=d.createElement('div');wrapper.innerHTML=courseTree;d.body.append(wrapper);}
        }
        if(finalScore!==undefined) {
            d.querySelector('.testTit_status').textContent='已完成';
            const score=d.createElement('p');score.className='Finalresult';score.textContent='最终成绩';
            const value=d.createElement('i');value.textContent=String(finalScore);score.append(value);d.querySelector('.ceyan_name').append(score);
        }
        const storage = new Map([['deepseek_api_key', key], ['cx_model','mock-model'], ...stored]);
        w.GM_getValue = (k, f = '') => storage.has(k) ? storage.get(k) : f;
        w.GM_setValue = (k,v) => storage.set(k,v);
        w.GM_getResourceText = () => JSON.stringify({aaaaaaaa: 20057, bbbbbbbb: 19993});
        w.Typr = { parse: () => [{}], U: {codeToGlyph: (_,c) => [19968,20057].includes(c) ? c : 0, glyphToPath: (_,c) => c} };
        w.md5 = str => '0'.repeat(24) + (str === '19968' ? 'aaaaaaaa' : 'bbbbbbbb');
        let requests = [], requestMode = 'ok', clicks = 0, submits = 0;
        const catalogClicks=[];
        const catalogDoc=ancestorCatalog?document:d;
        if(catalog) for(const target of catalogDoc.querySelectorAll('#coursetree .posCatalog_name')) target.addEventListener('click',()=>{
            catalogClicks.push(target.parentElement.id);
            catalogDoc.querySelectorAll('#coursetree .posCatalog_active').forEach(el=>el.classList.remove('posCatalog_active'));
            target.parentElement.classList.add('posCatalog_active');
        });
        w.confirm = () => { throw new Error('不应该调用确认弹窗'); };
        w.GM_xmlhttpRequest = o => requests.push(o);
        d.querySelector('form').addEventListener('submit', e => { e.preventDefault(); submits++; });
        d.getElementById('save').addEventListener('click', () => submits++);
        for (const li of d.querySelectorAll('.Zy_ulTop li')) li.addEventListener('click', () => {
            clicks++;
            if (requestMode === 'unverified') return;
            setTimeout(() => {
                const q = li.closest('.singleQuesId');
                const type = q.querySelector('.fontLabel').textContent;
                if (!type.includes('多选')) q.querySelectorAll('li').forEach(x => { x.setAttribute('aria-checked', 'false'); x.querySelector('.num_option').classList.remove('check'); });
                const selected = li.getAttribute('aria-checked') !== 'true';
                li.setAttribute('aria-checked', String(selected));
                li.querySelector('.num_option').classList.toggle('check',selected);
                q.querySelector('input[type=hidden]').value = [...q.querySelectorAll('li[aria-checked=true]')].map(x=>x.querySelector('.num_option').getAttribute('data')).join(',');
            }, 50);
        });
        const script = d.createElement('script'); script.textContent = unpublished ? instrumented.replace("const PROJECT_GITHUB_URL = 'https://github.com/zhu-hailin/chaoxing-ai-assistant';", "const PROJECT_GITHUB_URL = '';") : instrumented; d.body.append(script);
        w.testAPI.initQuizAssistant();
        return {frame,w,d,storage,requests,catalogClicks,api:w.testAPI,get clicks(){return clicks},get submits(){return submits},set mode(v){requestMode=v},remove(){if(!preview){w.dispatchEvent(new w.Event('pagehide'));frame.remove();ancestor?.remove();}},respond(body = {choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers})}}]},status=200){const req=requests.shift();assert(req,'没有等待中的请求');req.onload({status,responseText:JSON.stringify(body)});}};
    }
    async function test(name, fn) {
        try { await fn(); logs.push(`PASS ${name}`); }
        catch(e) { logs.push(`FAIL ${name}: ${e.message}`); }
        document.getElementById('results').textContent = logs.join('\n');
    }
    async function pending(f) { for(let i=0;i<60 && !f.requests.length;i++)await delay(10);assert(f.requests.length,'请求未开始'); }
    await test('真实标题定位、工具条顺序、无旧悬浮按钮、重复初始化', async () => {
        const f=await fixture();
        assert(f.api.resolveQuizHeader()===f.d.querySelector('.ceyan_name'),'标题定位错误');
        assert(f.d.querySelector('.ceyan_name .cx-ai-title-row #cx-ai-toolbar'),'工具条不在标题行');
        const s=f.d.getElementById('cx-ai-toolbar').shadowRoot;
        assert(s.getElementById('generate').textContent.includes('一键生成答案') && s.getElementById('settings').textContent==='学习通AI助手','按钮文字');
        assert(!f.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('open'),'旧按钮未移除');
        f.api.initQuizAssistant();assert(f.d.querySelectorAll('#cx-ai-toolbar').length===1,'重复工具条');f.remove();
    });
    await test('一次点击生成并预填四题；互斥、圆环、设置锁定、不提交', async () => {
        const f=await fixture();const p=f.api.runAnswerFlow();await pending(f);
        await f.api.runAnswerFlow();assert(f.requests.length===1,'重复请求');
        const s=f.d.getElementById('cx-ai-toolbar').shadowRoot,panel=f.d.getElementById('cx-ai-study-root').shadowRoot;
        assert(!s.querySelector('.spinner').hidden && s.getElementById('generate').disabled,'缺少加载状态');
        assert(panel.getElementById('model').disabled && panel.getElementById('clear-ds').disabled,'配置未锁定');
        panel.getElementById('model').dispatchEvent(new f.w.Event('change'));assert(f.api.controller.state.busy,'配置事件解除互斥');
        s.getElementById('settings').click();assert(!panel.getElementById('panel').hidden,'执行时不能打开设置');
        f.respond();await p;assert(f.api.controller.state.phase==='done',f.api.controller.state.message);
        assert(f.api.controller.result.prefill.filled===4,'四题未全部确认');
        assert(panel.querySelectorAll('.question-card').length===4 && panel.querySelectorAll('.ai-answer').length===4,'答案未按题目显示');
        assert(f.d.querySelector('textarea').value==='网络','填空失败');assert(f.submits===0,'触发保存提交');
        assert(s.querySelector('.spinner').hidden && !s.getElementById('generate').disabled,'状态未恢复');f.remove();
    });
    await test('缺少 Key 自动打开设置，不发请求', async () => {
        const f=await fixture({key:''});await f.api.runAnswerFlow();
        assert(!f.requests.length && !f.api.controller.state.busy,'缺Key仍执行');assert(!f.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('panel').hidden,'未打开设置');f.remove();
    });
    await test('设置面板居中按标题顶部定位，点击切换和 Escape 关闭', async () => {
        const f=await fixture();const host=f.d.getElementById('cx-ai-study-root');
        const panel=host.shadowRoot.getElementById('panel');const settings=f.d.getElementById('cx-ai-toolbar').shadowRoot.getElementById('settings');
        f.d.querySelector('.ceyan_name').getBoundingClientRect=()=>({top:42});
        settings.click();assert(!panel.hidden && host.style.left==='50%' && host.style.top==='42px' && !host.style.bottom,'面板仍在底部');
        assert(panel.style.maxHeight.includes('580px'),'面板高度无上限');
        settings.click();assert(panel.hidden,'二次点击不关闭');settings.click();
        panel.dispatchEvent(new f.w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert(panel.hidden,'Escape不关闭');f.remove();
    });
    await test('GitHub 项目链接、未发布降级、圆形介绍按钮和免费说明', async () => {
        const f=await fixture();const s=f.d.getElementById('cx-ai-study-root').shadowRoot;
        assert(s.getElementById('about').hidden,'介绍默认未收起');
        s.getElementById('about-toggle').click();
        assert(!s.getElementById('about').hidden && s.getElementById('about-toggle').getAttribute('aria-expanded')==='true','问号无法展开');
        assert(s.getElementById('about').textContent.includes('免费使用'),'免费说明缺失');
        for (const removed of ['DeepSeek 原生 Web Search · 与 AI 共用同一个 Key · 每题有额外 Token 消耗', '已合并字体解密与鼠标移出播放优化。不会自动保存或提交测验；不同的已有选择不会被覆盖。', '请自备 DeepSeek API Key；模型调用及联网检索可能由服务商单独计费，这部分费用不是脚本收费。']) assert(!s.textContent.includes(removed),'已删除文案仍出现');
        assert(s.getElementById('about').textContent.includes('Chaoxing AI Assistant'),'英文名缺失');
        s.getElementById('about-close').click();assert(s.getElementById('about').hidden,'无法收起');
        let opened=[];f.w.open=(...args)=>opened.push(args);s.getElementById('github').click();
        assert(opened.length===1 && opened[0][0]==='https://github.com/zhu-hailin/chaoxing-ai-assistant' && opened[0][2]==='noopener,noreferrer','GitHub 链接错误');
        assert(!f.requests.length,'项目介绍不应请求模型');f.remove();
        const fallback=await fixture({unpublished:true});const other=fallback.d.getElementById('cx-ai-study-root').shadowRoot;let count=0;fallback.w.open=()=>count++;
        other.getElementById('github').click();assert(count===0 && !other.getElementById('about').hidden && other.getElementById('github-note').textContent.includes('尚未创建'),'未发布降级错误');fallback.remove();
    });
    await test('已有不同选项和非空填空保护；多选仅补充；再次预填幂等', async () => {
        const f=await fixture();f.d.querySelector('[data="1"] li').setAttribute('aria-checked','true');
        f.d.querySelector('[data="2"] li').setAttribute('aria-checked','true');f.d.querySelector('textarea').value='手工内容';
        const q=f.api.extract().questions,a=f.api.normalize({answers},q);const s=await f.api.prefill(q,a);
        assert(s.skipped===2 && s.filled===2,JSON.stringify(s));assert(f.d.querySelector('textarea').value==='手工内容','覆盖手工内容');
        const clicks=f.clicks;const again=await f.api.prefill(q,a);assert(again.already===2 && f.clicks===clicks,'重复预填改变选项');f.remove();
    });
    await test('后备 local ID 与隐藏多选 AC 的一致处理', async () => {
        const f=await fixture({questions:choice('', '单选', [['A','甲'],['B','乙']])});const q=f.api.extract().questions;
        const s=await f.api.prefill(q,f.api.normalize({answers:[{id:'local-1',answer:['B']}]},q));assert(s.filled===1,'后备ID无法预填');
        assert(f.api.savedKeys('AC',new Map([['A',1],['B',2],['C',3]])).join(',')==='A,C','多选解析错误');f.remove();
    });
    await test('生成期间题目变化中止预填', async () => {
        const f=await fixture();const p=f.api.runAnswerFlow();await pending(f);f.d.querySelector('.fontLabel').append('改变');f.respond();await p;
        assert(f.clicks===0 && f.api.controller.state.phase==='error','新题目被预填');assert(!f.api.controller.state.busy,'互斥未恢复');f.remove();
    });
    for(const mode of ['401','timeout','network','json','answers']) await test(`失败恢复：${mode}`, async () => {
        const f=await fixture();const p=f.api.runAnswerFlow();await pending(f);
        if(mode==='401')f.respond({error:{message:'Unauthorized'}},401);
        if(mode==='timeout')f.requests.shift().ontimeout();
        if(mode==='network')f.requests.shift().onerror();
        if(mode==='json')f.requests.shift().onload({status:200,responseText:'not json'});
        if(mode==='answers')f.respond({choices:[{finish_reason:'stop',message:{content:'{"answers":[]}'}}]});
        await p;assert(!f.api.controller.state.busy && f.api.controller.state.phase==='error' && f.clicks===0,'失败后状态错误');f.remove();
    });
    await test('联网响应缺少真实搜索来源时停止', async () => {
        const f=await fixture();f.storage.set('cx_search',true);const p=f.api.runAnswerFlow();await pending(f);
        f.respond({content:[{type:'text',text:'只是文本'}]});await p;
        assert(f.api.controller.state.phase==='error' && f.clicks===0 && !f.requests.length,'冒充检索或继续分析');f.remove();
    });
    await test('无法确认页面选中状态时报告 unverified', async () => {
        const f=await fixture({questions:choice('1','单选',[['A','甲'],['B','乙']])});f.mode='unverified';
        const q=f.api.extract().questions;const s=await f.api.prefill(q,f.api.normalize({answers},q));assert(s.unverified===1 && s.filled===0,'未确认被计为成功');f.remove();
    });
    await test('字体单次映射、并发重入、保留事件和 HTML、重复解密幂等', async () => {
        const f=await fixture();const style=f.d.createElement('style');style.textContent="@font-face{font-family:font-cxsecret;src:url('data:font/ttf;base64,AA==')}";f.d.head.append(style);
        const root=f.d.createElement('div');root.className='font-cxsecret';root.innerHTML='<button type="button">一乙</button><span class="font-cxsecret">一</span>';f.d.body.append(root);
        let hits=0;const button=root.querySelector('button');button.onclick=()=>hits++;
        await Promise.all([f.api.ensureFontDecoded(),f.api.ensureFontDecoded()]);
        assert(button.textContent==='乙丙' && root.querySelector('span').textContent==='乙','映射串联或重复解密');
        assert(!root.classList.contains('font-cxsecret'),'加密类未移除');button.click();assert(hits===1,'事件被破坏');
        await f.api.ensureFontDecoded();assert(button.textContent==='乙丙','重复调用破坏文字');f.remove();
    });
    await test('字体未知映射保留全部原文与加密标记', async () => {
        const f=await fixture();const style=f.d.createElement('style');style.textContent='@font-face{font-family:font-cxsecret;src:url("data:font/ttf;base64,AA==")}';f.d.head.append(style);
        // 丁在自定义字体中有字形，但字体表缺少其 hash；这才属于未知映射。
        f.w.Typr.U.codeToGlyph=(_,c)=>[19968,19969,20057].includes(c)?c:0;
        f.w.md5=str=>'0'.repeat(24)+(str==='19968'?'aaaaaaaa':str==='20057'?'bbbbbbbb':'cccccccc');
        const root=f.d.createElement('div');root.className='font-cxsecret';root.textContent='一丁';f.d.body.append(root);
        let rejected=false;try{await f.api.ensureFontDecoded()}catch{rejected=true}
        assert(rejected && root.textContent==='一丁' && root.classList.contains('font-cxsecret'),'失败部分替换原文');f.remove();
    });
    await test('加密容器内的题型标签和正常中文保持原文，仅转换自定义字体字形', async () => {
        const f=await fixture();const style=f.d.createElement('style');style.textContent='@font-face{font-family:font-cxsecret;src:url("data:font/ttf;base64,AA==")}';f.d.head.append(style);
        const root=f.d.createElement('div');root.className='font-cxsecret';root.innerHTML='<span class="newZy_TItle">【单选题】</span>局一乙，英文缩写（LAN）。';f.d.body.append(root);
        await f.api.ensureFontDecoded();
        assert(root.textContent==='【单选题】局乙丙，英文缩写（LAN）。','普通中文被错误处理');
        assert(!root.classList.contains('font-cxsecret'),'解密完成后未移除类');
        await f.api.ensureFontDecoded();assert(root.textContent==='【单选题】局乙丙，英文缩写（LAN）。','重复解密改变文本');f.remove();
    });
    await test('缺少字体资源阻止生成，但设置仍可用', async () => {
        const f=await fixture();f.d.querySelector('.fontLabel').classList.add('font-cxsecret');await f.api.runAnswerFlow();
        assert(!f.requests.length && !f.api.controller.state.busy && f.api.controller.state.phase==='error','字体错误未停止');
        f.d.getElementById('cx-ai-toolbar').shadowRoot.getElementById('settings').click();assert(!f.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('panel').hidden,'设置失效');f.remove();
    });
    await test('已完成明文结果页保留加密类但无字体声明，提取不误报', async () => {
        const f=await fixture();f.d.querySelector('.testTit_status').textContent='已完成';
        f.d.querySelectorAll('.fontLabel').forEach(e=>e.classList.add('font-cxsecret'));
        await f.api.controller.extractOnly();
        assert(f.api.controller.state.phase==='done',f.api.controller.state.message);
        assert(f.d.getElementById('cx-ai-study-root').shadowRoot.querySelectorAll('.question-card').length===4,'结果页提取失败');
        assert(!f.requests.length && f.submits===0,'提取触发外部操作');f.remove();
    });
    await test('已完成结果页仍有乱码或字体声明时不能绕过解密', async () => {
        for(const condition of ['garbled','declared']) {
            const f=await fixture();f.d.querySelector('.testTit_status').textContent='已完成';const title=f.d.querySelector('.fontLabel');title.classList.add('font-cxsecret');
            if(condition==='garbled')title.append('坁坅');
            else {const s=f.d.createElement('style');s.textContent="@font-face{font-family:'font-cxsecret';src:url('/unloaded-font.ttf')}";f.d.head.append(s);}
            await f.api.controller.extractOnly();assert(f.api.controller.state.phase==='error','错误放行未解密结果页');f.remove();
        }
    });
    await test('无标题时降级到首题前方；未知题型仍报错，101题提取通过', async () => {
        const f=await fixture();f.d.querySelector('.ceyan_name').remove();f.d.getElementById('cx-ai-toolbar')?.remove();f.api.initQuizAssistant();
        assert(f.d.querySelector('.singleQuesId').previousElementSibling.id==='cx-ai-toolbar','降级位置错误');
        f.d.querySelector('.fontLabel').textContent='【问答题】未知';let throws=0;try{f.api.extract()}catch{throws++}
        assert(throws===1,'未知题型被放行');
        f.d.getElementById('questions').innerHTML=Array.from({length:101},(_,i)=>choice(String(i+1),'单选',[['A','甲']])).join('');assert(f.api.extract().total===101,'仍限制总题数');f.remove();
    });
    const manyQuestions = n => Array.from({length:n},(_,i)=>choice(String(i+1),'单选',[['A','甲'],['B','乙']])).join('');
    function respondBatch(f) {
        const payload=JSON.parse(f.requests[0].data);
        const questions=JSON.parse(payload.messages[1].content).questions;
        f.respond({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:questions.map(q=>({id:q.id,answer:['A'],reason:'模拟分批'}))})}}]});
        return questions;
    }
    await test('26题分3批生成，全部成功后统一预填，互斥与加载保持', async () => {
        const f=await fixture({questions:manyQuestions(26)});const p=f.api.runAnswerFlow();const sizes=[];
        for(let i=0;i<3;i++) {
            await pending(f);assert(f.clicks===0,'未完成全部批次就预填');assert(f.api.controller.state.busy,'批间解除互斥');
            assert(!f.d.getElementById('cx-ai-toolbar').shadowRoot.querySelector('.spinner').hidden,'批间隐藏加载');
            await f.api.runAnswerFlow();assert(f.requests.length===1,'重复点击新增请求');
            sizes.push(respondBatch(f).length);
        }
        await p;const payload=f.api.controller.result;
        assert(sizes.join(',')==='10,10,6' && payload.prefill.filled===26 && payload.batchCount===3,'跨批合并或预填失败');
        assert(f.submits===0 && !f.api.controller.state.busy,'结束状态错误');f.remove();
    });
    await test('101题分11批分析，保持原题ID、全局编号及顺序', async () => {
        const f=await fixture({questions:manyQuestions(101)});const p=f.api.runAnswerFlow({autoPrefill:false});const ids=[];
        for(let i=0;i<11;i++) {await pending(f);assert(f.api.controller.state.message.includes(`第 ${i+1}/11 批`),'批进度错误');ids.push(...respondBatch(f).map(q=>q.id));}
        await p;const payload=f.api.controller.result;
        assert(payload.total===101 && payload.answers.every((a,i)=>a.id===String(i+1) && a.number===i+1),'ID编号或顺序错误');
        assert(new Set(ids).size===101 && f.clicks===0 && payload.batchCount===11,'题目丢失、重复或错误预填');
        assert(f.d.getElementById('cx-ai-study-root').shadowRoot.querySelectorAll('.question-card').length===101,'多题列表显示不完整');f.remove();
    });
    await test('长题按内容提前拆批，单题保持完整', async () => {
        const f=await fixture();const questions=Array.from({length:3},(_,i)=>({id:String(i),number:i+1,question:'长'.repeat(7000),options:[]}));
        const batches=f.api.splitQuestionBatches(questions);assert(batches.length===3 && batches.flat().every((q,i)=>q===questions[i]),'长题切分丢失内容');f.remove();
    });
    await test('第二批失败时不预填，清空旧结果并恢复按钮', async () => {
        const f=await fixture({questions:manyQuestions(26)});const output=f.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('output');f.api.controller.output(f.api.extract());
        const p=f.api.runAnswerFlow();await pending(f);respondBatch(f);await pending(f);f.requests.shift().ontimeout();await p;
        assert(f.clicks===0 && f.api.controller.last===null && f.api.controller.result===null && !output.querySelector('.question-card') && !f.api.controller.state.busy,'失败预填或残留旧结果');
        assert(f.api.controller.state.message.includes('第 2/3 批'),'未定位失败批次');f.remove();
    });
    await test('批间题目变化停止后续请求，未完成批次不预填', async () => {
        const f=await fixture({questions:manyQuestions(26)});const p=f.api.runAnswerFlow();await pending(f);
        f.d.querySelector('.fontLabel').append('改变');respondBatch(f);await p;
        assert(!f.requests.length && f.clicks===0 && f.api.controller.state.phase==='error','题目变化后继续请求或预填');f.remove();
    });
    await test('21题联网检索按批处理，来源按题ID合并且不混入其他批次', async () => {
        const f=await fixture({questions:manyQuestions(21)});f.storage.set('cx_search',true);const p=f.api.runAnswerFlow({autoPrefill:false});let searched=0;
        for(const size of [10,10,1]) {
            for(let j=0;j<size;j++) {
                await pending(f);assert(f.requests[0].url.includes('/anthropic/'),'未先执行检索');searched++;
                f.respond({content:[{type:'web_search_tool_result',content:[{type:'web_search_result',url:`https://example.com/source/${searched}`,title:'模拟来源'}]}]});
            }
            await pending(f);const body=JSON.parse(f.requests[0].data);const input=JSON.parse(body.messages[1].content);
            assert(Object.keys(input.evidence).length===size && input.questions.every(q=>input.evidence[q.id]),'检索来源与批次不匹配');respondBatch(f);
        }
        await p;const payload=f.api.controller.result;
        assert(payload.total===21 && Object.keys(payload.evidence).length===21 && payload.evidence['21'][0].url.endsWith('/21'),'合并检索来源丢失');
        assert(f.clicks===0 && f.api.controller.state.phase==='done','联网分批失败');f.remove();
    });
    await test('提取四种题型为列表，复制可读文本，无 JSON 结果框或模型请求', async () => {
        const f=await fixture();await f.api.controller.extractOnly();
        const s=f.d.getElementById('cx-ai-study-root').shadowRoot,output=s.getElementById('output');
        const cards=[...output.querySelectorAll('.question-card')];
        assert(output.tagName==='DIV' && cards.length===4 && !s.querySelector('textarea#output'),'仍使用 JSON 文本框');
        assert(cards.map(card=>card.querySelector('.question-type').textContent).join(',')==='单选题,多选题,判断题,填空题','题型列表错误');
        assert(cards[0].querySelector('.question-text').textContent==='测试题目1' && cards[0].querySelectorAll('.option-item').length===2,'题干选项未显示');
        assert(!output.querySelector('.ai-answer') && !f.requests.length && f.clicks===0,'提取冒充 AI 答案或修改页面答案');
        assert(output.getAttribute('aria-label')==='题目列表' && output.querySelector('.result-summary').textContent==='题目列表 · 共 4 题','题目列表标题错误');
        assert(!output.textContent.includes('"questions":') && !output.textContent.includes('"options":'),'仅提取阶段仍显示原始 JSON');
        let copied='';Object.defineProperty(f.w.navigator,'clipboard',{value:{writeText:async text=>{copied=text}},configurable:true});
        await s.getElementById('copy').onclick();
        assert(copied.includes('1. 【单选题】测试题目1') && copied.includes('B. LAN') && !copied.includes('"questions"') && !copied.includes('mock-key-not-real'),'复制内容不是可读列表或包含 Key');
        assert(f.api.controller.state.message==='列表复制成功','复制未完成');f.remove();
    });
    await test('选项重复序号只显示一次，正文与不匹配前缀保留', async () => {
        const f=await fixture({questions:choice('1','单选',[['A','A、甲'],['B','B. 乙'],['C','C．丙'],['D','A1型号'],['E','F、原文']])});
        await f.api.controller.extractOnly();
        const options=f.api.controller.result.questions[0].options;
        assert(options.map(o=>o.text).join('|')==='甲|乙|丙|A1型号|F、原文','前缀清理误改正文');
        const output=f.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('output');
        assert(output.querySelectorAll('.option-key').length===5 && !output.textContent.includes('A、甲'),'列表序号重复');
        assert(f.api.controller.result.questions[0].options[0].key==='A','选项键被修改');
        f.d.querySelector('a.after').remove();
        f.d.querySelector('.Zy_ulTop li').append('甲');
        assert(f.api.extract().questions[0].options[0].text==='甲','后备提取包含控件序号');
        f.remove();
    });
    await test('AI 乱序答案按 ID 对齐四种题型，题干与解析作为文本显示', async () => {
        const f=await fixture();f.d.querySelector('.fontLabel').textContent='【单选题】题干 <b>原始文字</b>';
        const s=f.d.getElementById('cx-ai-study-root').shadowRoot,p=f.api.runAnswerFlow({autoPrefill:false});await pending(f);
        assert(s.querySelectorAll('.question-card').length===4 && !s.querySelector('.ai-answer'),'请求期间未显示题目列表或提前显示旧答案');
        assert(s.querySelector('.result-summary').textContent==='题目列表 · 共 4 题','AI 等待期间未保留题目列表');
        const changed=answers.map(a=>({...a,reason:a.id==='1'?'<img src=x onerror="alert(1)">理由':a.reason})).reverse();
        f.respond({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:changed})}}]});await p;
        const card=id=>s.querySelector(`[data-question-id="${id}"]`);
        assert(s.getElementById('output').getAttribute('aria-label')==='题目与答案列表','生成后仍标为未生成');
        assert(card('1').querySelector('.ai-answer').textContent==='AI 答案：B. LAN','单选答案错位');
        assert(card('2').querySelector('.ai-answer').textContent.includes('A. 甲；C. 丙') && card('2').querySelectorAll('.is-answer').length===2,'多选未完整显示');
        assert(card('3').querySelector('.ai-answer').textContent==='AI 答案：对' && card('4').querySelector('.ai-answer').textContent==='AI 答案：网络','判断或填空未转为可读答案');
        assert(card('1').querySelector('.answer-reason').textContent.includes('<img') && !s.querySelector('img') && !card('1').querySelector('b'),'外部文本被解释为 HTML');
        assert(f.clicks===0 && f.submits===0,'仅分析时发生预填或提交');f.remove();
    });
    await test('无效答案提示人工核对，来源仅显示安全链接', async () => {
        const f=await fixture({questions:choice('1','单选',[['A','甲'],['B','乙']])});const p=f.api.runAnswerFlow({autoPrefill:false});await pending(f);
        f.respond({choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers:[{id:'1',answer:['Z'],reason:'错误选项'}]})}}]});await p;
        const s=f.d.getElementById('cx-ai-study-root').shadowRoot;
        assert(s.querySelector('.ai-answer.needs-review').textContent.includes('人工核对') && !s.querySelector('.is-answer'),'无效答案当作正确答案显示');
        f.api.controller.output({...f.api.controller.result,evidence:{'1':[{url:'javascript:alert(1)',title:'错误链接'},{url:'https://example.com/source',title:'参考网页'}]}});
        const links=s.querySelectorAll('.answer-sources a');
        assert(links.length===1 && links[0].href==='https://example.com/source' && links[0].rel==='noopener noreferrer','来源链接未过滤或没有保护新窗口');f.remove();
    });
    await test('列表为空和剪贴板拒绝时给出反馈，不触发外部请求', async () => {
        const f=await fixture();const s=f.d.getElementById('cx-ai-study-root').shadowRoot;await s.getElementById('copy').onclick();
        assert(f.api.controller.state.message==='尚无题目列表','空列表复制错误');await f.api.controller.extractOnly();
        Object.defineProperty(f.w.navigator,'clipboard',{value:{writeText:async()=>{throw new Error('denied')}},configurable:true});
        await s.getElementById('copy').onclick();
        assert(f.api.controller.state.message.includes('Ctrl+C') && !f.requests.length && !f.api.controller.state.busy,'剪贴板失败未恢复');f.remove();
    });
    await test('跨 iframe 读取完整目录，包含页面折叠隐藏的子章节和当前章节', async () => {
        const f=await fixture({catalog:true,ancestorCatalog:true});const context=f.api.readCourseCatalog();
        assert(context.sourceDoc===document && context.entries.length===6,'未从祖先文档读完整目录');
        const s=f.d.getElementById('cx-ai-study-root').shadowRoot;
        assert(s.querySelectorAll('.catalog-item').length===6 && s.querySelector('[data-chapter-button="cur102"]').getAttribute('aria-current')==='page','目录缺失或当前章节标记错误');
        assert(s.querySelector('[data-chapter-button="cur101"] .catalog-state').textContent==='已完成','完成状态错误');
        assert(s.querySelector('[data-chapter-button="cur102"] .catalog-state').textContent==='待完成 · 2项','待完成任务数错误');
        assert(!f.requests.length && !f.catalogClicks.length,'读取目录触发模型或章节切换');f.remove();
    });
    await test('目录搜索保留父级，展开收起和目录栏切换正常', async () => {
        const f=await fixture({catalog:true});const s=f.d.getElementById('cx-ai-study-root').shadowRoot;
        const fold=s.querySelector('[data-chapter-id="100"] > .catalog-row .catalog-fold');fold.click();
        assert(s.querySelector('[data-chapter-id="100"] > .catalog-children').hidden,'目录无法收起');
        const search=s.getElementById('catalog-search');search.value='同步传输';search.dispatchEvent(new f.w.Event('input'));
        assert(s.querySelectorAll('.catalog-item').length===3 && !s.querySelector('[data-chapter-id="100"] > .catalog-children').hidden,'搜索结果没有父级或被折叠隐藏');
        search.value='不存在';search.dispatchEvent(new f.w.Event('input'));assert(s.getElementById('catalog-list').textContent==='没有匹配的章节','搜索空结果错误');
        assert(s.getElementById('course-nav').hidden,'目录栏应默认收起');
        const toggle=s.getElementById('catalog-toggle');assert(!toggle.closest('.head') && toggle.querySelector('svg'),'目录入口应为左侧独立图标');assert(toggle.closest('.assistant-main'),'侧栏按钮应留在主内容区上方');
        toggle.click();assert(!s.getElementById('course-nav').hidden && toggle.getAttribute('aria-expanded')==='true','目录栏无法打开');
        toggle.click();assert(s.getElementById('course-nav').hidden && toggle.getAttribute('aria-expanded')==='false','目录栏无法隐藏');f.remove();
    });
    await test('目录从左侧展开与收回，主内容宽度和右边缘保持', async () => {
        const f=await fixture({catalog:true});f.api.controller.openPanel();
        const host=f.d.getElementById('cx-ai-study-root'),s=host.shadowRoot;
        host.getBoundingClientRect=()=>{const width=s.getElementById('panel').dataset.catalogHidden==='true'?630:876;const left=host.style.transform==='none'?parseFloat(host.style.left):350;return {left,top:70,width,right:left+width};};
        const toggle=s.getElementById('catalog-toggle');
        toggle.click();
        assert(parseFloat(host.style.left)===104,'展开目录未向左移动新增宽度');
        assert(876-230-16===630,'主内容区宽度发生变化');
        assert(host.getBoundingClientRect().right===980,'展开后窗口右边缘移动');
        toggle.click();assert(parseFloat(host.style.left)===350 && host.getBoundingClientRect().right===980,'收起后主内容未保持原位');
        f.remove();
    });
    await test('章节导航委托原页面节点，清除旧结果，不调用模型或提交', async () => {
        const f=await fixture({catalog:true});const s=f.d.getElementById('cx-ai-study-root').shadowRoot;await f.api.controller.extractOnly();
        s.querySelector('[data-chapter-button="cur101"]').click();
        assert(f.catalogClicks.join(',')==='cur101' && f.api.controller.result===null && f.api.controller.last===null,'导航未委托原节点或残留旧结果');
        assert(!f.requests.length && !f.clicks && !f.submits,'目录点击触发模型、答案填写或提交');await delay(140);
        assert(s.querySelector('[data-chapter-button="cur101"]').getAttribute('aria-current')==='page','当前章节未更新');f.remove();
    });
    await test('分析期间禁用章节跳转，直接调用导航也不会解除互斥', async () => {
        const f=await fixture({catalog:true});const s=f.d.getElementById('cx-ai-study-root').shadowRoot,p=f.api.runAnswerFlow({autoPrefill:false});await pending(f);
        assert(s.querySelector('[data-chapter-button="cur101"]').disabled && s.getElementById('catalog-refresh').disabled,'分析期间目录入口未锁定');
        f.api.navigateCourseChapter('cur101');assert(!f.catalogClicks.length && f.api.controller.state.busy,'分析期间切换章节或解除互斥');
        f.respond();await p;assert(!s.querySelector('[data-chapter-button="cur101"]').disabled,'分析后目录按钮未恢复');f.remove();
    });
    await test('已完成测验成绩缓存到所属章节，跨课程和账号隔离', async () => {
        const base='https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=test-course&classId=test-class&cpi=test-account&knowledgeid=101&workId=mock-work';
        const f=await fixture({catalog:true,finalScore:100,baseURL:base});const s=f.d.getElementById('cx-ai-study-root').shadowRoot;
        assert(s.querySelector('[data-chapter-button="cur101"] .catalog-score').textContent==='测验 100 分' && !s.querySelector('[data-chapter-button="cur102"] .catalog-score'),'成绩写到了当前高亮的其他章节');
        const stored=[...f.storage];f.remove();
        const next=await fixture({catalog:true,stored});assert(next.d.getElementById('cx-ai-study-root').shadowRoot.querySelector('[data-chapter-button="cur101"] .catalog-score').textContent==='测验 100 分','切换后丢失已查看成绩');next.remove();
        for(const changed of [base.replace('test-course','other-course'),base.replace('test-account','other-account')]) {
            const other=await fixture({catalog:true,stored,baseURL:changed});assert(!other.d.getElementById('cx-ai-study-root').shadowRoot.querySelector('.catalog-score'),'其他课程或账号读到了缓存成绩');other.remove();
        }
    });
    await test('只读取最终成绩，支持零分和小数，不把单题得分当测验分数', async () => {
        const f=await fixture({catalog:true,finalScore:0});const distract=f.d.createElement('div');distract.className='newAnswerScore';distract.textContent='单题得分 25 分';f.d.querySelector('.singleQuesId').append(distract);
        f.d.querySelector('.testTit_status').textContent='待完成';assert(f.api.readQuizScore()===null,'未完成测验的占位分数被读取');f.d.querySelector('.testTit_status').textContent='已完成';
        assert(f.api.readQuizScore().score===0,'零分遗漏');const value=f.d.querySelector('.Finalresult i');value.textContent='87.5';f.api.refreshCourseSidebar();
        assert(f.d.getElementById('cx-ai-study-root').shadowRoot.querySelector('.catalog-score').textContent==='测验 87.5 分','小数成绩未更新');
        value.textContent='待批阅';assert(f.api.readQuizScore()===null,'无法读取成绩时编造数值');f.d.querySelector('.Finalresult').remove();assert(f.api.readQuizScore()===null,'单题得分被当作总成绩');f.remove();
    });
    await test('同一章节多个测验成绩分别保留，未知分数不显示', async () => {
        const f=await fixture({catalog:true,finalScore:95});const stored=[...f.storage];f.remove();
        const next=await fixture({catalog:true,finalScore:80,stored,baseURL:'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseId=test-course&classId=test-class&cpi=test-account&knowledgeid=102&workId=second-work'});
        const s=next.d.getElementById('cx-ai-study-root').shadowRoot;
        assert([...s.querySelectorAll('[data-chapter-button="cur102"] .catalog-score')].map(el=>el.textContent).join(',')==='测验 95 分,测验 80 分','不同测验互相覆盖');
        assert(!s.querySelector('[data-chapter-button="cur201"] .catalog-score'),'没有成绩的章节显示了分数');next.remove();
    });
    await test('目录动态载入及完成状态变化会刷新，成绩不从完成图标推断', async () => {
        const f=await fixture({catalog:true});const row=f.d.getElementById('cur102');row.querySelector('.orangeNew').remove();const done=f.d.createElement('span');done.className='icon_Completed';row.append(done);
        const added=f.d.createElement('li');added.innerHTML='<div class="posCatalog_select" id="cur202"><span class="posCatalog_name" title="新增章节"><em class="posCatalog_sbar">2.2</em> 新增章节</span></div>';
        f.d.getElementById('cur201').closest('ul').append(added);await delay(150);const s=f.d.getElementById('cx-ai-study-root').shadowRoot;
        assert(s.querySelectorAll('.catalog-item').length===7 && s.querySelector('[data-chapter-button="cur102"] .catalog-state').textContent==='已完成','动态目录或状态未更新');
        assert(!s.querySelector('.catalog-score'),'仅凭完成标记推断了分数');f.remove();
    });
    await test('独立测验缺少课程目录时给出说明，原助手功能仍可用', async () => {
        const f=await fixture();const s=f.d.getElementById('cx-ai-study-root').shadowRoot;
        assert(s.getElementById('catalog-list').textContent.includes('未读取到课程目录'),'缺少目录时没有说明');await f.api.controller.extractOnly();
        assert(s.querySelectorAll('.question-card').length===4 && f.api.controller.state.phase==='done','目录缺失破坏提取题目');f.remove();
    });
    const preview=await fixture({preview:true,catalog:true,finalScore:100});
    await preview.api.controller.extractOnly();
    preview.api.controller.openPanel();
    // 预览使用生产启动观察器，核对动态替换和窄屏布局。
    preview.api.startQuizObserver();
    const failures=logs.filter(x=>x.startsWith('FAIL'));
    document.getElementById('results').className=failures.length?'fail':'pass';
    document.getElementById('results').textContent=`${logs.length-failures.length}/${logs.length} 通过\n`+logs.join('\n');
    window.testResults={total:logs.length,failures,logs};
})().catch(e=>{document.getElementById('results').textContent=`测试加载失败：${e.stack}`;window.testResults={failures:[e.message]};});
