    // 只读页面状态与原生控件适配。完成状态不写回，不构造任务上报请求。
    function courseElementVisible(node) {
        if (!node?.isConnected || node.closest('[hidden],[aria-hidden="true"]')) return false;
        for (let parent = node; parent; parent = parent.parentElement) {
            const style = parent.ownerDocument.defaultView.getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return true;
    }
    function courseAnswerEditorFrame(frame) {
        // UEditor 的答案输入框不是课程任务；空白或暂不可读也不应阻断题目策略判断。
        // 仅排除现场确认的题目内编辑器结构；远程任务、验证框架及未知 iframe 仍需检查。
        const holder = frame.parentElement, editor = holder?.parentElement;
        const question = frame.closest(QUESTION_SELECTOR);
        const src = (frame.getAttribute('src') || '').trim();
        return Boolean(question && /^ueditor_\d+$/.test(frame.id)
            && holder?.matches('.edui-editor-iframeholder') && editor?.matches('.edui-editor')
            && question.contains(editor) && !frame.closest(STEM_SELECTOR)
            && (!src || /^about:blank(?:[?#].*)?$/i.test(src) || /^javascript:/i.test(src)));
    }
    function courseFrameTree(owner) {
        const documents = [owner], inaccessible = [], seen = new Set([owner]);
        const root = owner.querySelector('#mainid #iframe');
        const visit = (frame, depth) => {
            if (depth > 12 || !courseElementVisible(frame) || (frame !== root && courseAnswerEditorFrame(frame))) return;
            try {
                const doc = frame.contentDocument;
                if (!doc?.documentElement) { if(!courseRemoteReaderFrame(frame))inaccessible.push(frame); return; }
                if (seen.has(doc)) return;
                seen.add(doc); documents.push(doc);
                for (const child of doc.querySelectorAll('iframe')) visit(child, depth + 1);
            } catch { if(!courseRemoteReaderFrame(frame))inaccessible.push(frame); }
        };
        if (root) visit(root, 0);
        return { documents, inaccessible, root };
    }
    function courseBlocker(documents, videoQuizContext = null) {
        for (const doc of documents) {
            for (const node of doc.querySelectorAll('.chapterVideoFaceMaskDiv,#fcqrimg[src],.face-recognition,[data-face-verification]')) {
                if (node.id === 'fcqrimg' && !node.getAttribute('src')) continue;
                if (courseElementVisible(node)) return '需要人脸识别，请自行处理；自动流程已停止';
            }
            for (const node of doc.querySelectorAll('.geetest_panel,.yidun_popup,[data-captcha],iframe[src*="captcha"],.captcha-container')) {
                if (courseElementVisible(node)) return '出现验证码，自动流程已停止';
            }
            for (const node of doc.querySelectorAll('#videoquiz-submit,.ans-videoquiz:not([hidden])')) {
                if (courseElementVisible(node) && !(videoQuizContext?.root?.isConnected && videoQuizContext.root.ownerDocument === doc && (videoQuizContext.root === node || videoQuizContext.root.contains(node)))) return '视频中弹出交互题，需要人工处理';
            }
            for (const node of doc.querySelectorAll('form[action*="login"],.loginForm,[data-login-required]')) {
                if (courseElementVisible(node)) return '登录状态已失效，请重新登录';
            }
            for (const node of doc.querySelectorAll('[role="alert"],.layui-layer-content,.vjs-modal-dialog-content')) {
                if (!courseElementVisible(node)) continue;
                const text = clean(node.textContent);
                if (/人脸|身份核验/.test(text)) return '需要人脸识别，请自行处理；自动流程已停止';
                if (/验证码|人机验证/.test(text)) return '出现验证码，自动流程已停止';
                if (/尚未解锁|未解锁|无权访问|访问受限/.test(text)) return '章节未解锁或访问受限';
                if (/登录已过期|重新登录/.test(text)) return '登录状态已失效，请重新登录';
                if (/异常学习|学习行为异常|异常学习行为|检测到异常|操作(?:过于)?频繁|请求(?:过于)?频繁|账号(?:已)?(?:被)?(?:受限|限制|封禁|冻结)|账户(?:已)?(?:被)?(?:受限|限制|封禁|冻结)/.test(text))
                    return '平台提示学习或账号异常，自动流程已停止，请人工检查';
            }
        }
        return null;
    }
    function courseTabs(owner) {
        const nodes = [...owner.querySelectorAll('#prev_tab li[id^="dct"],#prev_tab [data-course-tab]')];
        const ids = new Set();
        return nodes.filter(node => node.id && !ids.has(node.id) && ids.add(node.id) && courseElementVisible(node))
            .map(node => ({ id:node.id, title:clean(node.textContent), node,
                active:node.classList.contains('active') || node.getAttribute('aria-selected') === 'true',
                disabled:node.getAttribute('aria-disabled') === 'true' || node.classList.contains('disabled') }));
    }
    function courseTabSnapshot(owner) {
        const nodes=[...owner.querySelectorAll('#prev_tab li[id^="dct"],#prev_tab [data-course-tab]')];
        const active=nodes.filter(node=>node.classList.contains('active')||node.getAttribute('aria-selected')==='true');
        if(nodes.some(node=>!node.id)||new Set(nodes.map(node=>node.id)).size!==nodes.length)
            return {ready:false,reason:'栏目 ID 缺失或重复',tabs:[],activeId:null};
        if(!nodes.length)return {ready:true,tabs:[],activeId:null};
        const tabs=courseTabs(owner);
        // 原生页面会在只有一栏时隐藏整个栏目条；该栏仍由唯一 active 节点确认。
        if(!tabs.length&&nodes.length===1&&active.length===1) {
            const node=nodes[0];
            tabs.push({id:node.id,title:clean(node.textContent),node,active:true,
                disabled:node.getAttribute('aria-disabled')==='true'||node.classList.contains('disabled')});
        }
        return {ready:active.length===1&&tabs.some(tab=>tab.id===active[0].id),
            reason:active.length!==1?'当前 active 栏目尚未唯一确定':'栏目仍在加载或隐藏',
            tabs,activeId:active.length===1?active[0].id:null};
    }
    // Detached template content stays inert: no player, iframe or returned script is mounted.
    function courseProbeMarkup(owner, html) {
        if(typeof html!=='string'||html.length>2*1024*1024)return null;
        const template=owner.createElement('template');template.innerHTML=html;
        return template.content;
    }
    function courseProbeArguments(root) {
        const objects=[];
        const objectAt=(text,begin)=>{
            let end=begin,braces=0,quoted=false;
            for(;end<text.length;end++) {
                const char=text[end];
                if(quoted){if(char==='\\'){end++;continue;}if(char==='"')quoted=false;continue;}
                if(char==='"'){quoted=true;continue;}
                if(char==='{')braces++;else if(char==='}'&&--braces===0){end++;break;}
            }
            if(braces!==0||!/^\s*(?:;|$)/.test(text.slice(end)))throw new Error('Invalid task metadata');
            const value=JSON.parse(text.slice(begin,end));
            if(!value||Array.isArray(value))throw new Error('Invalid task metadata');
            return {value,end};
        };
        for(const script of root.querySelectorAll('script:not([src])')) {
            const text=script.textContent;let depth=0,paren=0,previous='';
            // Native cards bootstrap observed in the HAR: an immediate wrapper + try + uParse.
            // Only the JSON literal is consumed; neither the wrapper nor uParse is executed.
            const bootstrap=/^\s*\(function\s*\(\s*\)\s*\{\s*mArg\s*=\s*(?:""|'')\s*;\s*try\s*\{\s*mArg\s*=\s*(?=\{)/.exec(text);
            if(bootstrap) {
                try {
                    const {value,end}=objectAt(text,bootstrap[0].length);
                    if(!/^\s*;\s*\}\s*catch\s*\(\s*\w+\s*\)\s*\{\s*\}\s*uParse\(\s*["']\.ans-cc["']\s*,\s*null\s*,\s*mArg\s*\)/.test(text.slice(end)))return null;
                    objects.push(value);continue;
                }catch{return null;}
            }
            for(let i=0;i<text.length;) {
                const char=text[i];
                if(/\s/.test(char)){i++;continue;}
                if(text.startsWith('//',i)){const end=text.indexOf('\n',i+2);i=end<0?text.length:end+1;continue;}
                if(text.startsWith('/*',i)){const end=text.indexOf('*/',i+2);if(end<0)return null;i=end+2;continue;}
                if(char==='/'&&['',';','=','(',',','return',':','[','!','&&','||'].includes(previous)) {
                    let bracket=false;i++;
                    while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i]==='[')bracket=true;if(text[i]===']')bracket=false;if(text[i++]==='/'&&!bracket)break;}
                    while(i<text.length&&/[a-z]/i.test(text[i]))i++;
                    previous='value';continue;
                }
                if(char==='"'||char==="'"||char==='`') {
                    const quote=char;i++;
                    while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]===quote)break;}
                    previous='string';continue;
                }
                if(/[A-Za-z_$]/.test(char)) {
                    const start=i++;while(i<text.length&&/[\w$]/.test(text[i]))i++;
                    const word=text.slice(start,i);
                    if(word==='mArg'&&depth===0&&paren===0&&['',';','var','let','const'].includes(previous)) {
                        const assignment=/^\s*=\s*/.exec(text.slice(i));
                        if(assignment) {
                            const begin=i+assignment[0].length;
                            if(text[begin]==='{') {
                                try {const result=objectAt(text,begin);objects.push(result.value);i=result.end;}catch{return null;}
                                previous='value';continue;
                            }
                        }
                    }
                    previous=word;continue;
                }
                if(char==='{')depth++;if(char==='}')depth--;
                if(char==='(')paren++;if(char===')')paren--;
                previous=char;i++;
            }
        }
        return objects.length===1?objects[0]:null;
    }
    function courseProbeSummary(root) {
        if(!root||root.querySelector('[data-captcha],.captcha-container,#chapterFaceState,.chapterVideoFaceMaskDiv,.fanyaMarking_left,form[action*="login"]'))return {known:false,reason:'page-gate'};
        const args=courseProbeArguments(root);
        // Empty/missing metadata is not evidence of a task-free page.
        if(!Array.isArray(args?.attachments)||args.attachments.length>1000)return {known:false,reason:'incomplete-metadata'};
        if(!args.attachments.length) {
            const content=root.querySelector('.ans-cc');
            // Complete native bootstrap + a static content tree, not merely an empty attachment array.
            const staticTags=new Set(['DIV','P','SPAN','BR','HR','IMG','A','UL','OL','LI','B','I','EM','STRONG','U','S','SUB','SUP','H1','H2','H3','H4','H5','H6','TABLE','THEAD','TBODY','TFOOT','TR','TH','TD','CAPTION','COLGROUP','COL','BLOCKQUOTE','PRE','CODE']);
            const nodes=content?[content,...content.querySelectorAll('*')]:[];
            const dynamic=root.querySelector('.ans-module,.ans-attach-ct,.ans-job-icon,[data-course-task],iframe,object,embed,canvas,[aria-busy="true"],.loading,.ans-loading,[data-loading]');
            if(content&&!dynamic&&nodes.every(node=>staticTags.has(node.tagName)&&!node.matches('[contenteditable]')&&!node.getAttributeNames().some(name=>/^on/i.test(name))))return {known:true,tasks:[],reason:'static-content'};
            return {known:false,reason:'incomplete-metadata'};
        }
        const tasks=args.attachments.map(item=>{
            if(!item||typeof item!=='object')return {type:'unknown',completed:null};
            if(item.property?.module==='insertbbs'&&!item.jobid&&!item.property.jobid&&!item.property._jobid&&item.job!==true
                &&root.querySelector('.ans-insertbbs-module')&&!root.querySelector('.ans-job-icon,[data-course-task]')
                &&[...root.querySelectorAll('.ans-module,iframe,object,embed,canvas')].every(node=>node.matches('.ans-insertbbs-module'))) {
                const frames=[...root.querySelectorAll('.ans-insertbbs-module')];
                const plain=frames.every(frame=>{try{const data=JSON.parse(frame.getAttribute('data')||'{}');return !data.jobid&&!data._jobid&&!data.job;}catch{return false;}});
                if(plain)return {type:'discussion',completed:null,required:false};
            }
            const type=item.type==='video'?'video':item.type==='workid'?'quiz':['document','ppt'].includes(item.type)?'document':'unknown';
            const id=item.jobid||item.property?._jobid||item.property?.jobid;
            return {type,completed:typeof item.isPassed==='boolean'?item.isPassed:null,
                required:item.job===false?false:item.job===true||typeof id==='string'&&id.length>0?true:null};
        });
        const markers=root.querySelectorAll('.ans-job-icon').length;
        if(markers>tasks.filter(task=>task.required!==false).length)return {known:false,reason:'unmapped-task-marker'};
        return {known:true,tasks};
    }
    const courseProbeStores=new WeakMap();
    const courseProbeEpoch=chapter=>JSON.stringify([chapter.chapterId,chapter.pending,chapter.completed]);
    function courseProbeChapterState(owner,chapter) {
        const row=owner.getElementById(chapter.id);
        if(!row||chapter.target&&!chapter.target.isConnected)return null;
        const text=clean(courseCatalogMarker(row,'.orangeNew')?.textContent);
        return {...chapter,active:row.classList.contains('posCatalog_active'),pending:/^\d+$/.test(text)?Number(text):null,completed:Boolean(courseCatalogMarker(row,'.icon_Completed'))};
    }
    function courseProbeStore(owner) {
        const scope=courseScoreKey(owner);let store=courseProbeStores.get(owner);
        if(!store){store={scope,chapters:new Map(),active:0,queue:[]};courseProbeStores.set(owner,store);}
        if(store.scope!==scope){for(const bucket of store.chapters.values())for(const pending of bucket.pending.values())pending.abort.abort();store.chapters.clear();store.scope=scope;}
        return store;
    }
    function courseInvalidateTaskProbe(owner, chapterId) {
        const store=courseProbeStores.get(owner),bucket=store?.chapters.get(chapterId);
        if(bucket){for(const pending of bucket.pending.values())pending.abort.abort();store.chapters.delete(chapterId);}
    }
    function courseProbeSchedule(owner,signal,read,priority=[0,0]) {
        const store=courseProbeStore(owner);
        return new Promise((resolve,reject)=>{
            const job={priority,signal,read,resolve,reject,started:false};
            const abort=()=>{if(!job.started){store.queue=store.queue.filter(item=>item!==job);reject(cancelledError());}};
            const pump=()=>{
                store.queue.sort((a,b)=>a.priority[0]-b.priority[0]||a.priority[1]-b.priority[1]);
                while(store.active<4&&store.queue.length) {
                    const next=store.queue.shift();next.signal?.removeEventListener('abort',next.abort);
                    if(next.signal?.aborted){next.reject(cancelledError());continue;}
                    next.started=true;store.active++;
                    Promise.resolve().then(next.read).then(next.resolve,next.reject).finally(()=>{store.active--;pump();});
                }
            };
            job.abort=abort;
            if(signal?.aborted){reject(cancelledError());return;}
            signal?.addEventListener('abort',abort,{once:true});store.queue.push(job);pump();
        });
    }
    function courseProbeCached(owner,chapter,key,options,load) {
        const check=()=>{options.check?.();if(options.signal?.aborted)throw cancelledError();};check();
        const store=courseProbeStore(owner),epoch=courseProbeEpoch(chapter),clock=options.now||Date.now;
        let bucket=store.chapters.get(chapter.id);
        if(bucket&&bucket.epoch!==epoch){courseInvalidateTaskProbe(owner,chapter.id);bucket=null;}
        if(!bucket){bucket={epoch,values:new Map(),pending:new Map()};store.chapters.set(chapter.id,bucket);}
        const value=bucket.values.get(key);
        if(value&&clock()<value.expires){options.onCacheHit?.();return Promise.resolve(value.result);}
        bucket.values.delete(key);
        let pending=bucket.pending.get(key);
        if(pending?.abort.signal.aborted){bucket.pending.delete(key);pending=null;}
        if(!pending) {
            pending={abort:new owner.defaultView.AbortController(),users:new Set(),settled:false};bucket.pending.set(key,pending);
            pending.promise=Promise.resolve().then(()=>load(pending.abort.signal)).then(result=>{
                if(result?.known&&!pending.abort.signal.aborted&&store.chapters.get(chapter.id)===bucket&&courseScoreKey(owner)===store.scope)
                    bucket.values.set(key,{result,expires:clock()+60000});
                return result;
            }).finally(()=>{pending.settled=true;if(bucket.pending.get(key)===pending)bucket.pending.delete(key);});
            pending.promise.catch(()=>{});
        }else options.onDeduplicated?.();
        return new Promise((resolve,reject)=>{
            let done=false;const token={};pending.users.add(token);
            const finish=(callback,result)=>{if(done)return;done=true;options.signal?.removeEventListener('abort',abort);pending.users.delete(token);if(!pending.users.size&&!pending.settled)pending.abort.abort();callback(result);};
            const abort=()=>finish(reject,cancelledError());
            options.signal?.addEventListener('abort',abort,{once:true});
            pending.promise.then(result=>{try{check();finish(resolve,result);}catch(error){finish(reject,error);}},error=>finish(reject,error));
            if(options.signal?.aborted)abort();
        });
    }
    function courseTaskEligibility(task, settings) {
        if(task.required===false)return {status:'excluded',reason:'not-required'};
        if((settings.skipLearned||settings.retrying)&&task.completed===true)return {status:'excluded',reason:'already'};
        if(task.type==='quiz'&&!settings.submit)return {status:'excluded',reason:'quiz-disabled'};
        if(task.type==='knowledge-graph')return {status:'excluded',reason:'knowledge-graph'};
        if(!['video','document','quiz'].includes(task.type)||task.required!==true||task.completed===null)return {status:'unknown',reason:'inspect-page'};
        return {status:'eligible',reason:'pending-task'};
    }
    async function courseProbeReadText(owner, url, {signal,check=()=>{},onRequest=()=>{},timeoutMs=30000}={}) {
        check();if(signal?.aborted)throw cancelledError();
        const controller=new owner.defaultView.AbortController(),abort=()=>controller.abort();
        signal?.addEventListener('abort',abort,{once:true});
        const timer=owner.defaultView.setTimeout(abort,timeoutMs);
        try {
            onRequest();
            const response=await owner.defaultView.fetch(url.href,{method:'GET',credentials:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal});
            check();if(signal?.aborted)throw cancelledError();
            if(!response.ok||response.url&&new URL(response.url).origin!==url.origin)throw new Error('任务摘要读取失败');
            if(Number(response.headers?.get('content-length'))>2*1024*1024)throw new Error('任务摘要过大');
            const html=await response.text();check();if(signal?.aborted)throw cancelledError();
            if(html.length>2*1024*1024)throw new Error('任务摘要过大');
            return html;
        } finally {owner.defaultView.clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    }
    async function courseTaskProbe(owner, chapter, options={}) {
        const check=()=>{options.check?.();if(options.signal?.aborted)throw cancelledError();};
        const unknown=reason=>({known:false,reason,tabs:[]});
        check();
        try {
            const scope=courseScoreKey(owner),base=pageURL(owner),frame=owner.querySelector('#mainid #iframe');
            const template=new URL(frame?.getAttribute('src')||'',base);
            const {course,classroom,student}=courseStudyContext(owner),templateContext=courseURLContext(template);
            if(!scope||!isCourseStudyURL(base)||template.origin!==base.origin||template.pathname!=='/mooc-ans/knowledge/cards'
                ||templateContext.conflict||templateContext.course!==course||templateContext.classroom!==classroom||templateContext.student!==student)return unknown('native-url-unavailable');
            const parseHeader=(root,cardTemplate)=>{
                if(!root||root.querySelector('#chapterFaceState,[data-captcha],form[action*="login"]'))return unknown('page-gate');
                const identity=courseURLContext(cardTemplate);
                if(cardTemplate.origin!==base.origin||cardTemplate.pathname!==template.pathname||identity.conflict||identity.course!==course
                    ||identity.classroom!==classroom||identity.student!==student||identity.chapterId!==String(chapter.chapterId))return unknown('chapter-url-mismatch');
                const nodes=[...root.querySelectorAll('#prev_tab li[id^="dct"]')],tabs=[];
                for(const node of nodes) {
                    const call=/^\s*changeDisplayContent\(\s*(\d+)\s*,\s*(\d+)\s*,/.exec(node.getAttribute('onclick')||'');
                    if(!call||Number(call[1])!==tabs.length+1||Number(call[2])!==nodes.length||node.id!==`dct${call[1]}`)return unknown('unconfirmed-tab-order');
                    tabs.push({id:node.id,index:tabs.length,title:clean(node.getAttribute('title')||node.textContent).slice(0,160),cardId:node.getAttribute('cardid')||'',disabled:node.getAttribute('aria-disabled')==='true'||node.classList.contains('disabled')});
                }
                return !tabs.length||new Set(tabs.map(tab=>tab.id)).size!==tabs.length?unknown('missing-tabs'):{known:true,tabs,url:cardTemplate.href};
            };
            const network=(url,signal,priority=options.priority)=>courseProbeSchedule(owner,signal,()=>courseProbeReadText(owner,url,{signal,onRequest:options.onRequest,timeoutMs:options.timeoutMs}),priority);
            const active=courseProbeChapterState(owner,chapter)?.active;
            let header;
            if(active) {
                header=parseHeader(owner,template);
                const cached=courseProbeStore(owner).chapters.get(chapter.id)?.values.get('header')?.result;
                if(header.known&&cached&&JSON.stringify(cached.tabs)!==JSON.stringify(header.tabs))courseInvalidateTaskProbe(owner,chapter.id);
            }
            else header=await courseProbeCached(owner,chapter,'header',options,async signal=>{
                const url=new URL('/mooc-ans/mycourse/studentstudyAjax',base);
                url.search=new URLSearchParams({courseId:course,clazzid:classroom,chapterId:chapter.chapterId,cpi:student,verificationcode:'',mooc2:base.searchParams.get('mooc2')||'1',microTopicId:'0',editorPreview:'0',isPreviewVideo:'false',videoWidth:'0',videoHeight:'0',targetVideoJobId:'',cardIndex:'0'}).toString();
                const root=courseProbeMarkup(owner,await network(url,signal));
                return parseHeader(root,new URL(root?.querySelector('#iframe')?.getAttribute('src')||'',base));
            });
            check();if(!header.known)return header;
            const {tabs}=header,cardTemplate=new URL(header.url);
            const defaults={...options,signal:options.contextSignal||options.signal};
            // Cache only normalized summaries for 60s; visible state is checked again on entry.
            return {known:true,tabs,async read(tab,runtime={}) {
                const readOptions={...defaults,...runtime};
                const assert=()=>{readOptions.check?.();if(readOptions.signal?.aborted||courseScoreKey(owner)!==scope)throw cancelledError();};
                assert();if(!tab)return {known:false,reason:'missing-tab'};
                const live=courseProbeChapterState(owner,chapter);
                if(live?.active&&courseTabs(owner).find(item=>item.active)?.id===tab.id) {
                    const doc=courseContentFingerprint(owner).doc;
                    if(doc){
                        const summary=courseProbeSummary(doc);
                        if(summary.known) {
                            const actual=coursePageTasks(courseFrameTree(owner));
                            for(const type of new Set(actual.map(task=>task.type))) {
                                const nodes=actual.filter(task=>task.type===type),metadata=summary.tasks.filter(task=>task.type===type);
                                if(nodes.length>metadata.length||nodes.some(task=>courseTaskComplete(task.node)===false)&&metadata.every(task=>task.completed===true)
                                    ||nodes.some(task=>courseTaskRequired(task.node)===true)&&metadata.every(task=>task.required===false))return {known:false,reason:'live-task-conflict'};
                            }
                            assert();return summary;
                        }
                    }
                }
                const url=new URL(cardTemplate);url.searchParams.set('num',String(tab.index));
                const summary=await courseProbeCached(owner,live||chapter,'tab:'+tab.id+':'+tab.cardId,readOptions,async signal=>courseProbeSummary(courseProbeMarkup(owner,await network(url,signal,readOptions.priority))));
                assert();return summary;
            }};
        } catch(error) {check();return unknown('probe-unavailable');}
    }
    async function findNextCourseTask(range, settings, signal) {
        const skipped=[],owner=settings.owner,scan=new owner.defaultView.AbortController(),lanes=new Map();
        const abort=()=>scan.abort(),check=()=>{settings.check?.();if(signal?.aborted)throw cancelledError();};
        signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
        const open=index=>{
            if(index>=range.length||lanes.has(index))return;
            const entry=range[index],lane={columns:new Map(),next:0,tabs:[],bounded:entry.id===settings.startChapterId||!settings.startChapterId&&index===0};lanes.set(index,lane);
            const fill=()=>{
                while(!scan.signal.aborted&&lane.next<lane.tabs.length&&lane.columns.size<4) {
                    const tab=lane.tabs[lane.next++];
                    lane.columns.set(tab.id,lane.probe.read(tab,{signal:scan.signal,priority:[index,tab.index]}).catch(()=>({known:false,reason:'probe-unavailable'})));
                }
            };
            lane.fill=fill;
            lane.header=(async()=>{
                check();if((settings.skipLearned||settings.retrying)&&entry.completed)return {known:true,already:true};
                const probe=await courseTaskProbe(owner,entry,{signal:scan.signal,contextSignal:signal,check:settings.check,
                    onRequest:settings.onRequest,onCacheHit:settings.onCacheHit,onDeduplicated:settings.onDeduplicated,now:settings.now,timeoutMs:settings.timeoutMs,priority:[index,-1]});
                if(!probe.known)return probe;
                let tabs=probe.tabs;
                if(lane.bounded&&Number.isInteger(settings.startTabIndex)&&settings.startTabIndex>=tabs.length)return {known:false,reason:'start-tab-missing'};
                if(lane.bounded&&settings.startTabId) {
                    const start=tabs.findIndex(tab=>tab.id===settings.startTabId);
                    if(start<0||settings.startCardId&&tabs[start].cardId!==settings.startCardId)return {known:false,reason:'start-tab-missing'};
                    tabs=tabs.slice(start);
                }
                if(lane.bounded&&Number.isInteger(settings.startTabIndex))tabs=tabs.filter(tab=>tab.index>=settings.startTabIndex);
                lane.probe=probe;lane.tabs=tabs;fill();return probe;
            })().catch(()=>({known:false,reason:'probe-unavailable'}));
        };
        try {
            for(let index=0;index<range.length;index++) {
                check();for(let ahead=index;ahead<Math.min(range.length,index+4);ahead++)open(ahead);
                const entry=range[index],lane=lanes.get(index),probe=await lane.header;check();
                if(probe.already){skipped.push({entry,reason:'already',tabs:[]});lanes.delete(index);continue;}
                if(!probe.known)return {entry,tab:null,skipped,probe};
                const excluded=[];
                const changed=()=>{const current=courseProbeChapterState(owner,entry);return !current||courseProbeEpoch(current)!==courseProbeEpoch(entry);};
                for(const tab of lane.tabs) {
                    const summary=await lane.columns.get(tab.id);check();
                    if(changed()){courseInvalidateTaskProbe(owner,entry.id);return {entry,tab:null,skipped,probe:{known:false,reason:'directory-state-changed'}};}
                    if(!summary?.known||tab.disabled)return {entry,tab,skipped,excluded,probe,reason:tab.disabled?'tab-disabled':summary?.reason||'unknown-summary'};
                    const decisions=summary.tasks.map(task=>courseTaskEligibility(task,settings));
                    if(decisions.some(item=>item.status!=='excluded'))return {entry,tab,skipped,excluded,probe,targetType:summary.tasks[decisions.findIndex(item=>item.status!=='excluded')].type};
                    excluded.push({tab,tasks:summary.tasks,decisions});lane.columns.delete(tab.id);lane.fill();
                }
                const possiblePending=excluded.flatMap(item=>item.tasks).filter(task=>task.required!==false&&task.completed!==true).length;
                if(!(lane.bounded&&(settings.startTabId||settings.startTabIndex>0))&&Number.isInteger(entry.pending)&&entry.pending>possiblePending)return {entry,tab:null,skipped,probe:{known:false,reason:'pending-count-mismatch'}};
                skipped.push({entry,reason:'excluded',tabs:excluded});lanes.delete(index);
            }
            return {entry:null,tab:null,skipped};
        }finally{scan.abort();signal?.removeEventListener('abort',abort);}
    }
    function courseTaskContains(container, node) {
        // contains 只能比较同一 DOM 树；通过 frameElement 将内层节点投影到祖先文档。
        // 与 courseTaskContainer 使用相同深度边界；不可访问或无法证明归属时返回 false。
        return describeNodeRelation(container,node).status === 'inside';
    }

    function courseTaskContainer(node) {
        // 播放器本身和外层附件 iframe 都可能提供任务状态。
        let candidate = node, container = null;
        for (let depth = 0; candidate && depth < 12; depth++) {
            container = candidate.closest('.ans-attach-ct,[data-course-task]');
            if (container) return container;
            try { candidate = candidate.ownerDocument.defaultView.frameElement; } catch { break; }
        }
        return null;
    }
    function courseTaskLabel(container) {
        if(!container)return null;
        // 只读短标签，不能把题干里的“任务点”或整页文本当作任务状态。
        for(const label of container.querySelectorAll('span,em,p,div')) {
            if(label.children.length || !courseElementVisible(label))continue;
            const text=clean(label.textContent).replace(/\s/g,'');
            if(text==='任务点已完成')return 'complete';
            if(text==='任务点')return 'required';
        }
        return null;
    }
    function courseVideoForegroundPolicy(video) {
        const container=courseTaskContainer(video);
        if(!container)return {required:false,evidence:null};
        // 仅当前任务的可见短提示；不将题干、其他任务或隐藏说明当作播放限制。
        for(const node of container.querySelectorAll('span,p,div,em')) {
            if(node.children.length || !courseElementVisible(node) || node.closest(QUESTION_SELECTOR)
                ||node.closest('.ans-attach-ct,[data-course-task]')!==container)continue;
            const text=clean(node.textContent);
            if(text.length>240 || !/观看|播放/.test(text))continue;
            if(/(?:观看|播放)(?:时|过程中|视频时)?[^。；]{0,50}(?:不可|不能|禁止|不得)[^。；]{0,35}(?:离开|切换窗口|切换页面|切换标签|最小化)/.test(text)
                ||/(?:必须|需要)(?:在)?前台(?:观看|播放)/.test(text))return {required:true,evidence:text.slice(0,120)};
        }
        return {required:false,evidence:null};
    }
    function courseOwnerForegroundState(owner) {
        let focused=false;
        try {focused=typeof owner.hasFocus==='function'&&owner.hasFocus();}catch{}
        return {visible:owner.visibilityState==='visible',focused};
    }
    function courseVideoPlayerWindow(doc) {
        // DOM 沙箱未必能直接看到页面的 Video.js；只读取同源页面实例，不向页面写变量。
        if (typeof unsafeWindow === 'undefined') return doc.defaultView;
        const frames=[];
        for(let current=doc;current!==document;) {
            if(frames.length>=12)return null;
            const frame=current.defaultView?.frameElement;
            if(!frame)return null;
            frames.unshift(frame);current=frame.ownerDocument;
        }
        let view=unsafeWindow;
        for(const frame of frames) {
            const actual=[...view.document.querySelectorAll('iframe,frame')].find(node=>node.isSameNode(frame));
            if(!actual)return null;
            view=actual.contentWindow;
        }
        return view;
    }
    function courseVideoSpeedCapability(video) {
        let boundPlayer=null;
        const result = (status, evidence, extra = {}) => ({status, rates:[], evidence, ...(boundPlayer?{player:boundPlayer}:{}), ...extra});
        try {
            const root = video?.closest('.video-js');
            if (!root || !video.isConnected || !courseElementVisible(video)) return result('unknown','player-unavailable');
            const view = courseVideoPlayerWindow(video.ownerDocument);
            const pageRoot = [...(view?.document.querySelectorAll('.video-js') || [])].find(node=>node.isSameNode(root));
            // 只查询已有实例，传真实 Element 而非 id；绝不调用会初始化播放器的 videojs()。
            const players = [...new Set([pageRoot?.player, view?.videojs?.getPlayer?.(pageRoot)].filter(Boolean))];
            if (players.length !== 1) return result('unknown','player-unavailable');
            const player = players[0];
            if (player.isDisposed?.() || !player.el?.()?.isSameNode(root) || root.querySelectorAll('video').length !== 1
                || root.querySelector('video') !== video) return result('unknown','player-mismatch');
            boundPlayer=player;
            const options = typeof player.options === 'function' ? player.options() : player.options_;
            const configured = options?.playbackRates;
            const bar = player.getChild?.('controlBar') || player.controlBar;
            const button = bar?.getChild?.('playbackRateMenuButton') || bar?.playbackRateMenuButton;
            const buttonNode = button?.el?.();
            const menuAvailable = buttonNode?.ownerDocument?.isSameNode(video.ownerDocument) && root.contains(buttonNode)
                && courseElementVisible(buttonNode) && !buttonNode.closest('.vjs-hidden,.vjs-disabled,[disabled],[aria-disabled="true"]')
                && !buttonNode.querySelector('button:disabled,button.vjs-disabled,button[aria-disabled="true"]');
            if (configured === false) return result(menuAvailable ? 'unknown' : 'disabled',menuAvailable ? 'configuration-conflict' : 'native-disabled');
            if (!Array.isArray(configured) || !configured.length || configured.length > 64
                || configured.some(rate => typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0)) return result('unknown','configuration-unavailable');
            const rates = [...new Set(configured)].sort((a,b)=>a-b);
            if (video.readyState < 2 || player.isReady_ === false) return result('unknown','player-unready');
            // 只读取当前任务附近的明确限制，不用任务完成状态推测权限。
            for (const scope of new Set([root, courseTaskContainer(video)].filter(Boolean))) {
                for (const node of scope.querySelectorAll('p,span,div,li')) {
                    if (node.childElementCount || !courseElementVisible(node) || node.closest(`${QUESTION_SELECTOR},.ans-videoquiz,#${ROOT_ID}`)) continue;
                    const text = clean(node.textContent);
                    if (text.length <= 160 && /(?:不可|禁止|不得|不允许|不支持|无法).{0,8}(?:倍速|变速)|(?:倍速|变速).{0,8}(?:禁止|关闭|不可用)/.test(text)) return result('disabled','explicit-restriction');
                }
            }
            if (!menuAvailable || button.player?.() !== player || button.playbackRateSupported?.() !== true) return result('unknown','menu-unavailable');
            const parseRate = value => /^\d+(?:\.\d+)?\s*[x×倍]?$/i.test(String(value).trim()) ? Number.parseFloat(value) : NaN;
            // 现场 7.2.2 使用这个原生菜单结构。标签 + 当前实例配置即可确认档位，
            // 不要求平台定制的每个 MenuItem 都暴露 options().rate 等内部字段。
            const nativeNodes = [...buttonNode.querySelectorAll('.vjs-menu-content[role="menu"] > .vjs-menu-item[role="menuitemradio"]')];
            const items = nativeNodes.length ? nativeNodes.map(node => {
                const labels = node.querySelectorAll('.vjs-menu-item-text');
                return {node, rate:labels.length===1 ? parseRate(clean(labels[0].textContent)) : NaN};
            }) : (Array.isArray(button.items) ? button.items : []).map(item => ({node:item.el?.(),
                rate:parseRate(item.options?.()?.rate ?? item.rate), player:item.player?.()}));
            if (items.length !== rates.length || items.some(item => (!nativeNodes.length && item.player !== player) || !item.node?.matches('.vjs-menu-item')
                || !buttonNode.contains(item.node) || item.node.closest('.vjs-disabled,[disabled],[aria-disabled="true"]') || !rates.includes(item.rate))
                || new Set(items.map(item=>item.rate)).size !== rates.length) return result('unknown','menu-conflict');
            if (typeof player.playbackRates === 'function') {
                const actual = player.playbackRates();
                if (!Array.isArray(actual) || JSON.stringify([...new Set(actual)].sort((a,b)=>a-b)) !== JSON.stringify(rates)) return result('unknown','configuration-conflict');
            }
            return result('allowed',nativeNodes.length?'native-configuration-and-dom-menu':'native-configuration-and-menu',{rates, player, button, items});
        } catch { return result('unknown','player-unreadable'); }
    }
    function courseReleaseVideoSpeed(video, attempts, cancel=false) {
        const record=attempts.get(video);
        if(!record)return;
        if(record.opened) {
            try {
                record.button.unpressButton();
                const active=video.ownerDocument.activeElement;
                if(record.button.el()?.contains(active)&&record.focus?.isConnected)record.focus.focus({preventScroll:true});
            }catch{}
            record.opened=false;
        }
        if(cancel&&!record.finished) {
            record.finished=true;
            record.state.actualRate=Number(video.playbackRate);
            record.state.outcome=record.operated&&record.state.actualRate===record.state.selectedRate?'selected':'interrupted';
        }
    }
    function courseApplyVideoSpeed(video, attempts, {enabled=true, disabledReason='switch-off',now=Date.now,readyMs=3000,confirmMs=2000,generation=0} = {}) {
        const capability = courseVideoSpeedCapability(video);
        const at=now(),actualRate=Number(video.playbackRate),root=video.closest('.video-js');
        const source=video.currentSrc||video.getAttribute('src')||'';
        if(!enabled) {
            courseReleaseVideoSpeed(video,attempts,true);
            return {status:capability.status,rates:capability.rates,evidence:capability.evidence,selectedRate:null,actualRate,method:null,reason:disabledReason,outcome:disabledReason};
        }
        let record=attempts.get(video);
        if(!record||record.root!==root||record.source!==source||record.generation!==generation
            ||capability.player&&record.player&&record.player!==capability.player) {
            courseReleaseVideoSpeed(video,attempts,true);
            record={root,source,generation,player:capability.player,deadline:at+readyMs,operated:false,finished:false,opened:false,openedMenus:new WeakSet(),
                state:{status:capability.status,rates:capability.rates,evidence:capability.evidence,selectedRate:null,actualRate,method:null,reason:null,outcome:'preparing'}};
            attempts.set(video,record);
        }
        const state=record.state;state.actualRate=actualRate;
        const finish=(outcome,reason=null,status=state.status)=>{
            state.outcome=outcome;state.reason=reason;state.status=status;record.finished=true;
            courseReleaseVideoSpeed(video,attempts);return {...state};
        };
        try {
            if(record.finished) {
                if(['selected','already-selected'].includes(state.outcome)&&actualRate!==state.selectedRate)return finish('not-retained','actual-rate-changed');
                return {...state};
            }
            if(capability.status==='disabled')return finish('native-disabled',capability.evidence,'disabled');
            if(!video.isConnected||!root||record.player?.isDisposed?.())return finish('player-changed','player-unavailable','unknown');
            if(record.operated) {
                if(!record.player?.el?.()?.isSameNode(root)||root.querySelector('video')!==video)return finish('player-changed','video-player-mismatch','unknown');
                if(actualRate===state.selectedRate)return finish('selected');
                if(at>=record.confirmUntil)return finish('not-retained','actual-rate-unconfirmed');
                state.outcome='confirming';return {...state};
            }
            state.status=capability.status;state.evidence=capability.evidence;
            if(capability.status!=='allowed') {
                if(at>=record.deadline)return finish('preparation-timeout',capability.evidence,'unknown');
                state.reason=capability.evidence;return {...state};
            }
            record.player=capability.player;state.rates=capability.rates;
            const target=capability.rates.filter(rate=>rate>1&&rate<=2).at(-1);
            if(!target)return finish('no-faster-rate');
            state.selectedRate=target;
            if(actualRate===target)return finish('already-selected');
            if(at>=record.deadline)return finish('preparation-timeout',state.reason||'menu-not-ready','unknown');
            // 每次取得当前菜单节点；重建只更新绑定，不重置期限或操作次数。
            if(record.opened&&(record.button!==capability.button||record.menu!==capability.button.menu))courseReleaseVideoSpeed(video,attempts);
            const fresh = courseVideoSpeedCapability(video);
            if(fresh.status!=='allowed') {state.reason='capability-changed:'+fresh.evidence;return {...state};}
            if(fresh.player!==record.player)return finish('player-changed','player-instance-changed','unknown');
            if(fresh.button!==capability.button) {state.reason='button-rebuilt';return {...state};}
            if(JSON.stringify(fresh.rates)!==JSON.stringify(capability.rates)||!fresh.rates.includes(target))return finish('configuration-changed','native-rates-changed','unknown');
            const button=fresh.button,buttonNode=button.el(),item=fresh.items.find(current=>current.rate===target);
            if(!item?.node?.isConnected||item.node.ownerDocument!==video.ownerDocument||!buttonNode.contains(item.node)) {state.reason='target-menu-item-changed';return {...state};}
            if(!courseElementVisible(buttonNode)) {state.reason='button-not-visible';return {...state};}
            // 原生菜单项本身也调用此正式 API；只使用已核验的原生档位。
            if(typeof fresh.player.playbackRate==='function') {
                record.operated=true;record.confirmUntil=at+confirmMs;state.method='native-api';state.outcome='confirming';state.reason=null;
                fresh.player.playbackRate(target);
                return {...state,actualRate:Number(video.playbackRate)};
            }
            if(!courseElementVisible(item.node)) {
                if(typeof button.pressButton!=='function'||typeof button.unpressButton!=='function'||!button.menu)return finish('menu-unavailable','native-open-api-missing','unknown');
                if(!record.openedMenus.has(button.menu)) {
                    record.openedMenus.add(button.menu);record.button=button;record.menu=button.menu;
                    const expanded=button.buttonPressed_===true||buttonNode.querySelector('button[aria-expanded="true"]');
                    record.focus=video.ownerDocument.activeElement;record.opened=!expanded;
                    button.pressButton();
                }
                state.reason='menu-item-not-visible';state.outcome='waiting-menu';return {...state};
            }
            record.operated=true;record.confirmUntil=at+confirmMs;state.method='native-menu';state.outcome='confirming';state.reason=null;
            item.node.click();
            courseReleaseVideoSpeed(video,attempts);
            return {...state,actualRate:Number(video.playbackRate)};
        } catch { return finish('selection-failed','native-operation-failed','unknown'); }
    }
    function courseVisibleMarker(container, selector) {
        return Boolean(container && (container.matches(selector)&&courseElementVisible(container)
            || [...container.querySelectorAll(selector)].some(courseElementVisible)));
    }
    function courseTaskComplete(node) {
        const container = courseTaskContainer(node);
        if (!container) return null;
        const label=courseTaskLabel(container);
        if(label==='complete')return true;
        if (courseVisibleMarker(container,'.ans-job-finished,.icon_Completed,[data-completed="true"],[data-task-completed="true"]')) return true;
        if (container.matches('[data-completed="false"]') || courseVisibleMarker(container,'.ans-job-icon,.orangeNew')) return false;
        if(label==='required')return false;
        return null;
    }
    function courseQuizComplete(doc) {
        return [...doc.querySelectorAll('.testTit_status,[data-quiz-status],[data-quiz-completed="true"]')]
            .some(node => courseElementVisible(node) && (node.getAttribute('data-quiz-completed')==='true' || /^(已完成|已提交|提交成功)(?:[·|：:、,，]?(?:最终成绩|成绩|得分)?[（(]?\d+(?:\.\d+)?分[）)]?)?$/.test(clean(node.textContent).replace(/\s/g,''))));
    }
    function courseContentFingerprint(owner) {
        const root = owner.querySelector('#mainid #iframe');
        let doc;
        try { doc = root?.contentDocument; } catch {}
        return { root, doc, body:doc?.body, src:root?.getAttribute('src') || '', chapter:owner.querySelector('#curChapterId')?.value || '' };
    }
    function courseContentChanged(before, after) {
        return before.root !== after.root || before.doc !== after.doc || before.body !== after.body || before.src !== after.src;
    }
    function courseContentReady(owner) {
        const tree=courseFrameTree(owner);
        return !tree.inaccessible.length && tree.documents.length>1 && tree.documents.slice(1).every(doc=>doc.body && (doc.body.children.length || clean(doc.body.textContent)));
    }
    function courseTaskTargetReady(owner,target) {
        if(!target||!['video','document','quiz'].includes(target.type))return false;
        if(readCourseCatalog(owner)?.entries.find(entry=>entry.active)?.id!==target.chapterId||courseTabs(owner).find(tab=>tab.active)?.id!==target.tabId)return false;
        const fingerprint=courseContentFingerprint(owner),tree=courseFrameTree(owner);
        if(!fingerprint.doc||tree.inaccessible.length||!courseContentReady(owner)||courseBlocker(tree.documents))return false;
        if(tree.documents.slice(1).some(doc=>doc.readyState==='loading'||doc.querySelector('[aria-busy="true"],.ans-loading,[data-loading]')))return false;
        try {
            const expected=new URL(fingerprint.src,pageURL(owner)),actual=new URL(fingerprint.doc.URL);
            if(expected.origin!==actual.origin||expected.pathname!==actual.pathname
                ||['courseid','clazzid','knowledgeid','num'].some(key=>expected.searchParams.get(key)!==actual.searchParams.get(key)))return false;
        }catch{return false;}
        return coursePageTasks(tree).some(task=>task.type===target.type&&courseTaskRequired(task.node)!==false);
    }
    function courseDocumentScrollTo(target, top) {
        const value=target.style.getPropertyValue('scroll-behavior'),priority=target.style.getPropertyPriority('scroll-behavior');
        try {
            target.style.setProperty('scroll-behavior','auto','important');
            target.scrollTop=top;
        } finally {
            if(value)target.style.setProperty('scroll-behavior',value,priority);
            else target.style.removeProperty('scroll-behavior');
        }
        return {top:target.scrollTop,height:target.clientHeight,total:target.scrollHeight};
    }
    function courseScrollToBottom(target) {
        // 使用浏览器钳制后的实际位置；接近底部仍写一次，消除小数残余。
        return courseDocumentScrollTo(target,target.scrollHeight);
    }
    function courseDocumentScrollState(target, contentRoot) {
        const images=(contentRoot.matches('img')?[contentRoot]:[...contentRoot.querySelectorAll('img')]).filter(courseElementVisible);
        return {top:target.scrollTop,height:target.clientHeight,total:target.scrollHeight,
            loaded:target.clientHeight>0 && (!images.length || images.some(image=>image.complete&&image.naturalWidth>0)),
            imageCount:images.length,pendingImages:images.filter(image=>!image.complete||image.naturalWidth<=0).length};
    }
    function courseDocumentScrollTargets(node) {
        // 只沿资料节点的祖先及所属 iframe 向外查找，不能滚动目录或助手面板。
        const targets=[],seen=new Set();
        const add=(element,root=false)=>{
            if(!element || seen.has(element) || !courseElementVisible(element)) return;
            seen.add(element);
            if(element.clientHeight>0 && (element.scrollHeight>element.clientHeight || root&&element.scrollHeight>=element.clientHeight)) targets.push(element);
        };
        let anchor=node;
        for(let depth=0;anchor && depth<12;depth++) {
            const doc=anchor.ownerDocument,root=doc.scrollingElement||doc.documentElement;
            for(let parent=anchor.parentElement;parent;parent=parent.parentElement) {
                if(parent===root) {add(parent,true);continue;}
                const overflow=doc.defaultView.getComputedStyle(parent).overflowY;
                if(/^(auto|scroll)$/.test(overflow)) add(parent);
            }
            add(root,true);
            try {anchor=doc.defaultView.frameElement;} catch {break;}
        }
        return targets;
    }
    function courseDocumentReader(doc, scope = doc) {
        // 原生 PDF.js、有明确页码的文档导航和 Swiper 幻灯片。
        const swiper = scope.querySelector('.swiper-container,.swiper');
        const slides = swiper ? [...swiper.querySelectorAll('.swiper-slide:not(.swiper-slide-duplicate)')] : [];
        const bullets = swiper ? [...scope.querySelectorAll('.swiper-pagination-bullet')] : [];
        if (slides.length && bullets.length === slides.length && courseElementVisible(swiper)) {
            return { doc, node:swiper, total:slides.length,
                current:() => slides.findIndex(node => node.classList.contains('swiper-slide-active')) + 1,
                last:() => bullets.at(-1), next:() => scope.querySelector('.swiper-button-next'), kind:'slides' };
        }
        const counter = scope.querySelector('#pageNumber,[data-slide-current],input[aria-label="页码"],input[aria-label="Page"]');
        const count = scope.querySelector('#numPages,[data-slide-total],.total-pages');
        const total = Number(clean(count?.getAttribute('data-slide-total') || count?.textContent).match(/\d+/)?.[0]);
        const read = () => Number(counter?.value || counter?.getAttribute('data-slide-current') || clean(counter?.textContent));
        if (counter && courseElementVisible(counter) && Number.isInteger(total) && total > 0 && total < 100000) {
            const node = scope.querySelector('#viewerContainer,.document-reader,[data-document-reader]') || counter.parentElement;
            return { doc, node, total, current:read,
                last:() => scope.querySelector('#lastPage,[data-slide-last],button[aria-label="末页"],button[title="最后一页"]'),
                next:() => scope.querySelector('#next,[data-slide-next],button[aria-label="下一页"]'), kind:'document' };
        }
        // 超星连续图片 PPT 和 PDF.js 的纵向阅读方式；有实际资料节点才适配。
        // 现场确认：新版 #img 是 div，内部 #panView 跳转到 pan-yz 的连续图片文档。
        const remote=scope.querySelector('[id="img"].imglook iframe[id="panView"]');
        if(remote && courseRemoteReaderFrame(remote) && courseElementVisible(remote))return {doc,node:remote,kind:'remote-scroll',request:(op,signal,timeout)=>courseDocumentBridgeRequest(remote,op,signal,timeout)};
        const image=scope.querySelector('[id="img"].imglook[src],[id="img"].imglook[data-original],[id="img"].imglook[data-src]');
        const continuous=scope.querySelector('.pdfViewer .page,[data-document-reader] img[src]');
        const node=image||continuous;
        if(node && courseElementVisible(node)) return {doc,node,kind:'scroll',contentRoot:node.closest('.pdfViewer,[data-document-reader],.continuous-reader')||node,targets:()=>courseDocumentScrollTargets(node)};
        return null;
    }
    function courseDocumentReaders(doc) {
        const scopes=[...doc.querySelectorAll('.ans-attach-ct,[data-course-task]')].filter(courseElementVisible);
        const readers=[];
        // 同一资料容器可以有多个 PPT；逐个枚举，不按全页固定 ID 找第一份。
        for(const scope of scopes.length?scopes:[doc]) {
            const reader=courseDocumentReader(doc,scope);if(reader)readers.push(reader);
            for(const remote of scope.querySelectorAll('[id="img"].imglook iframe[id="panView"]')) {
                if(courseRemoteReaderFrame(remote)&&courseElementVisible(remote))readers.push({doc,node:remote,kind:'remote-scroll',request:(op,signal,timeout)=>courseDocumentBridgeRequest(remote,op,signal,timeout)});
            }
        }
        const seen=new Set();
        return readers.filter(reader=>!seen.has(reader.node) && seen.add(reader.node));
    }
    function courseVideoStartButton(video) {
        const player=video.closest('.video-js,.prism-player,[data-video-player]')||video.parentElement;
        if(!player)return null;
        for(const selector of ['.vjs-big-play-button','.prism-big-play-btn','[data-video-play]','.vjs-play-control']) {
            const buttons=[...player.querySelectorAll(selector)].filter(node=>courseElementVisible(node)&&!node.disabled&&node.getAttribute('aria-disabled')!=='true');
            if(buttons.length===1)return buttons[0];
        }
        return null;
    }
    function courseTaskRequired(node) {
        const container=courseTaskContainer(node);
        if(!container)return null;
        if(container.matches('[data-required="false"],[data-isjob="false"]'))return false;
        if(courseTaskLabel(container))return true;
        if(courseVisibleMarker(container,'[data-course-task],.ans-job,.ans-job-finished,[data-isjob="true"],.ans-job-icon,.orangeNew'))return true;
        return false;
    }
    function coursePageHasTaskPoints(tree) {
        // 通用附件外壳及 isjob 元数据不是可见任务点；已有实际控件另由 courseTaskRequired 检查。
        return tree.documents.slice(1).some(doc=>courseTaskLabel(doc.body)
            || courseVisibleMarker(doc.body,'.ans-job-icon'));
    }
    function coursePageWithoutTasks(tree,tasks) {
        if(tasks.some(task=>courseTaskRequired(task.node)!==false))return false;
        if(coursePageHasTaskPoints(tree))return false;
        // 先完成加载等待，再按可见任务标记判断；不依赖标签名称或固定标签数量。
        // 空白、不可读框架仍不能证明无任务；无任务仅表示跳过，不写平台完成状态。
        const loadedAttachment=tasks.some(task=>courseTaskContainer(task.node)&&courseTaskRequired(task.node)===false);
        const loadedPage=!tree.inaccessible.length && tree.documents.length>1
            && tree.documents.slice(1).every(doc=>doc.body && (doc.body.children.length || clean(doc.body.textContent)));
        return loadedAttachment || loadedPage || tree.documents.slice(1).some(doc=>courseVisibleMarker(doc.body,
            '#img.imglook[src],.pdfViewer .page,[data-required="false"],[data-isjob="false"]'));
    }
    function courseKnowledgeGraphTasks(tree, knownTasks) {
        const graphs=new Set();
        const title=value=>/^(?:\d+[.、]?\s*)?(?:章节)?知识图谱$/.test(clean(value));
        for(const doc of tree.documents.slice(1)) {
            for(const heading of doc.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')) {
                if(!courseElementVisible(heading)||heading.closest(QUESTION_SELECTOR)||!title(heading.textContent))continue;
                const node=courseTaskContainer(heading)||heading;
                // 已识别的视频、课件和测验仍走原流程，不能被同一区域标题吞掉。
                if(knownTasks.some(task=>node.contains(task.node)||task.node.contains(node)))continue;
                graphs.add(node);
            }
        }
        // 截图中的原生标签可确认整个图谱页面；不扫描正文关键词，也不跳过未知 iframe。
        const active=courseTabs(tree.documents[0]).find(tab=>tab.active);
        if(!graphs.size&&!knownTasks.length&&!tree.inaccessible.length&&title(active?.title)) {
            const doc=tree.documents[1];
            if(doc?.body&&courseElementVisible(doc.body))graphs.add(doc.body);
        }
        return [...graphs].map(node=>({type:'knowledge-graph',node}));
    }
    function coursePageTasks(tree) {
        const tasks=[];
        for(const doc of tree.documents.slice(1)) {
            for(const video of [...doc.querySelectorAll('video')].filter(courseElementVisible)) tasks.push({type:'video',node:video});
            for(const reader of courseDocumentReaders(doc)) tasks.push({type:'document',node:reader.node,reader});
            if(!doc.querySelector('.fanyaMarking_left') && (hasQuestionNodes(doc)||courseQuizComplete(doc))) tasks.push({type:'quiz',doc,node:doc.querySelector('.singleQuesId,.TiMu,.CeYan,.testTit_status,[data-quiz-status]')||doc.body});
        }
        tasks.push(...courseKnowledgeGraphTasks(tree,tasks));
        const path=node=>{
            const nodes=[node];
            for(let depth=0;node?.ownerDocument!==tree.documents[0]&&depth<12;depth++) {
                try{node=node.ownerDocument.defaultView.frameElement;}catch{break;}
                if(!node)break;nodes.unshift(node);
            }
            return nodes;
        };
        // iframe 内部任务按所属 iframe 在父页的位置排序，再比较内部 DOM 顺序。
        return tasks.sort((left,right)=>{
            const a=path(left.node),b=path(right.node);
            for(let i=0;i<Math.min(a.length,b.length);i++) {
                if(a[i]===b[i])continue;
                const position=a[i].compareDocumentPosition(b[i]);
                return position&1?0:position&4?-1:position&2?1:0;
            }
            return a.length-b.length;
        });
    }
    function courseSubmitButton(doc) {
        // 不调用页面的私有提交函数，只点击明确标注的原按钮。
        const nodes = [...doc.querySelectorAll('#submitWork,#submitTest,#submit,#workSubmit,[data-quiz-submit],button,input[type="submit"],a[role="button"],a[onclick]')];
        return nodes.filter(node => !node.closest('.singleQuesId,.TiMu') && courseElementVisible(node)
            && !node.disabled && node.getAttribute('aria-disabled') !== 'true'
            && /^(提交|提交答案|提交测验|交卷)$/.test(clean(node.value || node.textContent)));
    }
    function courseSubmitConfirmation(doc, owner = doc) {
        // 现场确认：内层测验调用主页面 #workpop，不能只在题目 iframe 找二次确认。
        // 只沿当前题目文档的父链读取，不扫描其他任务/测验的兄弟 iframe。
        const documents = [], seen = new Set();
        for (let current = doc, depth = 0; current && depth < 12 && !seen.has(current); depth++) {
            documents.push(current); seen.add(current);
            if (current === owner) break;
            try { current = current.defaultView?.frameElement?.ownerDocument; }
            catch { break; }
        }
        const dialogs = documents.flatMap(current => [...current.querySelectorAll('[role="dialog"],.layui-layer,.popDiv,.alertDialog')]).filter(courseElementVisible);
        const buttons = dialogs.filter(dialog => /提交|交卷/.test(clean(dialog.textContent)) && !/人脸|验证码/.test(clean(dialog.textContent)))
            .flatMap(dialog => [...dialog.querySelectorAll('button,a[role="button"],.layui-layer-btn0')])
            .filter(node => courseElementVisible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true'
                && /^(确定|确认|确认提交|提交|交卷)$/.test(clean(node.value || node.textContent)));
        return [...new Set(buttons)];
    }
