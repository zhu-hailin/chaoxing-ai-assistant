'use strict';
(async () => {
    const source = window.deliverySource || await (await fetch('../学习通AI助手.user.js')).text();
    const entry = "    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startQuizObserver, { once: true });\n    else startQuizObserver();";
    if (!source.includes(entry)) throw new Error('测试导出入口未匹配');
    const instrumented = source.replace(entry, `globalThis.testAPI = { initQuizAssistant, ensureFontDecoded, extract, signature, normalize, prefill, prefillChecked, resolveQuizHeader, runAnswerFlow, savedKeys, startQuizObserver, getWebEvidence, get controller(){ return controller; } };`);
    const template = `<style>body{font:14px/1.5 system-ui;margin:0;color:#172038}.newTestTitle{padding:16px 24px;background:#f6f8fb;border-bottom:1px solid #dde3ef;display:flex;justify-content:space-between}.CeYan{padding:28px}.ceyan_name h3{font-size:20px;margin:0 0 12px}.ceyan_name p{color:#8693ab}.singleQuesId{padding-top:28px}.Zy_ulTop{padding:0;list-style:none}.Zy_ulTop li{display:flex;gap:16px;padding:10px;cursor:pointer}.num_option{border:1px solid #dce3ef;border-radius:50%;width:28px;height:28px;display:inline-flex;justify-content:center;align-items:center}.num_option.check{background:#5b80fa;color:white}input,textarea{max-width:100%}</style>
    <div id="RightCon"><div class="newTestTitle"><span>章节测验</span><span class="testTit_status">待完成</span></div><div class="radiusBG"><div class="CeYan"><div class="ceyan_name"><h3>计算机网络的定义和分类</h3><p>题量：4　满分：100</p></div><form><div class="ZyBottom" id="questions"></div><button type="button" id="save">暂时保存</button><button type="submit" id="submit">提交</button></form></div></div></div>`;
    const choice = (id, type, values) => `<div class="singleQuesId" ${id ? `data="${id}" id="question${id}"` : ''}><div class="Zy_TItle"><div class="fontLabel">【${type}题】测试题目${id || '无ID'}</div></div><ul class="Zy_ulTop">${values.map(([key, text]) => `<li role="${type === '多选' ? 'checkbox' : 'radio'}"><span class="num_option" data="${key}">${key}</span><a class="after">${text}</a></li>`).join('')}</ul><input type="hidden" name="answer${id || 'local-1'}"></div>`;
    const blank = `<div class="singleQuesId" data="4"><div class="Zy_TItle"><div class="fontLabel">【填空题】填写一个词</div></div><textarea></textarea></div>`;
    const allQuestions = choice('1', '单选', [['A', 'WAN'], ['B', 'LAN']]) + choice('2', '多选', [['A', '甲'], ['B', '乙'], ['C', '丙']]) + choice('3', '判断', [['true', '对'], ['false', '错']]) + blank;
    const answers = [{id:'1',answer:['B'],reason:'模拟'}, {id:'2',answer:['A','C'],reason:'模拟'}, {id:'3',answer:['true'],reason:'模拟'}, {id:'4',answer:['网络'],reason:'模拟'}];
    const logs = [];
    const assert = (value, message) => { if (!value) throw new Error(message); };
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    async function fixture({questions = allQuestions, key = 'mock-key-not-real', preview = false, unpublished = false} = {}) {
        const frame = preview ? document.getElementById('preview') : document.createElement('iframe');
        if (!preview) document.getElementById('lab').append(frame);
        await new Promise(resolve => { frame.onload = resolve; frame.srcdoc = template; });
        const w = frame.contentWindow, d = w.document;
        d.getElementById('questions').innerHTML = questions;
        const storage = new Map([['deepseek_api_key', key], ['cx_model','mock-model']]);
        w.GM_getValue = (k, f = '') => storage.has(k) ? storage.get(k) : f;
        w.GM_setValue = (k,v) => storage.set(k,v);
        w.GM_getResourceText = () => JSON.stringify({aaaaaaaa: 20057, bbbbbbbb: 19993});
        w.Typr = { parse: () => [{}], U: {codeToGlyph: (_,c) => [19968,20057].includes(c) ? c : 0, glyphToPath: (_,c) => c} };
        w.md5 = str => '0'.repeat(24) + (str === '19968' ? 'aaaaaaaa' : 'bbbbbbbb');
        let requests = [], requestMode = 'ok', clicks = 0, submits = 0;
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
        return {frame,w,d,storage,requests,api:w.testAPI,get clicks(){return clicks},get submits(){return submits},set mode(v){requestMode=v},remove(){if(!preview)frame.remove()},respond(body = {choices:[{finish_reason:'stop',message:{content:JSON.stringify({answers})}}]},status=200){const req=requests.shift();assert(req,'没有等待中的请求');req.onload({status,responseText:JSON.stringify(body)});}};
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
        assert(JSON.parse(panel.getElementById('output').value).prefill.filled===4,'四题未全部确认');
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
        assert(s.getElementById('about').textContent.includes('免费使用') && s.getElementById('about').textContent.includes('单独计费'),'免费与API费用说明缺失');
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
        assert(JSON.parse(f.d.getElementById('cx-ai-study-root').shadowRoot.getElementById('output').value).total===4,'结果页提取失败');
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
    await test('无标题时降级到首题前方；未知题型和超过25题报错', async () => {
        const f=await fixture();f.d.querySelector('.ceyan_name').remove();f.d.getElementById('cx-ai-toolbar')?.remove();f.api.initQuizAssistant();
        assert(f.d.querySelector('.singleQuesId').previousElementSibling.id==='cx-ai-toolbar','降级位置错误');
        f.d.querySelector('.fontLabel').textContent='【问答题】未知';let throws=0;try{f.api.extract()}catch{throws++}
        f.d.getElementById('questions').innerHTML=Array.from({length:26},(_,i)=>choice(String(i),'单选',[['A','甲']])).join('');try{f.api.extract()}catch{throws++}assert(throws===2,'提取边界未校验');f.remove();
    });
    const preview=await fixture({preview:true});
    // 预览使用生产启动观察器，核对动态替换和窄屏布局。
    preview.api.startQuizObserver();
    const failures=logs.filter(x=>x.startsWith('FAIL'));
    document.getElementById('results').className=failures.length?'fail':'pass';
    document.getElementById('results').textContent=`${logs.length-failures.length}/${logs.length} 通过\n`+logs.join('\n');
    window.testResults={total:logs.length,failures,logs};
})().catch(e=>{document.getElementById('results').textContent=`测试加载失败：${e.stack}`;window.testResults={failures:[e.message]};});
