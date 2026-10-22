    // 独立的视频弹题适配：只读可见材料，只操作可确认归属的原生控件。
    const VIDEO_QUIZ_ROOT = '.ans-videoquiz,[data-video-quiz-root]';
    const VIDEO_QUIZ_FEEDBACK = '[data-video-quiz-result],.videoquiz-result,.videoquiz-feedback,.answer-feedback,.tkTopic_oper .rightInfo,.tkTopic_oper .spanNot,.tkTopic_oper .spanNotBack';
    const videoQuizCuePositions = new WeakMap();
    function courseVideoQuizError(code, message) {
        if(typeof createCxError==='function')return createCxError(code,{module:'video-quiz',operation:'guard'});
        const error=new Error(message);error.cxCode=code;error.code=code;return error;
    }
    function courseVideoQuizVisibleText(node) {
        if(!node||!courseElementVisible(node)||node.matches(MEDIA_EXCLUDED+',script,style'))return '';
        const expression=questionNativeMathExpression(node);
        if(expression)return expression;
        return clean([...node.childNodes].map(child=>child.nodeType===3?child.textContent:child.nodeType===1?courseVideoQuizVisibleText(child):'').join(' '));
    }
    function courseVideoQuizCandidate(video) {
        if(!video?.isConnected)return null;
        const doc=video.ownerDocument;
        const roots=new Set([...doc.querySelectorAll(VIDEO_QUIZ_ROOT)].filter(courseElementVisible));
        for(const button of doc.querySelectorAll('#videoquiz-submit')) {
            if(!courseElementVisible(button))continue;
            const root=button.closest(VIDEO_QUIZ_ROOT+',[role="dialog"],form');
            if(root)roots.add(root);
        }
        const candidates=[];
        for(const root of roots) {
            if([...roots].some(other=>other!==root&&root.contains(other)))continue;
            const holder=root.closest('.video-js,.prism-player,[data-video-player],[data-course-task],.ans-attach-ct');
            const videos=[...(holder || doc).querySelectorAll('video')].filter(courseElementVisible);
            if(videos.length!==1||videos[0]!==video)continue;
            const target=root.getAttribute('data-video-id');
            if(target&&target!==video.id)continue;
            candidates.push({root,doc,video,holder:holder || video.parentElement});
        }
        return candidates.length===1?candidates[0]:null;
    }
    function courseVideoQuizNodes(root) {
        const nodes=[...root.querySelectorAll('.tkItem,.singleQuesId,.TiMu,.question-item,[data-questionid],fieldset')].filter(courseElementVisible);
        const leaf=nodes.filter(node=>!nodes.some(other=>other!==node&&node.contains(other)));
        return leaf.length?leaf:[root];
    }
    registerPageAdapter({id:'video-quiz',
        collect:(doc,context={})=>context.scope==='video-quiz'&&context.root?.ownerDocument===doc&&context.root.isConnected?courseVideoQuizNodes(context.root):[],
        read:(node,index,context={})=>{
            const nativeTopic=node.matches('.tkItem');
            const stems=[...node.querySelectorAll(nativeTopic?':scope > .tkItem_title':STEM_SELECTOR+',legend')].filter(courseElementVisible);
            const unique=stems.filter(stem=>!stems.some(other=>other!==stem&&stem.contains(other)));
            if(unique.length!==1)throw courseVideoQuizError('CX-PAR-002','视频弹题题干无法唯一定位，需人工处理');
            let typeLabel;
            if(nativeTopic){
                const topic=node.closest('.tkTopic');
                const titles=topic&&context.root?.contains(topic)?[...topic.querySelectorAll('.tkTopic_title')].filter(title=>courseElementVisible(title)&&title.closest('.tkTopic')===topic):[];
                const label=titles.length===1?courseVideoQuizVisibleText(titles[0]):'';
                // 原生格式必须有唯一、明确的题型；不能仅凭 radio/checkbox 猜测。
                typeLabel=/^(?:单选|单项选择|多选|多项选择|判断|是非|填空|简答|问答|论述)题?$/.test(label)?label:'视频弹题题型不明确';
            }
            const raw=rawQuestion(node,index,'video-quiz',{stem:unique[0],typeLabel});
            raw.question=stripQuestionPrefix(courseVideoQuizVisibleText(unique[0]),raw.typeLabel);
            for(const option of raw.options){const input=raw.binding.optionTargets.get(option.key);option.text=courseVideoQuizVisibleText(optionContentRoot(node,input)).replace(new RegExp('^'+option.key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*[、.．:：)）]\\s*'),'');}
            raw.media=raw.media.filter(item=>courseElementVisible(raw.binding.imageNodes.get(item.id)));
            const ids=new Set(raw.media.map(item=>item.id));
            raw.options.forEach(option=>{if(option.imageIds)option.imageIds=option.imageIds.filter(id=>ids.has(id));});
            // 只读取明确归属当前弹层/题目的作答要求，不扫描整页文字或编辑器。
            raw.instructions=clean([...new Set([context.root,node].filter(Boolean))].flatMap(scope=>[
                scope.getAttribute('data-answer-instructions'),
                ...[...scope.children].filter(child=>child.matches('.question-instructions,[data-answer-instructions]')).map(courseVideoQuizVisibleText)
            ]).filter(Boolean).join('；'));
            if(raw.binding.writer==='chapter-choice') {raw.controls.choiceTargets=0;raw.binding.writer='unsupported';}
            return raw;
        }
    });
    function courseVideoQuizHash(text) {let n=2166136261;for(const c of text)n=Math.imul(n^c.charCodeAt(0),16777619);return (n>>>0).toString(36);}
    function courseVideoQuizSnapshot(candidate) {
        const {root,doc,video}=candidate;
        const parseContext={scope:'video-quiz',root};
        const graph=parseQuestionGraph(doc,parseContext),parsed=toLegacyQuestionSnapshot(graph);
        if(parsed.questions.some(q=>GARBLED.test(q.question)||q.options.some(o=>GARBLED.test(o.text))))throw courseVideoQuizError('CX-PAR-005','检测到字体混淆，弹题材料尚未还原，需人工处理');
        const videoIdentity=video.id || `video-${[...doc.querySelectorAll('video')].indexOf(video)+1}`;
        const cue=Number(root.getAttribute('data-cue-seconds'));
        if(!videoQuizCuePositions.has(root))videoQuizCuePositions.set(root,Number.isFinite(video.currentTime)?Math.round(video.currentTime):null);
        const explicitCue=root.hasAttribute('data-cue-seconds')&&Number.isFinite(cue)&&cue>=0;
        const cueSeconds=explicitCue?cue:videoQuizCuePositions.get(root);
        const platformIds=[...parsed.bindings.values()].map(b=>['data-questionid','data-question-id','data'].map(attr=>b.node.getAttribute(attr)).find(Boolean)
            || (b.node!==root&&b.node.matches('fieldset,.singleQuesId,.TiMu,.question-item')?b.node.id:null));
        const hasPlatformIds=platformIds.length>0&&platformIds.every(Boolean);
        // 内容身份排除按钮/反馈/作答值；重渲染或自然回看不重置作答次数。
        const identity=JSON.stringify({questions:parsed.questions.map(q=>({id:hasPlatformIds?q.id:q.number,type:q.type,question:q.question,options:q.options.map(o=>({key:o.key,text:o.text,imageCount:o.imageIds?.length || 0})),instructions:q.instructions})),
            images:parsed.media.map(m=>({location:m.location,optionKey:m.optionKey,content:courseVideoQuizHash((m.src || '').split(/[?#]/)[0])}))});
        const fingerprint=courseVideoQuizHash(identity);
        // 平台题 ID 和弹题位置保存次数；内容指纹只用于快照校验，题目反馈不能生成新额度。
        const questionIdentity=hasPlatformIds?courseVideoQuizHash(JSON.stringify({ids:platformIds,cue:explicitCue?cue:null})):`${cueSeconds ?? 'cue'}:${fingerprint}`;
        const key=`${videoIdentity}:${questionIdentity}`;
        return Object.assign(createQuestionSnapshot(graph,{doc,parseContext,taskId:key}),
            {key,questionIdentity,videoIdentity,cueSeconds,fingerprint,identitySource:hasPlatformIds?'platform':'content',root});
    }
    function courseVideoQuizButton(candidate,kind='submit') {
        if(!candidate?.root?.isConnected||!courseElementVisible(candidate.root))return null;
        const selector=kind==='submit'?'#videoquiz-submit,[data-video-quiz-submit]':'#videoquiz-continue,.ans-videoquiz-continue,[data-video-quiz-continue],.videoquiz-continue';
        const nodes=[...candidate.root.querySelectorAll(selector)].filter(node=>courseElementVisible(node)&&!node.disabled&&!node.hasAttribute('disabled')&&!node.matches('.disabled,.x-item-disabled')&&node.getAttribute('aria-disabled')!=='true'
            && (!node.closest(VIDEO_QUIZ_ROOT)||node.closest(VIDEO_QUIZ_ROOT)===candidate.root));
        if(nodes.length!==1)return null;
        const node=nodes[0],nativeAnchor=kind==='submit'?'a#videoquiz-submit.ans-videoquiz-submit':'a#videoquiz-continue.ans-videoquiz-continue';
        return node.matches('button,input[type="button"],input[type="submit"],a[role="button"]')
            || candidate.root.matches('.ans-videoquiz')&&node.matches(nativeAnchor)?node:null;
    }
    function courseVideoQuizFeedbackText(node) {
        const text=courseVideoQuizVisibleText(node).slice(0,1200);
        // 仅原生错误节点的已确认文案可转换为判错；是否属于新轮次由反馈基线判断。
        if(node.matches('.tkTopic_oper .spanNot,.tkTopic_oper .spanNotBack')&&/^真遗憾[，,]\s*再接再厉[！!。]?(?:\s*回看.*)?$/.test(text))return '回答错误：'+text;
        return text;
    }
    function courseVideoQuizFeedback(candidate) {
        const scope=candidate.root.isConnected&&courseElementVisible(candidate.root)?candidate.root:candidate.holder;
        return [...(scope?.querySelectorAll(VIDEO_QUIZ_FEEDBACK)||[])].filter(node=>courseElementVisible(node)&&(!node.closest(VIDEO_QUIZ_ROOT)||node.closest(VIDEO_QUIZ_ROOT)===candidate.root)).map(courseVideoQuizFeedbackText).join('；').slice(0,1200);
    }
    function courseVideoQuizFeedbackEntries(candidate) {
        const nodes=new Set([candidate.root,candidate.holder].filter(Boolean).flatMap(scope=>[...scope.querySelectorAll(VIDEO_QUIZ_FEEDBACK)]));
        return new Map([...nodes].filter(node=>courseElementVisible(node)&&(!node.closest(VIDEO_QUIZ_ROOT)||node.closest(VIDEO_QUIZ_ROOT)===candidate.root))
            .map(node=>[node,courseVideoQuizFeedbackText(node)]));
    }
    function courseVideoQuizOutcome(candidate,attempt) {
        const feedback=typeof attempt?.feedback==='string'?attempt.feedback:courseVideoQuizFeedback(candidate);
        const wrong=/(?:回答|作答|答案|选择|答题)(?:结果)?[：:，,\s]*(?:错误|不正确|不完全正确)|回答不对|答错/.test(feedback);
        const passed=/(?:回答|作答|答案|答题)(?:结果)?[：:，,\s]*正确|(?:^|[；，。！!\s])答对(?:了)?(?=$|[；，。！!\s])|全部答对|回答成功/.test(feedback);
        if(wrong&&passed)return 'unknown';
        if(wrong)
            return /(?:重新观看|重新播放|回看|重看|返回.{0,8}观看)/.test(feedback)?'replay-required':'wrong';
        if(passed)return 'passed';
        if(/(?:重新观看|回看|重看)/.test(feedback))return 'unknown';
        return candidate.root.isConnected&&courseElementVisible(candidate.root)?'pending':'unknown';
    }
    function courseVideoQuizAnswers(snapshot) {
        return new Map(snapshot.questions.map(q=>{
            const binding=snapshot.bindings.get(q.id),input=binding.inputs[0];
            return [q.id,['blank','essay'].includes(q.type)?{node:binding.node,input,value:input?.value || ''}:
                {node:binding.node,keys:[...binding.optionTargets].filter(([,target])=>selected(target)).map(([key])=>key)}];
        }));
    }
    function courseVideoQuizHasAnswers(snapshot) {
        return [...courseVideoQuizAnswers(snapshot).values()].some(value=>value.keys?.length||clean(value.value));
    }
    function courseVideoQuizReadOnlyControls(snapshot) {
        // 首版仅接管原生 radio/checkbox 和单个简单文本框。选择即提交的已知结构不试点。
        return [...snapshot.bindings.values()].some(binding=>binding.writer==='unsupported'||
            [...binding.optionTargets.values(),...binding.inputs].some(node=>!node.matches('input,textarea')||
                /submit|confirm|提交|确认/i.test((node.getAttribute('onclick')||'')+(node.getAttribute('onchange')||''))));
    }
    function courseVideoQuizSameAnswer(a,b) {return JSON.stringify([...a].map(String).sort())===JSON.stringify([...b].map(String).sort());}
    function courseVideoQuizReport(record) {
        return `${record.key}：${record.phase}，自动确认 ${record.attempts || 0}/6 次，模型请求 ${record.modelRequests || 0} 次，网络重试 ${record.modelRetries || 0} 次；${record.reason || record.gateResult || ''}`
            +(Array.isArray(record.questions)?record.questions.map(q=>`\n第 ${q.number} 题（${q.type}）：${q.question}`+(q.instructions?`；要求：${q.instructions}`:'')
                +(Array.isArray(q.options)?q.options.map(o=>`\n${o.key}. ${o.text}`).join(''):'')).join(''):'')
            +(Array.isArray(record.history)?record.history.map(h=>`\n第 ${h.attempt} 次：${JSON.stringify(h.answers?.map(a=>({id:a.id,answer:a.answer})) || [])}；${String(h.feedback || '').slice(0,1200)}`).join(''):'');
    }

    // 主循环唯一接管入口；监听器只取消过期分析和唤醒，不能启动第二个模型请求。
    function createCourseVideoQuizHandler(video,records,hooks) {
        let closed=false,inflight=null;
        const handle=async()=>{
            if(closed)return false;
            if(inflight)return inflight;
            const candidate=courseVideoQuizCandidate(video);
            if(!candidate)return false;
            inflight=process(candidate).finally(()=>{inflight=null;});
            return inflight;
        };
        const process=async initial=>{
            let candidate=initial,record,owned=null,snapshot=null,intervened=false,child=null,scriptWriting=false,nativeWrite=false,feedbackBaseline=null,snapshotInvalidation=null;
            const feedbackChanges=new Set();
            const freshFeedback=()=>{
                if(feedbackBaseline)return [...courseVideoQuizFeedbackEntries(candidate)].filter(([node,text])=>!feedbackBaseline.has(node)||feedbackBaseline.get(node)!==text||feedbackChanges.has(node)).map(([,text])=>text).join('；').slice(0,1200);
                const text=courseVideoQuizFeedback(candidate);
                return record?.submissionStarted&&text===record.feedbackBeforeSubmit?'':text;
            };
            const onEdit=event=>{if(event.isTrusted&&!(nativeWrite&&['input','change'].includes(event.type))){intervened=true;child?.abort();hooks.wake();}};
            const onMediaError=()=>{child?.abort();hooks.wake();};
            video.addEventListener('error',onMediaError);
            const observer=new video.ownerDocument.defaultView.MutationObserver(mutations=>{
                for(const mutation of mutations){
                    const target=mutation.target.nodeType===1?mutation.target:mutation.target.parentElement,feedback=target?.closest(VIDEO_QUIZ_FEEDBACK);
                    // class/style 等属性变化本身不是新判分；显隐变化由可见反馈基线识别。
                    if(feedback&&mutation.type!=='attributes')feedbackChanges.add(feedback);
                    for(const node of mutation.addedNodes)if(node.nodeType===1){if(node.matches(VIDEO_QUIZ_FEEDBACK))feedbackChanges.add(node);node.querySelectorAll(VIDEO_QUIZ_FEEDBACK).forEach(n=>feedbackChanges.add(n));}
                }
                if(child&&!scriptWriting&&snapshot){
                    try {const current=courseVideoQuizCandidate(video);if(!current||current.root!==snapshot.root)throw courseVideoQuizError('CX-CTL-006','弹题已重新渲染');assertQuestionSnapshot(snapshot);}
                    catch(error) {snapshotInvalidation=error;child.abort();}
                }
                hooks.wake();
            });
            observer.observe(video.ownerDocument.body,{childList:true,subtree:true,attributes:true,characterData:true});
            initial.root.addEventListener('input',onEdit,true);initial.root.addEventListener('change',onEdit,true);initial.root.addEventListener('click',onEdit,true);
            hooks.waiting(true);
            const guard=()=>{hooks.guard();if(closed)throw new Error('视频弹题处理已取消');if(video.error)throw new Error(`视频加载/播放失败（错误 ${video.error.code}）`);};
            const save=()=>{guard();hooks.save();};
            const manual=(reason,error)=>{
                record.phase='manual-wait';record.reason=String(reason).slice(0,400);
                if(error&&typeof recordCxDiagnostic==='function'){
                    const diagnostic=recordCxDiagnostic(error,{module:'video-quiz',operation:'guard',taskId:hooks.settings?.diagnosticTaskId,attempt:record.attempts,phase:'manual-wait',submissionStarted:Boolean(record.submissionStarted)});
                    record.cxCode=diagnostic.code;record.reason=diagnostic.message;
                }
                save();
            };
            const rebind=()=>{
                const current=courseVideoQuizCandidate(video);
                if(!current)return null;
                try {const fresh=courseVideoQuizSnapshot(current);if(fresh.key!==record.key&&fresh.questionIdentity!==record.questionIdentity&&!(record.identitySource==='content'&&fresh.fingerprint===record.fingerprint))return null;}catch{return null;}
                return current;
            };
            const gateReleased=state=>!courseVideoQuizCandidate(video)&&!video.paused&&!video.seeking&&video.readyState>=2&&
                hooks.playingCount()>state.playing&&video.currentTime>state.seconds+0.05;
            try {
                guard();
                try {await hooks.font(initial.doc,{scope:'video-quiz',root:initial.root});guard();snapshot=courseVideoQuizSnapshot(initial);}
                catch(error){guard();record=records.find(r=>r.key==='unreadable')||{key:'unreadable',attempts:0,history:[]};if(!records.includes(record))records.push(record);manual(error.message,error);}
                if(snapshot){
                    record=records.find(r=>r.key===snapshot.key||r.questionIdentity===snapshot.questionIdentity);
                    // 无平台 ID 的未解除题目按内容保守关联；重渲染和回看不能重置计数。
                    if(!record&&snapshot.identitySource==='content')record=records.find(r=>r.fingerprint===snapshot.fingerprint&&r.phase!=='passed');
                    if(!record){record={key:snapshot.key,questionIdentity:snapshot.questionIdentity,videoIdentity:snapshot.videoIdentity,cueSeconds:snapshot.cueSeconds,fingerprint:snapshot.fingerprint,identitySource:snapshot.identitySource,phase:'reading',attempts:0,history:[],submissionStarted:false,outcomeConfirmed:false};records.push(record);}
                    record.questions=snapshot.questions.slice(0,50).map(q=>({id:q.id,number:q.number,type:q.type,question:q.question.slice(0,2000),instructions:(q.instructions||'').slice(0,400),options:q.options.slice(0,30).map(o=>({key:o.key,text:o.text.slice(0,800)}))}));
                    // 已开始但未获结果的动作只等待，不因刷新或新运行重复确认。
                    if(records.some(r=>r.submissionStarted&&!r.outcomeConfirmed)){hooks.submitting(true);record.submissionStarted=true;record.outcomeConfirmed=false;manual('上次确认结果不明，请人工核对，禁止重复确认',courseVideoQuizError('CX-EXE-006','上次确认结果不明'));}
                    else if(courseVideoQuizHasAnswers(snapshot))manual('弹题已有手工作答，等待人工处理');
                    else if(courseVideoQuizReadOnlyControls(snapshot)||!courseVideoQuizButton(candidate))manual('弹题控件或确认入口尚未可靠适配');
                    else if(record.phase==='replay-wait')record.phase='reading';
                }
                let attemptState={playing:hooks.playingCount(),seconds:video.currentTime};
                while(true){
                    guard();if(video.error)throw new Error(`视频加载/播放失败（错误 ${video.error.code}）`);
                    if(gateReleased(attemptState)){
                        record.phase='passed';record.gateResult='平台已解除弹题门槛并恢复实际播放';record.outcomeConfirmed=true;record.submissionStarted=false;hooks.submitting(false);save();return true;
                    }
                    if(record.phase==='manual-wait'){
                        const result=courseVideoQuizOutcome(candidate,{feedback:record.submissionStarted?freshFeedback():courseVideoQuizFeedback(candidate)});
                        if(result==='passed'){record.phase='passed';record.outcomeConfirmed=true;record.submissionStarted=false;hooks.submitting(false);save();}
                        else {hooks.status(`视频弹题等待人工处理：${record.reason}`);await hooks.wait();continue;}
                    }
                    if(record.phase==='passed'){
                        const current=rebind();if(current){const button=courseVideoQuizButton(current,'continue');if(button&&!record.continueClicked){record.continueClicked=true;save();button.click();}}
                        if(!courseVideoQuizCandidate(video)){save();return true;}
                        hooks.status('视频弹题已获平台确认，等待原生界面继续');await hooks.wait();continue;
                    }
                    if(record.phase==='replay-wait'){
                        // 回看在主播放循环正常进行；同一错误轮次只建立一次有界额度。
                        if(!courseElementVisible(candidate.root)){hooks.rewatch(record);save();return true;}
                        hooks.status('平台要求回看，等待原生界面恢复播放');await hooks.wait();continue;
                    }
                    if(record.attempts>=6){manual('已进行 6 次自动确认，仍未通过，请人工处理');continue;}
                    candidate=rebind()||candidate;
                    if(!candidate.root.isConnected||!courseElementVisible(candidate.root)){manual('弹题在解答前发生变化，等待人工处理');continue;}
                    try {
                        snapshot=courseVideoQuizSnapshot(candidate);snapshotInvalidation=null;
                        const before=courseVideoQuizAnswers(snapshot);
                        child=new AbortController();const cancel=()=>child.abort();hooks.signal.addEventListener('abort',cancel,{once:true});
                        const signatureGuard=()=>{guard();if(snapshotInvalidation)throw snapshotInvalidation;if(intervened)throw courseVideoQuizError('CX-EXE-004','用户已介入弹题，等待人工处理');
                            const current=courseVideoQuizCandidate(video);if(!current||current.root!==snapshot.root)throw courseVideoQuizError('CX-CTL-006','弹题已重新渲染，等待人工处理');
                            assertQuestionSnapshot(snapshot);
                            const actual=courseVideoQuizAnswers(snapshot);
                            if(!scriptWriting&&[...before].some(([id,value])=>JSON.stringify(value.keys||value.value)!==JSON.stringify(actual.get(id)?.keys||actual.get(id)?.value)))throw courseVideoQuizError('CX-EXE-004','弹题答案已被修改，等待人工处理');};
                        snapshot.checkCurrent=signatureGuard;
                        record.phase='analyzing';save();
                        const feedback=snapshot.questions.map(q=>({questionId:q.id,previousAttempts:record.history.filter(h=>h.wrong).map(h=>({answer:h.answers.find(a=>a.id===q.id)?.answer||[],feedback:h.feedback}))})).filter(item=>item.previousAttempts.length);
                        let result;
                        try {result=await hooks.solve(snapshot,{...hooks.settings,signal:child.signal,answerFeedback:feedback,onModelRequest:()=>{guard();record.modelRequests=(record.modelRequests||0)+1;save();},onModelRetry:()=>{guard();record.modelRetries=(record.modelRetries||0)+1;save();}},message=>{signatureGuard();hooks.status(`视频弹题 ${record.attempts?`重试 ${record.attempts}/5`:'首次解答'}：${message}`);});}
                        finally {hooks.signal.removeEventListener('abort',cancel);child=null;}
                        signatureGuard();
                        if(result.analysisComplete===false){manual('部分题目未完成分析，已保留成功答案');continue;}
                        const unresolved=result.answers.filter(answer=>!answer.answer?.length||!questionCanAutoAnswer(snapshot.questions.find(q=>q.id===answer.id),answer.answerPolicy));
                        // 整份判错不能证明每个子题都错；只拒绝重复的整组答案。
                        const repeated=record.history.some(h=>h.wrong&&h.answers.length===result.answers.length&&result.answers.every(a=>h.answers.some(old=>old.id===a.id&&courseVideoQuizSameAnswer(old.answer,a.answer))));
                        if(repeated){manual('AI 再次返回已经判错的答案，未重复确认');continue;}
                        record.phase='prefilling';save();scriptWriting=true;
                        const summary=await hooks.prefill(snapshot,result.answers,{ownedAnswers:owned,onWrite:value=>{nativeWrite=value;}});
                        // Validate the completed script-owned write before ending its authorization.
                        // The analysis guard still compares the original answer state until replaced below.
                        guard();assertQuestionSnapshot(snapshot);owned=courseVideoQuizAnswers(snapshot);scriptWriting=false;
                        if(unresolved.length||result.answers.length!==snapshot.questions.length||summary.skipped||summary.unverified||summary.filled+summary.already!==snapshot.questions.length){manual('支持题已填写，仍有题目或控件需人工处理，未确认');continue;}
                        snapshot.checkCurrent=()=>{guard();if(intervened)throw courseVideoQuizError('CX-EXE-004','用户已介入弹题，等待人工处理');assertQuestionSnapshot(snapshot);};
                        snapshot.checkCurrent();
                        const button=courseVideoQuizButton(candidate);
                        if(!button){manual('确认按钮不可用，未确认');continue;}
                        record.phase='submitting';record.submissionStarted=true;record.outcomeConfirmed=false;record.attempts++;
                        record.history.push({attempt:record.attempts,beforeSeconds:Number(video.currentTime),answers:result.answers.map(a=>({id:a.id,answer:[...a.answer]})),feedback:'',wrong:false});
                        attemptState={playing:hooks.playingCount(),seconds:video.currentTime};
                        // 丢弃提交前已经排队的旧反馈变更；旧“错误”不能冒充新轮次结果。
                        observer.takeRecords();
                        feedbackChanges.clear();feedbackBaseline=courseVideoQuizFeedbackEntries(candidate);
                        record.feedbackBeforeSubmit=courseVideoQuizFeedback(candidate);
                        hooks.submitting(true);save();button.click();
                        const deadline=hooks.now()+hooks.confirmMs;
                        while(true){
                            guard();const feedback=freshFeedback(),outcome=courseVideoQuizOutcome(candidate,{feedback});
                            if(outcome==='passed'){record.phase='passed';record.outcomeConfirmed=true;record.submissionStarted=false;hooks.submitting(false);save();break;}
                            if(outcome==='wrong'||outcome==='replay-required'){
                                const history=record.history.at(-1);history.feedback=feedback;history.wrong=true;
                                record.outcomeConfirmed=true;record.submissionStarted=false;hooks.submitting(false);
                                if(outcome==='replay-required'){record.phase='replay-wait';save();hooks.rewatch(record);save();break;}
                                const next=rebind();if(!next||!courseVideoQuizButton(next)||record.attempts>=6){manual(record.attempts>=6?'已进行 6 次自动确认，仍未通过':'平台已判错，但原生界面不允许重新作答');break;}
                                candidate=next;record.phase='reading';save();break;
                            }
                            if(gateReleased(attemptState)){record.phase='passed';record.gateResult='平台解除门槛并恢复实际播放';record.outcomeConfirmed=true;record.submissionStarted=false;hooks.submitting(false);save();break;}
                            if(hooks.now()>=deadline){manual('确认结果不明，请人工核对，禁止重复确认',courseVideoQuizError('CX-EXE-003','确认结果不明'));break;}
                            hooks.status(`视频弹题第 ${record.attempts}/6 次确认，等待平台结果`);await hooks.wait();
                        }
                    }catch(error){scriptWriting=false;guard();const failure=snapshotInvalidation||error;manual(failure.message,failure);}
                }
            }finally{
                child?.abort();video.removeEventListener('error',onMediaError);observer.disconnect();initial.root.removeEventListener('input',onEdit,true);initial.root.removeEventListener('change',onEdit,true);initial.root.removeEventListener('click',onEdit,true);
                hooks.submitting(Boolean(record?.submissionStarted&&!record?.outcomeConfirmed));hooks.waiting(false);
            }
        };
        return {handle,close(){closed=true;hooks.wake();}};
    }
