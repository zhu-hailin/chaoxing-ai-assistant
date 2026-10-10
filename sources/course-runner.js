    const COURSE_RUN_LIMITS = Object.freeze({ pollMs:500, settleMs:700, loadMs:30000, videoLoadMs:60000, completionMs:30000,
        stallMs:300000, resumeMs:3000, maxResumes:8, resumeProgressSeconds:10, slideMs:1000, documentMs:300000, documentCheckMs:500, documentStableMs:1000, documentBottomSamples:3, documentFallbackStepMs:200, documentFallbackPasses:2, submitMs:30000 });
    let courseRunner;
    function courseTimeoutError(message) {
        return Object.assign(new Error(message),{code:'COURSE_TIMEOUT'});
    }
    function courseRunActive(doc = document) {
        const owner = studyOwnerDocument(doc);
        return Boolean(owner?.getElementById('cx-ai-course-lease')?.getAttribute('data-run-id'));
    }
    function courseVideoEventTrace(task) {
        const labels={pause:'暂停',playing:'开始播放',waiting:'等待播放数据',stalled:'媒体加载停滞',error:'媒体错误',ended:'播放结束'};
        // 兼容此前保存的报告；只输出固定诊断字段，不复制资源地址或额外属性。
        const events=Array.isArray(task.playbackEvents)?task.playbackEvents.filter(item=>item && Object.prototype.hasOwnProperty.call(labels,item.event) && Number.isFinite(item.at)).slice(-12):[];
        if(!events.length)return '';
        const hasStart=Number.isFinite(task.startedAt),start=hasStart?task.startedAt:events[0].at;
        return `\n最近播放事件（${hasStart?'相对启动时间':'相对首条保留记录'}）：\n`+events.map(item=>{
            const offset=Math.max(0,(item.at-start)/1000).toFixed(1);
            const position=Number.isFinite(item.seconds)?Math.floor(item.seconds):'未知';
            const visibility=item.visibility==='hidden'?'后台':item.visibility==='visible'?'可见':'可见性未知';
            const focus=item.focused===false?'、窗口失焦':item.focused===true?'、窗口有焦点':'';
            const ready=Number.isInteger(item.readyState)?item.readyState:'未知';
            const network=Number.isInteger(item.networkState)?item.networkState:'未知';
            const error=Number.isInteger(item.errorCode)?item.errorCode:'无';
            return `+${offset} 秒 ${labels[item.event]}：视频 ${position} 秒，${visibility}${focus}，readyState=${ready}，networkState=${network}，错误码=${error}`;
        }).join('\n');
    }
    function courseReportText(report) {
        if (!report) return '尚未开始自动学习';
        const finished = report.chapters.filter(item => ['done','already'].includes(item.status)).length;
        const completedQuizzes=report.chapters.flatMap(chapter=>chapter.tasks).filter(task=>task.type==='quiz'&&task.status==='already').length;
        const taskFree = report.chapters.filter(item=>item.status==='no-tasks');
        const skipped = report.chapters.filter(item => item.status === 'skipped');
        const timedOut=report.chapters.filter(item=>item.status==='timed-out');
        const issues = report.chapters.flatMap(chapter => chapter.issues.map(issue => `${chapter.number} ${chapter.title}${issue.number ? ` · 第 ${issue.number} 题` : ''}：${issue.reason}`));
        const videoStates = report.chapters.flatMap(chapter => chapter.tasks.filter(task => task.type==='video' && ['stopped','timed-out'].includes(task.status) && task.playbackState).map(task => {
            const state=task.playbackState, pause=task.lastPause || state;
            const visibility=pause.visibility==='hidden'?'后台':pause.visibility==='visible'?'可见':'可见性未知';
            const focus=pause.focused===false?'、窗口失焦':pause.focused===true?'、窗口有焦点':'';
            const position=Number.isFinite(state.seconds)?Math.floor(state.seconds):'未知';
            return `${chapter.number} ${chapter.title} · 视频 ${task.number || 1}：暂停 ${task.pauseCount || 0} 次，恢复 ${task.resumes || 0} 次；${task.lastPause?'最后暂停时':'检测时'}课程页${visibility}${focus}；检测时位置 ${position} 秒，readyState=${state.readyState ?? '未知'}，networkState=${state.networkState ?? '未知'}，错误码=${state.errorCode ?? '无'}。暂停来源尚未确认。`+courseVideoEventTrace(task);
        }));
        const documentStates=report.chapters.flatMap(chapter=>chapter.tasks.filter(task=>task.type==='document'&&task.documentState).map(task=>{
            const state=task.documentState;
            return `${chapter.number} ${chapter.title} · 资料 ${task.number||1}：位置 ${Math.round(state.top)}/${Math.round(Math.max(0,state.total-state.height))}，距底部 ${Math.round(state.distance*100)/100}px；图片 ${state.imageCount} 张，未加载 ${state.pendingImages} 张；到底校正 ${task.bottomCorrections||0} 次，快速遍历 ${task.fallbackPasses||0} 轮。`;
        }));
        return `${report.status === 'done' ? (skipped.length || taskFree.length || timedOut.length ? '目录遍历结束' : '全部流程完成') : report.status === 'running' ? '自动学习进行中' : '自动学习已停止'}：${finished}/${report.chapters.length} 个章节；${report.videos} 个视频结束，${report.documents} 份资料完成，${report.quizzes} 个测验提交成功。`
            + (completedQuizzes ? `\n${completedQuizzes} 个章节测验已完成，已跳过作答。` : '')
            + (taskFree.length ? `\n${taskFree.length} 个章节无任务点，已直接继续下一节。` : '')
            + (skipped.length ? `\n用户跳过 ${skipped.length} 个章节（不计为完成）：\n` + skipped.map(chapter => `${chapter.number} ${chapter.title}`).join('\n') : '')
            + (timedOut.length ? `\n超时跳过 ${timedOut.length} 个章节（不计为完成）：\n` + timedOut.map(chapter=>`${chapter.number} ${chapter.title}：${chapter.reason}`).join('\n') : '')
            + (report.reason ? `\n${report.reason}` : '') + (issues.length ? '\n需人工处理：\n' + issues.join('\n') : '')
            + (videoStates.length ? '\n视频状态记录：\n' + videoStates.join('\n') : '')
            + (documentStates.length ? '\n资料状态记录：\n' + documentStates.join('\n') : '');
    }
    function coursePanelStatusMessage(state, doc = document) {
        const owner=studyOwnerDocument(doc),scope=owner&&courseScoreKey(owner);
        const report=courseRunner?.report || (scope?get(`cx_course_run:${scope}`,null)?.report:null);
        if(report && state.message===courseReportText(report)) {
            return report.status==='running'?'自动学习进行中':report.status==='done'?'自动学习已结束':'自动学习已停止';
        }
        return state.message || '就绪';
    }
    function courseSkipResume(owner) {
        if(!owner || courseRunActive(owner))return null;
        const scope=courseScoreKey(owner),previous=scope?get(`cx_course_run:${scope}`,null):null;
        let session;try{session=owner.defaultView.sessionStorage.getItem('cx-ai-course-session');}catch{return null;}
        const chapter=previous?.report?.chapters?.[previous.chapterIndex];
        if(previous?.status!=='stopped'||previous.session!==session||chapter?.status!=='stopped')return null;
        if(chapter.tasks.some(task=>task.submissionStarted&&task.status!=='done'))return null;
        if(courseBlocker(courseFrameTree(owner).documents))return null;
        const active=readCourseCatalog(owner)?.entries.find(item=>!item.isGroup&&item.active);
        return active?.id===chapter.id?previous:null;
    }
    function createCourseRunner(owner, ctl, options = {}) {
        const limits = { ...COURSE_RUN_LIMITS, ...options.limits };
        const now = options.now || (() => Date.now());
        const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
        const scope = courseScoreKey(owner);
        const key = scope ? `cx_course_run:${scope}` : null;
        let session;
        try {
            session = owner.defaultView.sessionStorage.getItem('cx-ai-course-session');
            if (!session) { session = crypto.randomUUID(); owner.defaultView.sessionStorage.setItem('cx-ai-course-session',session); }
        } catch { session = crypto.randomUUID(); }
        let current = null;
        const api = { owner, key, get busy() { return Boolean(current && !current.cancelled); },
            get canSkip() { return current ? Boolean(!current.cancelled && current.chapter && !current.chapter.skipped && !current.chapter.submitting) : Boolean(courseSkipResume(owner)); },
            get report() { return current?.report || (key ? get(key,null)?.report : null); },
            stop(reason = '用户停止自动学习') {
                if (!current || current.cancelled) return;
                current.cancelled = true; current.reason = reason; current.abort.abort(); current.chapter?.abort.abort(); current.cancelWake();
                current.activeVideo?.pause();
            },
            skip() {
                if (!api.canSkip) return false;
                if(!current)return api.start({resume:true,skipCurrent:true});
                try { current.validate(); } catch(error) { api.stop(error.message); return false; }
                const chapter = current.chapter;
                chapter.skipped = true; chapter.abort.abort(); chapter.wake();
                current.activeVideo?.pause();
                current.notify('正在跳过本章节…','course-skipping');
                return true;
            },
            async start({ submit = true, skipLearned = true, fromCurrent = false, continueOnTimeout = true, muteVideo = true, resume = false, skipCurrent = false } = {}) {
                if (current || courseRunActive(owner)) return;
                if (!scope || studyOwnerDocument(owner) !== owner || !owner.querySelector('#mainid #iframe')) {
                    ctl.report('仅课程学习页面支持自动学习；独立作业页无法刷课','error'); return;
                }
                if (ctl.state.busy) return;
                const catalog = readCourseCatalog(owner);
                if (!catalog?.entries.some(item => !item.isGroup)) { ctl.report('没有读取到可遍历的课程目录','error'); return; }
                const previous = get(key,null);
                if(resume && (!previous || previous.session!==session))return;
                if(skipCurrent && !courseSkipResume(owner))return;
                const navigationResume=resume && previous?.handoff===true && previous.session===session;
                if (previous?.status === 'running' && !navigationResume && now()-previous.heartbeat < 15000) {
                    ctl.report('另一个页面正在运行本课程，请先停止该页面','error'); return;
                }
                const configuration = readModelConfiguration();
                const settings = {key:configuration.key,model:configuration.model,thinking:Boolean(get(KEY_THINKING,false)),effort:get(KEY_EFFORT,'high'),search:Boolean(get(KEY_SEARCH,false))};
                const entries=catalog.entries.filter(item=>!item.isGroup);
                let startIndex=0;
                if(!resume && fromCurrent) {
                    const active=entries.filter(item=>item.active);
                    if(active.length!==1) {ctl.report('无法确定当前章节，请刷新课程目录后重试','error');return;}
                    startIndex=entries.findIndex(item=>item.id===active[0].id);
                    if(startIndex<0) {ctl.report('当前章节不在课程目录中，请刷新后重试','error');return;}
                }
                // 本次起点裁剪队列；换页恢复使用原队列，不重新读取当前选中章节。
                const queue = resume && previous?.session === session ? previous.queue : entries.slice(startIndex).map(item => ({id:item.id,number:item.number,title:item.title}));
                if (!queue?.length) return;
                if (resume && JSON.stringify(previous.settings) !== JSON.stringify({ ...settings,key:undefined })) {
                    ctl.report('自动学习配置已变化，请重新开始','error'); return;
                }
                const report = resume ? previous.report : { status:'running', startedAt:now(), endedAt:null, reason:'', videos:0,documents:0,quizzes:0,
                    chapters:queue.map(item => ({...item,status:'unvisited',issues:[],tasks:[]})) };
                report.status = 'running'; report.reason = '';
                const run = {id:crypto.randomUUID(),queue,report,settings,submit:resume ? previous.submit : submit,
                    skipLearned:resume ? previous.skipLearned!==false : skipLearned!==false,
                    continueOnTimeout:resume ? previous.continueOnTimeout!==false : continueOnTimeout!==false,
                    muteVideo:resume ? previous.muteVideo!==false : muteVideo!==false,
                    fromCurrent:resume ? previous.fromCurrent===true : fromCurrent===true,startChapterId:resume ? previous.startChapterId||queue[0].id : queue[0].id,
                    chapterIndex:resume ? previous.chapterIndex : 0,tabIndex:resume ? previous.tabIndex : 0,
                    cancelled:false,abort:new AbortController(),expected:null,navigating:false,lastSaved:0};
                run.cancelWait = new Promise(resolve => { run.cancelWake = resolve; });
                if(skipCurrent) {
                    const chapter=report.chapters[run.chapterIndex];chapter.status='skipped';chapter.reason='用户跳过本章节';
                    for(const task of chapter.tasks.filter(task=>task.status==='stopped')) {task.status='skipped';task.reason=chapter.reason;}
                    run.chapterIndex++;run.tabIndex=0;
                }
                current = run;
                let lease = owner.getElementById('cx-ai-course-lease');
                if (!lease) { lease = owner.createElement('span'); lease.id = 'cx-ai-course-lease'; lease.hidden = true; owner.body.append(lease); }
                lease.setAttribute('data-run-id',run.id);
                const save = () => {
                    if(run.claimed && get(key,null)?.ownerId!==run.id)throw new Error('运行锁已失效');
                    set(key,{status:report.status,session,ownerId:run.id,handoff:run.handoff===true,heartbeat:now(),settings:{...settings,key:undefined},submit:run.submit,skipLearned:run.skipLearned,fromCurrent:run.fromCurrent,startChapterId:run.startChapterId,continueOnTimeout:run.continueOnTimeout,muteVideo:run.muteVideo,
                        queue,chapterIndex:run.chapterIndex,tabIndex:run.tabIndex,report});
                    run.claimed=true;
                    run.lastSaved = now();
                };
                const emitRun = (message, phase = 'course-running') => {
                    guardRun();lease.setAttribute('data-message',message);lease.setAttribute('data-phase',phase);
                    lease.setAttribute('data-can-skip',String(api.canSkip));
                    const video=run.activeVideo, duration=Number(video?.duration), elapsed=Number(video?.currentTime);
                    if(phase==='course-video' && Number.isFinite(duration) && duration>0 && Number.isFinite(elapsed)) {
                        lease.setAttribute('data-video-duration',String(duration));
                        lease.setAttribute('data-video-current',String(Math.max(0,Math.min(duration,elapsed))));
                    } else {
                        lease.removeAttribute('data-video-duration');lease.removeAttribute('data-video-current');
                    }
                    ctl.report(message,phase,true); if (now()-run.lastSaved > 2500) save();
                    owner.dispatchEvent(new owner.defaultView.Event('cx-ai-course-update'));
                    for (const doc of courseFrameTree(owner).documents) doc.dispatchEvent(new doc.defaultView.Event('cx-ai-course-state'));
                };
                const guardRun = () => {
                    if (run.cancelled) throw new Error(run.reason || '用户停止自动学习');
                    if (owner.getElementById('cx-ai-course-lease')?.getAttribute('data-run-id') !== run.id) throw new Error('运行锁已失效');
                    if (run.claimed && get(key,null)?.ownerId !== run.id) throw new Error('运行锁已失效');
                    if (courseScoreKey(owner) !== scope) throw new Error('课程或账号已变化');
                    const tree = courseFrameTree(owner), blocker = courseBlocker(tree.documents);
                    if (blocker) throw new Error(blocker);
                    // 提交跳转时当前测验及父 iframe 可短暂不可读；仅在有界提交等待中容许该父链。
                    // 其他任务跨域、用户换章/换标签、验证码和运行锁仍立即检查。
                    if (!run.navigating && tree.inaccessible.some(frame => !run.chapter?.submitting || !run.chapter.submissionFrames?.has(frame)))
                        throw new Error('任务 iframe 跨域或尚未加载，无法确认控件；请人工检查');
                    if (run.expected && !run.navigating) {
                        const active = readCourseCatalog(owner)?.entries.find(item => !item.isGroup && item.active);
                        if (active?.id !== run.expected) throw new Error('用户切换了章节，已停止，避免操作新题目');
                        if (run.expectedTab && courseTabs(owner).find(tab=>tab.active)?.id !== run.expectedTab) throw new Error('用户切换了页面标签，已停止');
                    }
                };
                const skippedError=()=>Object.assign(new Error('用户跳过本章节'),{code:'CHAPTER_SKIPPED'});
                const processChapter = async (chapter,entry) => {
                    // 每章独立闭包和取消信号：旧请求/解密/预填回调不能进入下一章。
                    const context=run.chapter;
                    const guard=()=>{
                        guardRun();
                        if(context!==run.chapter || context.skipped) throw skippedError();
                    };
                    const emit=(message,phase)=>{guard();emitRun(message,phase);};
                    const wait = async ms => {
                        guard(); await Promise.race([sleep(ms),run.cancelWait,context.wait]); guard();
                    };
                    const until = async (test, timeout, message) => {
                        const end = now()+timeout;
                        // 后台计时器可晚于期限才唤醒；先复查当前状态，再决定超时。
                        while(true) {
                            guard(); const value=test(); if(value)return value;
                            if(now()>=end)throw context.submitting ? new Error(message) : courseTimeoutError(message);
                            await wait(Math.min(limits.pollMs,Math.max(0,end-now())));
                        }
                    };
                    const race = async promise => {
                        const value = await Promise.race([promise,context.wait.then(() => {throw skippedError();}),run.cancelWait.then(() => {throw new Error(run.reason);})]); guard(); return value;
                    };
                    const taskDone = async node => {
                        if (courseTaskComplete(node) === false) await until(() => courseTaskComplete(node) === true,limits.completionMs,'播放/阅读结束，但平台未确认任务完成');
                    };
                    const playVideo = async (video, task) => {
                        run.activeVideo=video;
                        if (run.skipLearned && courseTaskComplete(video) === true) {task.status='already';return;}
                        video.muted=run.muteVideo;
                        task.startSeconds=Number(video.currentTime);task.resumes=0;task.unstableResumes=0;task.pauseCount=0;task.playbackEvents=[];task.startedAt=now();
                        let lastTime=video.currentTime,lastProgress=now(),lastPlay=-Infinity,playbackCheckpoint=Number(video.currentTime),wakeMedia=null;
                        // 被动记录公开媒体事件；不修改播放器回调、页面可见性或平台上报。
                        const snapshot=event=>({event,at:now(),seconds:Number(video.currentTime),duration:Number(video.duration),paused:video.paused,
                            readyState:video.readyState,networkState:video.networkState,visibility:owner.visibilityState || 'unknown',focused:typeof owner.hasFocus==='function'?owner.hasFocus():null,errorCode:video.error?.code ?? null});
                        const onMediaEvent=event=>{
                            if(context.skipped || run.cancelled || event.type==='pause' && video.ended)return;
                            const state=snapshot(event.type);task.playbackState=state;
                            if(event.type==='pause'){task.pauseCount++;task.lastPause=state;}
                            task.playbackEvents.push(state);if(task.playbackEvents.length>12)task.playbackEvents.shift();
                            wakeMedia?.();
                        };
                        // 媒体事件唤醒当前轮询；避免暂停后只能等后台定时器恢复调度。
                        const waitForMedia=async()=>{
                            let wake;const mediaEvent=new Promise(resolve=>{wake=resolve;wakeMedia=resolve;});
                            try {await race(Promise.race([wait(limits.pollMs),mediaEvent]));}
                            finally {if(wakeMedia===wake)wakeMedia=null;}
                        };
                        const eventTypes=['pause','playing','waiting','stalled','error','ended'];
                        for(const type of eventTypes)video.addEventListener(type,onMediaEvent);
                        try {
                            const startPlayback=async(recovery=false)=>{
                                guard();
                                if(recovery && task.unstableResumes>=limits.maxResumes)throw new Error('视频连续恢复后仍反复暂停，请检查播放器或页面提示');
                                lastPlay=now();
                                try {
                                    video.muted=run.muteVideo;
                                    const button=courseVideoStartButton(video);
                                    if(button) {
                                        guard();button.click();
                                        await until(()=>!video.paused || Number.isFinite(video.duration)&&video.duration>0,limits.videoLoadMs,'播放入口已点击，但视频尚未加载');
                                    }
                                    if(video.paused)await race(Promise.race([Promise.resolve(video.play()).then(()=>{if(context.abort.signal.aborted||run.cancelled)video.pause();}),sleep(limits.videoLoadMs).then(()=>{throw courseTimeoutError('视频启动超时');})]));
                                    guard();
                                    if(recovery){task.resumes++;task.unstableResumes++;}
                                    // 恢复保留真实进度检查点；短段播放的累计进展也能证明恢复有效。
                                    if(!recovery)playbackCheckpoint=Number(video.currentTime);
                                } catch(error) {
                                    if(context.skipped || run.cancelled)throw error;
                                    throw Object.assign(new Error(error.name==='NotAllowedError'?'浏览器阻止自动播放，请手动启用播放后重新开始':`视频无法启动：${error.message}`),{code:error.code});
                                }
                            };
                            if(video.paused)await startPlayback();
                            emit('已启动视频，正在读取时长…','course-video');
                            await until(()=>Number.isFinite(video.duration)&&video.duration>0,limits.videoLoadMs,'视频时长无法读取或仍在加载');
                            task.durationSeconds=Number(video.duration);lastProgress=now();
                            while(!video.ended) {
                                guard();
                                if (!video.isConnected) throw new Error('视频节点已替换，已停止');
                                if(!courseFrameTree(owner).documents.includes(video.ownerDocument)) throw new Error('视频页面已切换，已停止');
                                video.muted=run.muteVideo;
                                if (video.error) throw new Error(`视频加载/播放失败（错误 ${video.error.code}）`);
                                if (video.seeking) throw new Error('检测到视频进度跳转，无法确认完整播放');
                                const observedTime=Number(video.currentTime);
                                if(observedTime>lastTime+0.05){lastProgress=now();lastTime=observedTime;}
                                // 首次启动不算恢复；累计真实进度增加 10 秒后重置连续恢复预算。
                                // play() resolve 或后台经过了足够墙钟时间，都不能证明恢复有效。
                                if(observedTime-playbackCheckpoint>=limits.resumeProgressSeconds){task.unstableResumes=0;playbackCheckpoint=observedTime;}
                                if(video.paused && now()-lastPlay>=limits.resumeMs)await startPlayback(true);
                                if (now()-lastProgress>=limits.stallMs) throw courseTimeoutError('视频进度长时间没有变化，可能正在缓冲或暂停');
                                const remaining=Math.max(0,video.duration-video.currentTime);
                                emit(`第 ${run.chapterIndex+1}/${queue.length} 章：视频 ${Math.floor(video.currentTime)}/${Math.floor(video.duration)} 秒，剩余约 ${Math.ceil(remaining)} 秒`,'course-video');
                                await waitForMedia();
                            }
                            await taskDone(video);task.status='done';task.endedAt=now();report.videos++;
                        } finally {
                            task.playbackState=snapshot('snapshot');
                            for(const type of eventTypes)video.removeEventListener(type,onMediaEvent);
                        }
                    };
                    const readDocument = async (reader, task) => {
                        if(run.skipLearned && courseTaskComplete(reader.node)===true){task.status='already';return;}
                        const readingDeadline=now()+limits.documentMs;
                        if(reader.kind==='remote-scroll' || reader.kind==='scroll') {
                            const remote=reader.kind==='remote-scroll',contentRoot=reader.contentRoot||reader.node;
                            let previousTargets=[],signature='',stable=0,stableSince=null,confirmationSince=null;
                            let unavailableSince=null,lastProgress=now(),lastPosition='',fallbackPasses=0;
                            task.bottomCorrections=0;task.fallbackPasses=0;
                            const ensureCurrent=()=>{
                                guard();
                                if(!reader.node.isConnected || !courseFrameTree(owner).documents.includes(reader.doc))throw new Error('资料页面已切换，已停止');
                            };
                            const inspect=async op=>{
                                ensureCurrent();
                                if(now()>=readingDeadline)throw courseTimeoutError('PPT 滚动阅读超时，请人工检查');
                                let states,targetsChanged=false;
                                if(remote) {
                                    const state=await race(reader.request(op,context.abort.signal,Math.min(limits.loadMs,Math.max(1,readingDeadline-now()))));
                                    ensureCurrent();
                                    if(state.canBottom!==true)throw new Error('阅读器版本未同步，请更新脚本并刷新整个课程页');
                                    states=[state];
                                } else {
                                    const targets=reader.targets();
                                    targetsChanged=targets.length!==previousTargets.length || targets.some((node,i)=>node!==previousTargets[i]);
                                    previousTargets=targets;
                                    states=targets.map(target=>{
                                        if(op==='bottom')courseScrollToBottom(target);
                                        else if(op==='top')courseDocumentScrollTo(target,0);
                                        else if(op==='scan')courseDocumentScrollTo(target,Math.min(Math.max(0,target.scrollHeight-target.clientHeight),target.scrollTop+Math.max(1,Math.floor(target.clientHeight*0.9))));
                                        return courseDocumentScrollState(target,contentRoot);
                                    });
                                }
                                if(states.some(state=>!['top','height','total'].every(k=>Number.isFinite(state[k])&&state[k]>=0)))throw new Error('资料滚动尺寸无法读取');
                                const loaded=states.length>0 && states.every(state=>state.loaded&&state.height>0);
                                const bottom=loaded && states.every(state=>Math.abs(Math.max(0,state.total-state.height)-state.top)<=1);
                                const nextSignature=JSON.stringify(states.map(state=>[state.targetId||'',state.height,state.total,state.imageCount]));
                                const changed=targetsChanged||nextSignature!==signature;
                                if(changed)signature=nextSignature;
                                const position=JSON.stringify(states.map(state=>state.top));
                                if(changed || position!==lastPosition){lastProgress=now();lastPosition=position;}
                                const first=states[0];
                                task.documentState=first?{top:first.top,height:first.height,total:first.total,
                                    distance:Math.max(...states.map(state=>Math.abs(Math.max(0,state.total-state.height)-state.top))),
                                    imageCount:first.imageCount,pendingImages:first.pendingImages}:null;
                                return {loaded,bottom,changed,pending:states.some(state=>state.pendingImages>0)};
                            };
                            const reset=()=>{stable=0;stableSince=null;confirmationSince=null;};
                            let state=await inspect('read');
                            while(true) {
                                ensureCurrent();
                                if(!state.loaded) {
                                    reset();unavailableSince??=now();
                                    if(now()-unavailableSince>=limits.loadMs)throw courseTimeoutError('PPT 图片或阅读区域仍在加载，无法确认阅读区域');
                                } else {
                                    unavailableSince=null;
                                    task.bottomCorrections++;state=await inspect('bottom');
                                    if(state.changed || !state.bottom || !state.loaded)reset();
                                    if(state.bottom) {
                                        stableSince??=now();stable++;
                                        if(stable>=limits.documentBottomSamples && now()-stableSince>=limits.documentStableMs) {
                                            if(state.pending) {
                                                if(fallbackPasses>=limits.documentFallbackPasses)throw courseTimeoutError('PPT 快速遍历后仍有图片未加载，无法确认阅读完成');
                                                task.fallbackPasses=++fallbackPasses;reset();
                                                emit(`正在补载第 ${task.number||1} 份 PPT…`,'course-document');
                                                state=await inspect('top');
                                                while(!state.bottom || !state.loaded) {
                                                    await wait(limits.documentFallbackStepMs);state=await inspect('scan');
                                                    if(now()-lastProgress>=limits.loadMs)throw courseTimeoutError('资料滚动没有响应或图片仍未加载');
                                                }
                                                // 最后一页的懒加载也需要一个真实等待间隔。
                                                await wait(limits.documentCheckMs);state=await inspect('read');continue;
                                            }
                                            if(courseTaskComplete(reader.node)===true) {
                                                task.status='done';task.reader=reader.kind;report.documents++;return;
                                            }
                                            confirmationSince??=now();
                                            if(now()-confirmationSince>=limits.completionMs)throw courseTimeoutError('PPT 已确认到最底部，但平台尚未确认任务完成');
                                        }
                                    } else if(now()-lastProgress>=limits.loadMs)throw courseTimeoutError('资料滚动没有响应，无法确认到达底部');
                                }
                                emit(`正在确认第 ${task.number||1} 份 PPT 的底部与完成状态…`,'course-document');
                                await wait(limits.documentCheckMs);state=await inspect('read');
                                // read 捕捉等待期间的布局变化，不能让紧随其后的 bottom 覆盖该变化。
                                if(state.changed || !state.bottom || !state.loaded)reset();
                            }
                        }
                        const last=reader.last();
                        if (reader.current()<reader.total && last && courseElementVisible(last) && !last.disabled) {guard();last.click();}
                        else {
                            while(reader.current()<reader.total) {
                                guard();
                                if(now()>readingDeadline)throw courseTimeoutError('资料分页阅读超时，请人工检查');
                                const page=reader.current(),next=reader.next();
                                if(!Number.isInteger(page)||page<1||!next||!courseElementVisible(next)||next.disabled) throw new Error('资料缺少可确认的末页或下一页控件');
                                guard();next.click();
                                await until(()=>reader.current()>page,limits.loadMs,'资料翻页没有响应');await wait(limits.slideMs);
                            }
                        }
                        await until(()=>reader.current()===reader.total,limits.loadMs,'无法确认资料已到末页');
                        reader.node.scrollIntoView?.({block:'end'});await wait(limits.slideMs);
                        // 到末页只证明翻页，必须另外收到平台任务完成状态。
                        await until(()=>courseTaskComplete(reader.node)===true,limits.completionMs,'资料已到末页，但平台未确认任务完成');
                        task.status='done';task.totalPages=reader.total;report.documents++;
                    };
                    const solveQuiz = async (doc, task, chapter) => {
                        if (doc.querySelector('.fanyaMarking_left')) throw new Error('这是作业页面，无法在刷课流程自动处理');
                        if (courseQuizComplete(doc) || courseTaskComplete(doc.querySelector('.CeYan,.singleQuesId,.TiMu,[data-quiz-status]')||doc.body)===true) {task.status='already';emit('章节测验已完成，跳过作答…','course-running');return;}
                        emit('正在分析章节测验…','generating');await race(ensureFontDecoded(doc));guard();
                        const body=doc.body;
                        const checkQuiz=()=>{guard();if(!courseFrameTree(owner).documents.includes(doc)||doc.body!==body) throw new Error('测验页面已切换，已停止');};
                        const data=extract(doc),snapshot={doc,questions:data.questions,media:data.media,signature:signature(data.questions,data.media),checkCurrent:checkQuiz};
                        ctl.output(data);
                        if(!data.questions.length) throw new Error('测验没有可提取的题目');
                        if(!settings.key || !settings.model) {
                            chapter.issues.push(...data.questions.map(q=>({number:q.number,reason:'章节测验需要先配置模型和 API Key'})));
                            throw new Error('章节测验需要先配置模型和 API Key');
                        }
                        const known=data.questions.filter(q=>q.capabilities.analyze);
                        if(!known.length) {
                            chapter.issues.push(...data.questions.map(q=>({number:q.number,reason:q.diagnostics.join('；')||'题型未适配'})));
                            throw new Error('测验题型尚未适配，无法自动填写');
                        }
                        let answers;
                        try { answers=await race(solveQuestionBatches(snapshot,{...settings,signal:context.abort.signal},message=>emit(message,'generating'))); }
                        catch(error) {guard();chapter.issues.push(...data.questions.map(q=>({number:q.number,reason:`未完成分析：${error.message}`})));throw error;}
                        guard();checkSnapshot(snapshot);
                        const payload={...data,...answers,model:settings.model};ctl.output(payload);
                        const byId=new Map(answers.answers.map(a=>[a.id,a]));
                        const invalid=data.questions.filter(q=>!q.capabilities.prefill || !byId.get(q.id)?.answer?.length);
                        if(invalid.length) {
                            chapter.issues.push(...invalid.map(q=>({number:q.number,reason:byId.get(q.id)?.reason||q.diagnostics.join('；')||'无可靠答案或文本控件不可自动填写'})));
                            throw new Error('存在无法可靠自动填写的题目，未提交测验');
                        }
                        const summary=await race(prefillChecked(snapshot,answers.answers));ctl.output({...payload,prefill:summary});
                        if(summary.skipped || summary.unverified || summary.filled+summary.already!==data.total) {
                            chapter.issues.push(...summary.details.map(reason=>({number:Number(reason.match(/第\s*(\d+)\s*题/)?.[1])||null,reason})));
                            throw new Error('测验答案未全部可靠预填，已停止，未提交');
                        }
                        if(!run.submit) throw new Error('预填完成，等待人工提交；自动流程已停止');
                        checkSnapshot(snapshot);guard();
                        const buttons=courseSubmitButton(doc);
                        if(buttons.length!==1) throw new Error('无法唯一确认章节测验提交按钮，已保留预填答案');
                        if(courseSubmitConfirmation(doc,owner).length) throw new Error('已有提交确认窗口，请人工核对后再开始');
                        // 必须在第一次点击前保存原 frame/测验标识，点击可能同步触发文档导航。
                        const frame=doc.defaultView.frameElement;
                        const quizId=pageURL(doc)?.searchParams.get('workId');
                        context.submissionFrames=new Set();
                        for(let current=frame,depth=0;current&&depth<12;depth++) {
                            context.submissionFrames.add(current);
                            if(current.ownerDocument===owner)break;
                            current=current.ownerDocument.defaultView?.frameElement;
                        }
                        context.submitting=true;task.submissionStarted=true;
                        emit('正在提交并等待平台确认…','course-submitting');buttons[0].click();
                        let confirmed=false;
                        await until(()=>{
                            const tree=courseFrameTree(owner);
                            // 不读取导航期间的旧完成页，也不把跨域/空文档当提交成功。
                            if(tree.inaccessible.length)return false;
                            let resultDoc;
                            try { resultDoc=frame?.isConnected?frame.contentDocument:doc; }
                            catch { return false; }
                            if(!resultDoc?.body || !tree.documents.includes(resultDoc)) return false;
                            if(quizId && pageURL(resultDoc)?.searchParams.get('workId')!==quizId) throw new Error('提交后跳到了其他测验，无法确认结果');
                            if(courseQuizComplete(resultDoc)) return true;
                            const dialogs=courseSubmitConfirmation(resultDoc,owner);
                            if(dialogs.length>1) throw new Error('出现多个提交确认入口，请人工确认');
                            if(dialogs.length===1 && !confirmed){guard();confirmed=true;dialogs[0].click();}
                            return false;
                        },limits.submitMs,'测验提交后未收到成功状态，请人工核对；不会重试提交');
                        context.submitting=false;context.submissionFrames=null;task.status='done';task.questionCount=data.total;report.quizzes++;
                    };
                    run.expected=entry.id;run.expectedTab=null;run.navigating=true;chapter.status='running';
                    emit(`正在打开章节：${entry.number} ${entry.title}`,'course-navigating');
                    const before=courseContentFingerprint(owner);
                    if(!entry.active) {
                        save();entry.target.click();
                        await until(()=>readCourseCatalog(owner)?.entries.some(item=>item.id===entry.id&&item.active)
                            && courseContentChanged(before,courseContentFingerprint(owner)) && courseContentReady(owner),limits.loadMs,'章节内容未成功切换');
                    }
                    await until(()=>courseContentReady(owner),limits.loadMs,'章节内容加载超时');
                    await wait(limits.settleMs);run.navigating=false;guard();
                    let tabs=courseTabs(owner);
                    if(tabs.some(tab=>tab.disabled)) throw new Error('章节页面标签未解锁，无法自动继续');
                    if(!tabs.length) tabs=[{id:'current',title:'当前页面',active:true}];
                    let taskFreeOnly=!chapter.tasks.some(task=>task.type!=='non-task');
                    const tabIds=tabs.map(tab=>tab.id);
                    for(;run.tabIndex<tabIds.length;run.tabIndex++) {
                        const id=tabIds[run.tabIndex],tab=courseTabs(owner).find(item=>item.id===id);
                        if(id!=='current' && !tab) throw new Error('章节页面标签发生变化');
                        if(tab && !tab.active) {
                            const old=courseContentFingerprint(owner);run.navigating=true;save();tab.node.click();
                            await until(()=>courseTabs(owner).some(item=>item.id===id&&item.active)
                                && courseContentChanged(old,courseContentFingerprint(owner)) && courseContentReady(owner),limits.loadMs,'页面标签未成功切换');
                            await wait(limits.settleMs);run.navigating=false;
                        }
                        run.expectedTab=id==='current'?null:id;guard();
                        let tree=courseFrameTree(owner);
                        let docs=tree.documents.slice(1);
                        if(docs.some(doc=>doc.querySelector('.fanyaMarking_left')))throw new Error('检测到作业页面，无法自动刷课');
                        let allTasks=coursePageTasks(tree);
                        if(!allTasks.length && !coursePageWithoutTasks(tree,allTasks)
                            && (/视频|PPT|幻灯片|章节测验/.test(tab?.title||'') || docs.some(doc=>courseVisibleMarker(doc.body,'.ans-attach-ct,.ans-job-icon,.ans-job,[data-course-task]')))) {
                            emit('正在等待任务控件加载…','course-running');
                            await until(()=>{
                                tree=courseFrameTree(owner);docs=tree.documents.slice(1);allTasks=coursePageTasks(tree);
                                if(docs.some(doc=>doc.querySelector('.fanyaMarking_left')))throw new Error('检测到作业页面，无法自动刷课');
                                return allTasks.length || coursePageWithoutTasks(tree,allTasks);
                            },limits.loadMs,'任务控件未适配或仍未加载，无法自动完成此页面');
                        }
                        if(coursePageWithoutTasks(tree,allTasks)) {
                            chapter.tasks.push({tab:id,type:'non-task',status:'not-required'});
                            emit('本节没有任务点，正在继续下一节…','course-running');save();continue;
                        }
                        taskFreeOnly=false;
                        let tasks=allTasks.filter(item=>courseTaskRequired(item.node)!==false);
                        const processed=new Set();
                        let videoNumber=0,documentNumber=0;
                        while(tasks.length) {
                            const item=tasks[0];
                            guard();
                            const task={tab:id,type:item.type,status:'running'};
                            if(item.type==='video')task.number=++videoNumber;
                            if(item.type==='document')task.number=++documentNumber;
                            chapter.tasks.push(task);
                            if(item.type==='video')await playVideo(item.node,task);
                            else if(item.type==='document') {emit('正在阅读资料…','course-document');await readDocument(item.reader,task);}
                            else await solveQuiz(item.doc,task,chapter);
                            processed.add(item.node);
                            save();
                            // 控件可在上一任务播放/阅读时延迟加入；每次重新读取，不重复执行原节点。
                            const collectNext=()=>{
                                const nextTree=courseFrameTree(owner);
                                if(nextTree.documents.some(doc=>doc.querySelector('.fanyaMarking_left')))throw new Error('检测到作业页面，无法自动刷课');
                                return coursePageTasks(nextTree).filter(item=>!processed.has(item.node)&&courseTaskRequired(item.node)!==false);
                            };
                            tasks=collectNext();
                            const entryState=()=>readCourseCatalog(owner)?.entries.find(item=>item.id===entry.id);
                            const lastTab=run.tabIndex===tabIds.length-1;
                            const pendingHere=()=>courseFrameTree(owner).documents.slice(1).some(doc=>[...doc.querySelectorAll('.ans-attach-ct,[data-course-task]')]
                                .some(node=>courseElementVisible(node)&&courseTaskRequired(node)!==false&&courseTaskComplete(node)===false));
                            if(!tasks.length && entryState()?.pending>0 && !entryState()?.completed && (lastTab||pendingHere())) {
                                emit('正在等待后续任务或平台完成确认…','course-running');
                                const next=await until(()=>{
                                    const found=collectNext();
                                    if(found.length)return {tasks:found};
                                    if(!lastTab&&!pendingHere())return {tasks:[]};
                                    return entryState()?.completed||entryState()?.pending===0?{tasks:[]}:false;
                                },limits.completionMs,'本章仍有未完成任务或后续控件未加载，已停止');
                                tasks=next.tasks;
                            }
                        }
                        if(!processed.size) {
                            const text=docs.map(doc=>clean(doc.body?.textContent)).join(' ');
                            const loaded=docs.some(doc=>doc.body?.children.length || clean(doc.body?.textContent));
                            if(!loaded) throw new Error('章节内容为空或仍在加载，无法确定是否无任务');
                            if(/视频|PPT|幻灯片|章节测验/.test(tab?.title||'') || docs.some(doc=>doc.querySelector('#img.imglook,.swiper-container,iframe[name="bookifame"],.pdfViewer,embed[type="application/pdf"]'))) throw new Error('任务控件未适配，无法自动完成此页面');
                            if(!text && !loaded) throw new Error('页面内容未读取到');
                            chapter.tasks.push({tab:id,type:'text',status:'viewed'});
                        }
                        save();
                    }
                    const pending=()=>readCourseCatalog(owner)?.entries.find(item=>item.id===entry.id);
                    if(taskFreeOnly && !(pending()?.pending>0)) {chapter.status='no-tasks';save();return;}
                    if(!pending()?.completed && pending()?.pending!==0) await until(()=>pending()?.completed||pending()?.pending===0,limits.completionMs,'本章仍有未完成任务或状态未提供，已停止');
                    chapter.status='done';save();
                };
                run.validate=guardRun;run.notify=emitRun;
                const onUnload = () => {
                    if(!current) return;
                    run.leaving=true;
                    run.handoff=run.navigating;
                    report.status=run.navigating?'running':'stopped'; report.reason=run.navigating?'页面导航中，等待恢复':'页面已离开或刷新，自动流程停止';
                    save();api.stop(report.reason);
                };
                owner.defaultView.addEventListener('pagehide',onUnload,{once:true});
                let watchdog;
                try {
                    save();
                    watchdog=owner.defaultView.setInterval(()=>{
                        try {guardRun();if(now()-run.lastSaved>2500)save();} catch(error) {api.stop(error.message);}
                    },limits.pollMs);
                    for(;run.chapterIndex<queue.length;run.chapterIndex++,run.tabIndex=0) {
                        guardRun();const chapter=report.chapters[run.chapterIndex];
                        const entry=readCourseCatalog(owner)?.entries.find(item=>item.id===chapter.id);
                        if(!entry?.target?.isConnected) throw new Error('课程目录发生变化或章节入口不存在');
                        if(run.skipLearned && entry.completed){chapter.status='already';save();continue;}
                        const context={abort:new AbortController(),skipped:false,submitting:false};
                        context.wait=new Promise(resolve=>{context.wake=resolve;});run.chapter=context;
                        try { await processChapter(chapter,entry); }
                        catch(error) {
                            guardRun();
                            if(context.skipped) {
                                chapter.status='skipped';chapter.reason='用户跳过本章节';
                                for(const task of chapter.tasks.filter(task=>task.status==='running')) {task.status='skipped';task.reason=chapter.reason;}
                            } else if(run.continueOnTimeout && ['COURSE_TIMEOUT','TIMEOUT'].includes(error.code) && !context.submitting
                                && !chapter.tasks.some(task=>task.submissionStarted && task.status!=='done')) {
                                context.timedOut=true;chapter.status='timed-out';chapter.reason=error.message;
                                chapter.issues.push({number:null,reason:error.message});
                                for(const task of chapter.tasks.filter(task=>task.status==='running')) {task.status='timed-out';task.reason=error.message;}
                                emitRun(`本章节超时，继续下一节：${entry.number} ${entry.title}`,'course-running');
                            } else throw error;
                            save();
                        } finally {
                            context.abort.abort();
                            if(context.skipped || context.timedOut) run.activeVideo?.pause();
                            run.chapter=null;
                            run.expected=null;run.expectedTab=null;run.navigating=false;
                            lease.setAttribute('data-can-skip','false');
                        }
                    }
                    report.status='done';
                } catch(error) {
                    if(!run.leaving) {report.status='stopped';report.reason=error.message;}
                    const chapter=report.chapters[run.chapterIndex];
                    if(report.status==='stopped' && chapter && chapter.status!=='already' && chapter.status!=='done') {
                        chapter.status='stopped';
                        for(const task of chapter.tasks.filter(task=>task.status==='running')) {task.status='stopped';task.reason=error.message;}
                        if(!chapter.issues.length) chapter.issues.push({number:null,reason:error.message});
                    }
                } finally {
                    report.endedAt=report.status==='running'?null:now();
                    try{save();}catch{report.status='stopped';report.reason+='；运行进度无法保存';}
                    owner.defaultView.clearInterval(watchdog);
                    if(report.status!=='done' && !run.activeVideo?.ended) run.activeVideo?.pause();
                    owner.defaultView.removeEventListener('pagehide',onUnload);
                    if(lease.getAttribute('data-run-id')===run.id) lease.removeAttribute('data-run-id');
                    current=null;ctl.state.busy=false;
                    ctl.report(courseReportText(report),report.status==='done'?'done':report.status==='running'?'course-navigating':'error',false);
                    owner.dispatchEvent(new owner.defaultView.Event('cx-ai-course-update'));
                }
                return report;
            },
            resumeIfNeeded() {
                const previous=key?get(key,null):null;
                if(previous?.status==='running' && previous.handoff===true && previous.session===session && now()-previous.heartbeat<60000) return api.start({resume:true});
            }
        };
        // 同一课程的多个同源标签页共享浏览器互斥锁；不会锁住另一门课程。
        const startUnlocked=api.start;
        let starting=false;
        api.start=async options=>{
            if(starting || current || courseRunActive(owner))return;
            starting=true;
            try {
                const locks=owner.defaultView.navigator.locks;
                if(!scope || !locks?.request)return await startUnlocked(options);
                return await locks.request(`cx-ai-course-run:${scope}`,{ifAvailable:true},lock=>{
                    if(!lock){ctl.report('另一个页面正在运行本课程，请先停止该页面','error');return;}
                    return startUnlocked(options);
                });
            } catch(error) {ctl.report(error.message,'error');}
            finally {starting=false;}
        };
        owner.addEventListener('cx-ai-course-stop',()=>api.stop());
        owner.addEventListener('cx-ai-course-skip',()=>api.skip());
        return api;
    }
    function initCourseRunControls(doc, ctl) {
        const owner=studyOwnerDocument(doc),s=panelView.shadow;
        const skipLearned=s.getElementById('course-skip-learned'),fromCurrent=s.getElementById('course-from-current'),timeoutNext=s.getElementById('course-timeout-next'),muteVideo=s.getElementById('course-mute-video');
        const autoSubmit=s.getElementById('course-auto-submit');
        for(const [control,key,fallback] of [[autoSubmit,'cx_course_auto_submit',true],[skipLearned,'cx_course_skip_learned',true],[fromCurrent,'cx_course_from_current',false],[timeoutNext,'cx_course_timeout_next',true],[muteVideo,'cx_course_mute_video',true]]) {
            control.checked=get(key,fallback)===true;
            control.onchange=()=>set(key,control.checked);
        }
        const latestReport=()=>courseRunner?.report || (owner&&courseScoreKey(owner)?get(`cx_course_run:${courseScoreKey(owner)}`,null)?.report:null);
        const render=()=>{
            const running=courseRunActive(doc),report=latestReport();
            const lease=owner?.getElementById('cx-ai-course-lease');
            const duration=Number(lease?.getAttribute('data-video-duration'));
            const raw=lease?.getAttribute('data-video-current'), elapsed=Number(raw);
            const valid=running && lease?.getAttribute('data-phase')==='course-video' && raw!==null && Number.isFinite(duration) && duration>0 && Number.isFinite(elapsed);
            const progress=s.getElementById('video-progress');
            s.getElementById('video-progress-wrap').hidden=!valid;
            progress.max=valid?duration:1;progress.value=valid?Math.max(0,Math.min(duration,elapsed)):0;
            progress.setAttribute('aria-valuetext',valid?`${Math.floor(progress.value)} / ${Math.floor(duration)} 秒`:'无正在播放的视频');
            s.getElementById('video-progress-text').textContent=valid?`${Math.floor(progress.value/duration*100)}%`:'';
            s.getElementById('course-start').disabled=!owner||running||ctl.state.busy;
            s.getElementById('course-stop').disabled=!running;
            s.getElementById('course-skip').disabled=running ? owner?.getElementById('cx-ai-course-lease')?.getAttribute('data-can-skip')!=='true' : !courseSkipResume(owner);
            s.getElementById('course-auto-submit').disabled=running||ctl.state.busy;
            skipLearned.disabled=running||ctl.state.busy;
            fromCurrent.disabled=running||ctl.state.busy;
            timeoutNext.disabled=running||ctl.state.busy;
            muteVideo.disabled=running||ctl.state.busy;
            s.getElementById('course-run-note').textContent=owner?'自动播放视频、阅读资料、完成章节测验；遇到人脸识别或无法可靠作答时停止。':'仅课程学习页面支持；独立作业页无法刷课。';
            s.getElementById('course-report').textContent=courseReportText(report);
        };
        panelView.renderCourseRunControls=render;
        if(owner===doc) {
            courseRunner=createCourseRunner(owner,ctl);
            owner.addEventListener('cx-ai-course-start',event=>courseRunner?.start({submit:event.detail?.submit!==false,skipLearned:event.detail?.skipLearned!==false,fromCurrent:event.detail?.fromCurrent===true,continueOnTimeout:event.detail?.continueOnTimeout!==false,muteVideo:event.detail?.muteVideo!==false}));
        }
        s.getElementById('course-start').onclick=()=>owner?.dispatchEvent(new owner.defaultView.CustomEvent('cx-ai-course-start',{detail:{submit:s.getElementById('course-auto-submit').checked,skipLearned:skipLearned.checked,fromCurrent:fromCurrent.checked,continueOnTimeout:timeoutNext.checked,muteVideo:muteVideo.checked}}));
        s.getElementById('course-skip').onclick=()=>owner?.dispatchEvent(new owner.defaultView.Event('cx-ai-course-skip'));
        s.getElementById('course-stop').onclick=()=>owner?.dispatchEvent(new owner.defaultView.Event('cx-ai-course-stop'));
        s.getElementById('course-copy-report').onclick=async()=>{
            try{await navigator.clipboard.writeText(courseReportText(latestReport()));ctl.report('刷课报告已复制');}
            catch{ctl.report('无法复制，请选中报告后复制');}
        };
        const disconnect=()=>{
            owner?.removeEventListener('cx-ai-course-update',update);
            doc.removeEventListener('cx-ai-course-state',update);
        };
        const update=()=>{
            // 子题目 iframe 被替换后，旧窗口可能已经失效且没有发出 pagehide。
            // 先移除主页面回调，避免在旧 realm 中继续渲染或持有整个旧题目页。
            if(owner && owner!==doc && (!doc.defaultView?.document || !courseFrameTree(owner).documents.includes(doc))) {
                disconnect();return;
            }
            if(owner!==doc) {
                const lease=owner?.getElementById('cx-ai-course-lease');
                if(lease?.getAttribute('data-run-id')) {
                    ctl.state.message=lease.getAttribute('data-message')||'自动学习进行中';ctl.state.phase=lease.getAttribute('data-phase')||'course-running';
                } else if(latestReport()) {ctl.state.message=courseReportText(latestReport());ctl.state.phase=latestReport().status==='done'?'done':'error';}
            }
            render();renderRunState(ctl.state);
        };
        owner?.addEventListener('cx-ai-course-update',update);
        doc.addEventListener('cx-ai-course-state',update);
        doc.defaultView.addEventListener('pagehide',disconnect,{once:true});
        render();
        if(owner===doc) courseRunner?.resumeIfNeeded();
    }
