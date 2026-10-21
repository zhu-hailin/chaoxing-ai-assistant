    const COURSE_RUN_LIMITS = Object.freeze({ pollMs:500, unlockWaitMs:15000, settleMs:700, frameReadDelayMs:2000, maxFrameReadRetries:5, loadMs:30000, videoLoadMs:60000, completionMs:30000,
        stallMs:300000, resumeMs:3000, videoStartRetryMs:2000, maxResumes:8, resumeProgressSeconds:10, videoSeekToleranceSeconds:2, videoSeekStableMs:500, videoSeekTimeoutMs:60000,
        videoProgressEpsilonSeconds:0.05, videoPlayedRangeToleranceSeconds:0.25, videoReplayGraceMs:300000, videoQuizConfirmMs:30000, videoManualPauseIntentMs:2000,
        slideMs:1000, documentMs:300000, documentCheckMs:500, documentStableMs:1000, documentBottomSamples:3, documentFallbackStepMs:200, documentFallbackPasses:2, submitMs:30000, maxConsecutiveChapterFailures:3, speedReadyMs:3000, speedConfirmMs:2000 });
    let courseRunner;
    // 仅脚本闭包持有命令入口；页面事件只传递状态，不授予操作权限。
    const assistantConfirm = window.confirm.bind(window);
    const assistantEventPath = Event.prototype.composedPath;
    const assistantEventCurrentTarget = Object.getOwnPropertyDescriptor(Event.prototype,'currentTarget').get;
    const assistantEventType = Object.getOwnPropertyDescriptor(Event.prototype,'type').get;
    function trustedAssistantActivation(event, expectedControl, expectedType='click') {
        /* TRUSTED_ASSISTANT_ACTIVATION */
        try { return Boolean(expectedControl && event.isTrusted===true && assistantEventCurrentTarget.call(event)===expectedControl
            && assistantEventType.call(event)===expectedType && assistantEventPath.call(event).includes(expectedControl)); } catch { return false; }
    }
    function courseVideoPauseInput(event, video) {
        /* TRUSTED_VIDEO_PAUSE_INPUT */
        if(event?.isTrusted!==true)return false;
        const target=event.target;
        if(!target || target.closest?.('input,textarea,select,[contenteditable],.ans-videoquiz'))return false;
        const control=target.closest?.('.vjs-play-control,.vjs-big-play-button,.prism-big-play-btn,[data-video-play],[aria-label="Pause"],[aria-label="暂停"]');
        const player=video.closest('.video-js,.prism-player,[data-video-player]')||video.parentElement;
        if(target!==video && !(control && player?.contains(control)&&player.querySelectorAll('video').length===1))return false;
        return event.type!=='keydown'||[' ','Spacebar','k','K','MediaPause','MediaPlayPause'].includes(event.key);
    }
    const courseRunnerControllers = new WeakMap();
    function courseRunController(owner) { return owner ? courseRunnerControllers.get(owner) || null : null; }
    function courseLearningSettings(value={}) {
        const minutes=(raw,min,max,fallback)=>{const n=Number(raw);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;};
        return {restEnabled:value.restEnabled===true,studyMinutes:minutes(value.studyMinutes,10,180,50),restMinutes:minutes(value.restMinutes,1,60,10)};
    }
    function readCourseLearningSettings() {
        return courseLearningSettings({restEnabled:get('cx_course_rest_enabled',false),studyMinutes:get('cx_course_study_minutes',50),restMinutes:get('cx_course_rest_minutes',10)});
    }
    function courseVideoPlayedRanges(video) {
        try {
            const played=video.played,ranges=[];
            if(!played || !Number.isSafeInteger(played.length) || played.length<0 || played.length>10000)return {available:false,ranges};
            for(let i=0;i<played.length;i++) {
                const start=played.start(i),end=played.end(i);
                if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<start||i>0&&start<ranges[i-1].end)return {available:false,ranges:[]};
                ranges.push({start,end});
            }
            return {available:true,ranges};
        } catch {return {available:false,ranges:[]};}
    }
    function courseVideoPositionDecision(anchor,current,played,limits) {
        const elapsed=Math.max(0,(current.at-anchor.at)/1000),delta=current.seconds-anchor.seconds;
        const rate=value=>Number.isFinite(value)&&value>0?value:1;
        const allowedForward=elapsed*Math.max(rate(anchor.rate),rate(current.rate))+limits.videoSeekToleranceSeconds;
        const result={kind:'unready',delta,allowedForward,evidence:'none'};
        if(!Number.isFinite(anchor.seconds)||!Number.isFinite(current.seconds)||!Number.isFinite(current.at)||!Number.isFinite(anchor.at)
            ||current.seconds<0||!Number.isFinite(current.duration)||current.duration<=0||current.seconds>current.duration+limits.videoProgressEpsilonSeconds
            ||current.seeking||current.readyState<2)return result;
        if(delta < -limits.videoProgressEpsilonSeconds)return {...result,kind:'rollback',evidence:'position'};
        if(delta<=limits.videoProgressEpsilonSeconds)return {...result,kind:'continuous',evidence:'position'};
        if(played.available) {
            let covered=anchor.seconds;
            for(const range of played.ranges) {
                if(range.end<covered)continue;
                if(range.start>covered+limits.videoPlayedRangeToleranceSeconds)break;
                covered=Math.max(covered,range.end);
                if(covered>=current.seconds-limits.videoPlayedRangeToleranceSeconds)
                    return {...result,kind:delta>allowedForward?'replay-seek':'continuous',evidence:'played'};
            }
            return {...result,kind:'forward-jump',evidence:'played-gap'};
        }
        return {...result,kind:delta>allowedForward?'forward-jump':'continuous',evidence:'elapsed'};
    }
    function courseRecordChapterOutcome(protection, chapter, index) {
        if(!Number.isInteger(index)||index<=protection.lastOutcomeIndex)return protection;
        if(!['done','already','timed-out','skipped','no-tasks','manual-pending'].includes(chapter?.status))return protection;
        if(chapter.status==='timed-out')protection.consecutiveFailures++;
        else if(['done','already'].includes(chapter.status))protection.consecutiveFailures=0;
        protection.lastOutcomeIndex=index;
        return protection;
    }
    function courseRunProtection(previous, chapters, chapterIndex, limit, enabled=false) {
        const saved=previous?.protection;
        const value={enabled:previous?saved?.enabled===true:enabled===true,consecutiveFailures:0,lastOutcomeIndex:-1,triggered:false,triggeredAt:null,
            limit:Number.isInteger(limit)&&limit>0?limit:3};
        if(saved && Number.isInteger(saved.consecutiveFailures)&&saved.consecutiveFailures>=0
            && Number.isInteger(saved.lastOutcomeIndex)&&saved.lastOutcomeIndex>=-1&&saved.lastOutcomeIndex<chapters.length) {
            value.consecutiveFailures=saved.consecutiveFailures;value.lastOutcomeIndex=saved.lastOutcomeIndex;
            value.triggered=saved.triggered===true;value.triggeredAt=Number.isFinite(saved.triggeredAt)?saved.triggeredAt:null;
        } else {
            for(let i=0;i<Math.min(chapters.length,Math.max(0,chapterIndex));i++)courseRecordChapterOutcome(value,chapters[i],i);
        }
        return value;
    }
    function coursePendingChapters(report) {
        const result={failed:[],skipped:[],manual:[],waiting:[],navigation:[],unvisited:[],taskFree:[]};
        for(const chapter of report?.chapters||[]) {
            const group=['timed-out','stopped'].includes(chapter.status)?'failed':chapter.status==='skipped'?'skipped':chapter.status==='manual-pending'?'manual':chapter.status==='waiting-unlock'?'waiting':chapter.status==='navigation-unknown'?'navigation':chapter.status==='unvisited'?'unvisited':chapter.status==='no-tasks'?'taskFree':null;
            if(group)result[group].push({id:chapter.id,number:clean(chapter.number),title:clean(chapter.title).slice(0,160),
                reason:clean(chapter.reason||chapter.issues?.[0]?.reason||(group==='unvisited'?'尚未处理':group==='skipped'?'用户跳过':'')).slice(0,200),status:chapter.status});
        }
        return result;
    }
    function courseRetryCandidate(owner, previous) {
        const reject=reason=>({allowed:false,reason,queue:[],token:null});
        const scope=owner&&courseScoreKey(owner);
        if(!scope||studyOwnerDocument(owner)!==owner||!owner.querySelector('#mainid #iframe'))return reject('仅课程学习页面支持重试');
        if(courseRunActive(owner)||previous?.status==='running')return reject('当前课程仍在运行，请先停止');
        if(!previous||!['stopped','done'].includes(previous.status)||!Array.isArray(previous.queue)||!Array.isArray(previous.report?.chapters))return reject('没有可重试的运行记录');
        if(previous.scope&&previous.scope!==scope)return reject('课程或账号已变化，不能重试原队列');
        const blocker=courseBlocker(courseFrameTree(owner).documents);if(blocker)return reject(blocker);
        const entries=readCourseCatalog(owner)?.entries.filter(item=>!item.isGroup)||[];
        const original=previous.originalQueue||previous.queue;
        if(original.some(item=>!entries.some(entry=>entry.id===item.id&&entry.node?.isConnected)))return reject('原队列章节已缺失，请人工检查课程目录');
        const candidates=previous.report.chapters.filter(chapter=>['timed-out','stopped','unvisited','manual-pending','waiting-unlock','navigation-unknown'].includes(chapter.status));
        if(candidates.some(chapter=>chapter.tasks?.some(task=>(task.submissionStarted||task.videoQuizUnconfirmed)&&task.status!=='done')))return reject('存在提交结果未确认的测验，请先人工核对，不能自动重试');
        const ids=new Set(candidates.map(chapter=>chapter.id));
        const queue=previous.queue.filter(item=>ids.has(item.id)).map(({id,number,title})=>({id,number,title}));
        if(!queue.length)return reject('没有可重试的待处理章节');
        const token=JSON.stringify([scope,previous.ownerId,previous.report.startedAt,previous.report.endedAt,
            previous.report.chapters.map(chapter=>[chapter.id,chapter.status,chapter.reason,chapter.tasks?.map(task=>[task.status,task.submissionStarted===true])])]);
        return {allowed:true,reason:'',queue,token};
    }
    function courseTimeoutError(message) {
        const error=createCxError('CX-EXE-007',{module:'course',operation:'wait'},{legacyCode:'COURSE_TIMEOUT'});
        // Existing local report keeps its precise stage; safe export always uses the catalog.
        error.message=message;
        return error;
    }
    function courseFailureLimitError(limit) {
        const error=createCxError('CX-EXE-008',{module:'course',operation:'protection',count:limit},{legacyCode:'COURSE_FAILURE_LIMIT'});
        error.message=`连续 ${limit} 个章节超时，已保护性停止，请检查后重试`;
        return error;
    }
    function courseRunActive(doc = document) {
        const owner = studyOwnerDocument(doc);
        return Boolean(owner?.getElementById('cx-ai-course-lease')?.getAttribute('data-run-id'));
    }
    function courseVideoEventTrace(task) {
        const labels={pause:'暂停',playing:'开始播放',waiting:'等待播放数据',stalled:'媒体加载停滞',error:'媒体错误',ended:'播放结束',seeking:'开始定位',seeked:'定位结束'};
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
            const seek=typeof item.seeking==='boolean'?`，seeking=${item.seeking}`:'';
            const rate=Number.isFinite(item.rate)&&item.rate>0?`，播放速率=${item.rate}`:'';
            return `+${offset} 秒 ${labels[item.event]}：视频 ${position} 秒，${visibility}${focus}，readyState=${ready}，networkState=${network}，错误码=${error}${seek}${rate}`;
        }).join('\n');
    }
    function courseReportText(report) {
        if (!report) return '尚未开始自动学习';
        const pending=coursePendingChapters(report),protection=report.protection;
        const hasManualTasks=report.chapters.some(chapter=>chapter.remainingUnconfirmed===true||chapter.tasks.some(task=>task.status==='manual-pending'&&(task.type==='knowledge-graph'||task.reason?.startsWith('自动提交章节测验已关闭'))));
        const finished = report.chapters.filter(item => ['done','already'].includes(item.status)).length;
        const completedQuizzes=report.chapters.flatMap(chapter=>chapter.tasks).filter(task=>task.type==='quiz'&&task.status==='already').length;
        const taskFree = report.chapters.filter(item=>item.status==='no-tasks');
        const skipped = report.chapters.filter(item => item.status === 'skipped');
        const timedOut=report.chapters.filter(item=>item.status==='timed-out');
        const issues = report.chapters.flatMap(chapter => chapter.issues.map(issue => `${chapter.number} ${chapter.title}${issue.number ? ` · 第 ${issue.number} 题` : ''}：${issue.reason}`));
        const videoStates = report.chapters.flatMap(chapter => chapter.tasks.filter(task => task.type==='video' && (['stopped','timed-out'].includes(task.status)||task.videoQuizzes?.length) && (task.playbackState||task.videoQuizzes?.length)).map(task => {
            const state=task.playbackState || {seconds:task.startSeconds}, pause=task.lastPause || state;
            const visibility=pause.visibility==='hidden'?'后台':pause.visibility==='visible'?'可见':'可见性未知';
            const focus=pause.focused===false?'、窗口失焦':pause.focused===true?'、窗口有焦点':'';
            const position=Number.isFinite(state.seconds)?Math.floor(state.seconds):'未知';
            return `${chapter.number} ${chapter.title} · 视频 ${task.number || 1}：暂停 ${task.pauseCount || 0} 次，恢复 ${task.resumes || 0} 次；${task.lastPause?'最后暂停时':'检测时'}课程页${visibility}${focus}；检测时位置 ${position} 秒，readyState=${state.readyState ?? '未知'}，networkState=${state.networkState ?? '未知'}，错误码=${state.errorCode ?? '无'}。暂停来源尚未确认。`+courseVideoEventTrace(task)+(Array.isArray(task.videoQuizzes)?'\n视频弹题记录：\n'+task.videoQuizzes.map(courseVideoQuizReport).join('\n'):'');
        }));
        const seekStates=report.chapters.flatMap(chapter=>chapter.tasks.filter(task=>task.type==='video'&&task.seekState).map(task=>{
            const state=task.seekState,number=value=>Number.isFinite(value)?value.toFixed(2):'未知';
            const outcomes={pending:'等待定位恢复',continuous:'进度连续，已继续',rollback:'回退后重播','replay-seek':'返回已播区间',jump:'确认明显跳转，已停止','forward-jump':state.evidence==='played-gap'?'未播区间前跳，已停止':'异常前跳，已停止',timeout:'定位等待超时'};
            const evidence={position:'位置比较',played:'浏览器已播区间','played-gap':'已播区间存在缺口',elapsed:'区间不可用，按实际经过时间检查',none:'等待有效数据'};
            const direction={backward:'回退',forward:'前进',same:'位置基本不变'};
            const extra=state.evidence?`；${direction[state.direction]||'方向未知'}，${evidence[state.evidence]||'依据未知'}，回退 ${number(state.rollbackSeconds)} 秒`:'';
            return `${chapter.number} ${chapter.title} · 视频 ${task.number||1}：定位 ${task.seekCount||1} 次；起点 ${number(state.from)} 秒，检测位置 ${number(state.to)} 秒，经过 ${number(state.elapsed)} 秒，允许前进 ${number(state.allowedForward)} 秒；${outcomes[state.outcome]||'判定未知'}${extra}，seeking=${typeof state.seeking==='boolean'?state.seeking:'未知'}，readyState=${Number.isInteger(state.readyState)?state.readyState:'未知'}。`;
        }));
        const replayStates=report.chapters.flatMap(chapter=>chapter.tasks.filter(task=>task.type==='video'&&task.replayState).map(task=>{
            const state=task.replayState,number=value=>Number.isFinite(value)?value.toFixed(2):'未知';
            const outcomes={replaying:'回退后重播',advanced:'已获得新增播放进展',ended:'已重播至视频结束',timeout:'反复回退超时'};
            return `${chapter.number} ${chapter.title} · 视频 ${task.number||1}：回退 ${task.rollbackCount||0} 次；重播起点 ${number(state.startSeconds)} 秒，原最高位置 ${number(state.frontierAtStart)} 秒，当前最高位置 ${number(state.frontierSeconds)} 秒；等待 ${number(state.elapsed)} 秒，剩余 ${number(state.remaining)} 秒；${outcomes[state.outcome]||'状态未知'}。`;
        }));
        const documentStates=report.chapters.flatMap(chapter=>chapter.tasks.filter(task=>task.type==='document'&&task.documentState).map(task=>{
            const state=task.documentState;
            return `${chapter.number} ${chapter.title} · 资料 ${task.number||1}：位置 ${Math.round(state.top)}/${Math.round(Math.max(0,state.total-state.height))}，距底部 ${Math.round(state.distance*100)/100}px；图片 ${state.imageCount} 张，未加载 ${state.pendingImages} 张；到底校正 ${task.bottomCorrections||0} 次，快速遍历 ${task.fallbackPasses||0} 轮。`;
        }));
        const foregroundStates=report.chapters.flatMap(chapter=>chapter.tasks.filter(task=>task.type==='video'&&task.foregroundState?.required).map(task=>{
            const state=task.foregroundState;
            return `${chapter.number} ${chapter.title} · 视频 ${task.number||1}：本任务要求前台观看；${clean(state.evidence).slice(0,120)}；等待 ${Number.isFinite(state.waitCount)?state.waitCount:0} 次，累计 ${Number.isFinite(state.waitMs)?Math.floor(state.waitMs/1000):0} 秒；${state.waiting?'等待返回前台':'当前未等待'}。`;
        }));
        const backgroundStates=report.chapters.flatMap(chapter=>chapter.tasks.filter(task=>task.type==='video'&&task.backgroundState).map(task=>{
            const state=task.backgroundState,count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
            const stages={loading:'文档开始加载时',interactive:'文档可交互时',complete:'文档加载完成后'};
            const categories={playing:'当前播放',unknown:'暂停来源未确认，有限恢复',recovering:'尝试正常恢复',manual:'手动暂停，等待手动播放','recovery-blocked':'连续恢复无效，等待人工播放'};
            return `${chapter.number} ${chapter.title} · 视频 ${task.number||1}：旧鼠标拦截${state.installed===true?'已安装':'未安装'}，${stages[state.installedReadyState]||'安装时机未知'}；拦截 ${count(state.interceptedMouseouts)} 次，恢复入口尝试 ${count(state.recoveryAttempts)} 次；${categories[state.category]||'状态未知'}。`;
        }));
        const speedStates=report.chapters.flatMap(chapter=>chapter.tasks.filter(task=>task.type==='video'&&task.speedState).map(task=>{
            const state=task.speedState;return `${chapter.number} ${chapter.title} · 视频 ${task.number||1}：${state.status}；原生档位 ${state.rates.join('/')||'未知'}；目标 ${state.selectedRate||'无'}；实际 ${Number.isFinite(state.actualRate)?state.actualRate+'x':'未知'}；方式 ${state.method||'未操作'}；${state.evidence} / ${state.outcome}${state.reason?' / '+state.reason:''}。`;
        }));
        const locatorMetric=name=>Number.isFinite(report.locator?.[name])?Math.max(0,Math.round(report.locator[name])):0;
        return `${report.status === 'done' ? (pending.failed.length || skipped.length || pending.manual.length || pending.waiting.length || pending.navigation.length || pending.unvisited.length ? '遍历结束，仍有待处理章节' : taskFree.length ? '目录遍历结束' : '全部流程完成') : report.status === 'running' ? '自动学习进行中' : '自动学习已停止'}：${finished}/${report.chapters.length} 个章节；${report.videos} 个视频结束，${report.documents} 份资料完成，${report.quizzes} 个测验提交成功。`
            + (report.retryOf ? '\n本轮为未完成章节重试，完成计数仅统计本轮。' : '')
            + (protection ? `\n连续失败保护性停止：${protection.enabled===true?'开启':'关闭'}；连续超时 ${protection.consecutiveFailures}${protection.enabled===true?'/'+protection.limit:''}${protection.triggered?'，已保护性停止':''}。` : '')
            + (pending.waiting.length ? `\n待解锁 ${pending.waiting.length} 个章节：\n`+pending.waiting.map(chapter=>`${chapter.number} ${chapter.title}：${chapter.reason}`).join('\n') : '')
            + (pending.navigation.length ? `\n入口未确认 ${pending.navigation.length} 个章节：\n`+pending.navigation.map(chapter=>`${chapter.number} ${chapter.title}：${chapter.reason}`).join('\n') : '')
            + (pending.unvisited.length ? `\n尚未处理 ${pending.unvisited.length} 个章节：\n`+pending.unvisited.map(chapter=>`${chapter.number} ${chapter.title}${chapter.reason?'：'+chapter.reason:''}`).join('\n') : '')
            + (completedQuizzes ? `\n${completedQuizzes} 个章节测验已完成，已跳过作答。` : '')
            + (taskFree.length ? `\n${taskFree.length} 个章节无任务点，已直接继续下一节。` : '')
            + (skipped.length ? `\n用户跳过 ${skipped.length} 个章节（不计为完成）：\n` + skipped.map(chapter => `${chapter.number} ${chapter.title}`).join('\n') : '')
            + (pending.manual.length ? `\n自动跳过 ${pending.manual.length} 个含${hasManualTasks?'待人工处理任务':'无法自动答题测验'}的章节（${hasManualTasks?'':'未提交，'}不计为完成）：\n` + pending.manual.map(chapter=>`${chapter.number} ${chapter.title}：${chapter.reason}`).join('\n') : '')
            + (timedOut.length ? `\n超时跳过 ${timedOut.length} 个章节（不计为完成）：\n` + timedOut.map(chapter=>`${chapter.number} ${chapter.title}：${chapter.reason}`).join('\n') : '')
            + (report.reason ? `\n${report.reason}` : '') + (issues.length ? '\n需人工处理：\n' + issues.join('\n') : '')
            + (videoStates.length ? '\n视频状态记录：\n' + videoStates.join('\n') : '')
            + (seekStates.length ? '\n视频定位记录：\n' + seekStates.join('\n') : '')
            + (replayStates.length ? '\n视频重播记录：\n' + replayStates.join('\n') : '')
            + (documentStates.length ? '\n资料状态记录：\n' + documentStates.join('\n') : '')
            + (foregroundStates.length ? '\n前台等待记录：\n' + foregroundStates.join('\n') : '')
            + (backgroundStates.length ? '\n后台播放保护记录：\n' + backgroundStates.join('\n') : '')
            + (speedStates.length ? '\n倍速能力记录：\n' + speedStates.join('\n') : '')
            + (report.locator ? `\n任务定位：摘要请求 ${locatorMetric('requests')} 次，缓存命中 ${locatorMetric('cacheHits')} 次，耗时 ${locatorMetric('elapsedMs')}ms；章节跳转 ${locatorMetric('chapterNavigations')} 次，栏目切换 ${locatorMetric('tabNavigations')} 次，就绪快路径 ${locatorMetric('readyHits')} 次，页面核实 ${locatorMetric('fallbacks')} 次。` : '')
            + (report.pacing?.restEnabled ? `\n学习休息：累计活动 ${Math.floor((report.pacing.activeMs||0)/1000)} 秒；${report.pacing.restUntil!==null?'已保存休息截止时间':'当前未休息'}。` : '');
    }
    function coursePanelStatusMessage(state, doc = document) {
        const owner=studyOwnerDocument(doc),scope=owner&&courseScoreKey(owner);
        const report=courseRunner?.report || (scope?get(`cx_course_run:${scope}`,null)?.report:null);
        if(report && state.message===courseReportText(report)) {
            if(report.navigationBoundary)return report.reason;
            if(report.protection?.triggered)return report.reason||'连续超时，已保护性停止';
            if(report.status==='running')return `自动学习进行中${report.protection?.consecutiveFailures?`；连续超时 ${report.protection.consecutiveFailures}${report.protection.enabled===true?'/'+report.protection.limit:'，失败次数保护已关闭'}`:''}`;
            const pending=coursePendingChapters(report);
            return report.status==='done'?(pending.failed.length||pending.skipped.length||pending.manual.length||pending.waiting.length||pending.navigation.length||pending.unvisited.length?'遍历结束，仍有待处理章节':'自动学习已结束'):'自动学习已停止';
        }
        if(report?.status==='running'&&report.protection?.consecutiveFailures&&!/连续超时/.test(state.message||''))
            return `${state.message||'自动学习进行中'}；连续超时 ${report.protection.consecutiveFailures}${report.protection.enabled===true?'/'+report.protection.limit:'，失败次数保护已关闭'}`;
        return state.message || '就绪';
    }
    function courseSkipResume(owner) {
        if(!owner || courseRunActive(owner))return null;
        const scope=courseScoreKey(owner),previous=scope?get(`cx_course_run:${scope}`,null):null;
        let session;try{session=owner.defaultView.sessionStorage.getItem('cx-ai-course-session');}catch{return null;}
        const chapter=previous?.report?.chapters?.[previous.chapterIndex];
        if(previous?.protection?.triggered)return null;
        if(previous?.status!=='stopped'||previous.session!==session||chapter?.status!=='stopped')return null;
        if(chapter.tasks.some(task=>(task.submissionStarted||task.videoQuizUnconfirmed)&&task.status!=='done'))return null;
        if(courseBlocker(courseFrameTree(owner).documents))return null;
        const active=readCourseCatalog(owner)?.entries.find(item=>!item.isGroup&&item.active);
        return active?.id===chapter.id?previous:null;
    }
    function createCourseRunner(owner, ctl, options = {}) {
        const limits = { ...COURSE_RUN_LIMITS, ...options.limits };
        const now = options.now || (() => Date.now());
        const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
        let scope = courseScoreKey(owner);
        let key = scope ? `cx_course_run:${scope}` : null;
        let session;
        try {
            session = owner.defaultView.sessionStorage.getItem('cx-ai-course-session');
            if (!session) { session = crypto.randomUUID(); owner.defaultView.sessionStorage.setItem('cx-ai-course-session',session); }
        } catch { session = crypto.randomUUID(); }
        let current = null;
        const refreshScope = () => {
            if (current) return; // A running session keeps its frozen identity and account-change guard.
            scope = courseScoreKey(owner);key = scope ? `cx_course_run:${scope}` : null;
        };
        const api = { owner, get key() { refreshScope();return key; }, get busy() { return Boolean(current && !current.cancelled); },
            get autoSubmitEnabled() { return Boolean(current && !current.cancelled && current.submit === true); },
            get canSkip() { return current ? Boolean(!current.cancelled && !current.waitingUnlock && current.chapter && !current.chapter.skipped && !current.chapter.submitting) : Boolean(courseSkipResume(owner)); },
            get canRetry() { refreshScope();return !current&&!ctl.state.busy&&courseRetryCandidate(owner,key?get(key,null):null).allowed; },
            retryIncomplete(token, {submit=false} = {}) {
                if(current||ctl.state.busy)return;
                refreshScope();
                const candidate=courseRetryCandidate(owner,key?get(key,null):null);
                if(!candidate.allowed || token!==undefined&&token!==candidate.token){ctl.report(candidate.allowed?'运行记录已变化，请重新确认重试':candidate.reason,'error');return;}
                return api.start({retry:true,retryToken:candidate.token,submit:submit===true,...readCourseLearningSettings()});
            },
            get report() { refreshScope();return current?.report || (key ? get(key,null)?.report : null); },
            stop(reason = '用户停止自动学习', diagnosticError = null) {
                if (!current || current.cancelled) return;
                const cancellation=cancelledError();cancellation.message=reason;
                current.stopError=diagnosticError || cancellation;
                current.cancelled = true; current.reason = reason; current.abort.abort(); current.chapter?.abort.abort(); current.cancelWake();
                current.releaseVideoProtection?.();
                current.activeVideo?.pause();
            },
            skip() {
                if (!api.canSkip) return false;
                if(!current)return api.start({resume:true,skipCurrent:true});
                try { current.validate(); } catch(error) { api.stop(error.message,error); return false; }
                const chapter = current.chapter;
                chapter.skipped = true; chapter.abort.abort(); chapter.wake();
                current.releaseVideoProtection?.();
                current.activeVideo?.pause();
                current.notify('正在跳过本章节…','course-skipping');
                return true;
            },
            async start({ submit = false, skipLearned = true, fromCurrent = false, continueOnTimeout = true, muteVideo = true, skipUnanswerable = false, videoQuizAuto = true, speedEnabled = false, failureProtectionEnabled = get('cx_course_failure_protection_enabled',false)===true, resume = false, skipCurrent = false, retry = false, retryToken = null, restEnabled = false, studyMinutes = 50, restMinutes = 10 } = {}) {
                if (current || courseRunActive(owner)) return;
                if (studyOwnerDocument(owner) !== owner || !owner.querySelector('#mainid #iframe')) {
                    ctl.report('仅课程学习页面支持自动学习；独立作业页无法刷课','error'); return;
                }
                refreshScope();
                const identity=courseStudyContext(owner);
                if (!scope) {
                    ctl.report(['identity-conflict','parameter-conflict'].includes(identity.reason)
                        ? '课程身份冲突：课程页面与课程 iframe 的课程、班级或账号标识不一致，已停止'
                        : '已识别课程页面，但课程、班级或账号标识尚未就绪；等待所属课程 iframe 加载后再开始','error');return;
                }
                if (ctl.state.busy) return;
                const catalog = readCourseCatalog(owner);
                if (!catalog?.entries.some(item => !item.isGroup)) { ctl.report(catalog?.structure==='unrecognized'
                    ? '已找到课程目录，但尚未识别章节结构；加载后仍为空时，请提供章节项 HTML 以适配'
                    : '没有读取到可遍历的课程目录','error'); return; }
                if(catalog.structure==='legacy-h4') {
                    const active=catalog.entries.filter(item=>!item.isGroup&&item.active===true),tree=courseFrameTree(owner);
                    if(active.length!==1||!identity.loadedCardsURL||!courseContentReady(owner)||tree.inaccessible.length
                        ||!coursePageTasks(tree).some(task=>['video','document','quiz','knowledge-graph'].includes(task.type))) {
                        ctl.report('已识别旧版课程目录，但当前章节或实际任务尚未就绪；请等待课程内容加载后再开始','error');return;
                    }
                }
                const previous = get(key,null);
                let retryCandidate=null;
                if(retry) {
                    retryCandidate=courseRetryCandidate(owner,previous);
                    if(!retryCandidate.allowed||retryCandidate.token!==retryToken){ctl.report(retryCandidate.allowed?'运行记录已变化，请重新确认重试':retryCandidate.reason,'error');return;}
                    skipLearned=get('cx_course_skip_learned',true)===true;
                    skipUnanswerable=get('cx_course_skip_unanswerable',false)===true;videoQuizAuto=get('cx_course_video_quiz_auto',true)!==false;speedEnabled=get('cx_course_speed_enabled',false)===true;
                    continueOnTimeout=get('cx_course_timeout_next',true)===true;muteVideo=get('cx_course_mute_video',true)===true;fromCurrent=false;
                }
                if(resume&&previous?.protection?.triggered){ctl.report('已保护性停止，请确认重试未完成章节','error');return;}
                if(resume && (!previous || previous.session!==session))return;
                if(skipCurrent && !courseSkipResume(owner))return;
                const navigationResume=resume && previous?.handoff===true && previous.session===session;
                if (previous?.status === 'running' && !navigationResume && now()-previous.heartbeat < 15000) {
                    ctl.report('另一个页面正在运行本课程，请先停止该页面','error'); return;
                }
                const configuration = readModelConfiguration();
                const settings = configuration;
                const diagnosticTaskId=newAssistantDiagnosticTaskId();
                let runDiagnosticCode='';
                const entries=catalog.entries.filter(item=>!item.isGroup);
                let startIndex=0;
                if(!resume && fromCurrent) {
                    const active=entries.filter(item=>item.active);
                    if(active.length!==1) {ctl.report('无法确定当前章节，请刷新课程目录后重试','error');return;}
                    startIndex=entries.findIndex(item=>item.id===active[0].id);
                    if(startIndex<0) {ctl.report('当前章节不在课程目录中，请刷新后重试','error');return;}
                }
                let rangeStart=resume||retry?previous?.rangeStart||null:null;
                if(!resume&&!retry&&fromCurrent) {
                    const snapshot=courseTabSnapshot(owner),tabs=snapshot.tabs,active=tabs.filter(tab=>tab.active);
                    if(!snapshot.ready){ctl.report('栏目尚未就绪，请等待加载后再开始','error');return;}
                    if(tabs.length&&active.length!==1){ctl.report('无法确定当前栏目，请刷新页面后重试','error');return;}
                    rangeStart={chapterId:entries[startIndex].id,tabId:active[0]?.id||'current',tabIndex:Math.max(0,tabs.findIndex(tab=>tab.active)),cardId:active[0]?.node.getAttribute('cardid')||''};
                }
                // 本次起点裁剪队列；换页恢复使用原队列，不重新读取当前选中章节。
                const queue = retry ? retryCandidate.queue : resume && previous?.session === session ? previous.queue : entries.slice(startIndex).map(item => ({id:item.id,number:item.number,title:item.title}));
                if (!queue?.length) return;
                if (resume && JSON.stringify(previous.settings) !== JSON.stringify(modelConfigurationSignature(settings))) {
                    ctl.report('自动学习配置已变化，请重新开始','error'); return;
                }
                const report = resume ? previous.report : { status:'running', startedAt:now(), endedAt:null, reason:'', videos:0,documents:0,quizzes:0,
                    chapters:queue.map(item => ({...item,status:'unvisited',issues:[],tasks:[]})) };
                report.status = 'running'; report.reason = '';
                delete report.navigationBoundary;
                report.locator=report.locator||{requests:0,elapsedMs:0,excludedTabs:0,fallbacks:0,chapterNavigations:0,tabNavigations:0};
                report.locator.cacheHits??=0;report.locator.deduplicated??=0;report.locator.readyHits??=0;
                if(retry)report.retryOf={startedAt:previous.report.startedAt,endedAt:previous.report.endedAt};
                const learning=courseLearningSettings(resume?previous.learning||{}:{restEnabled,studyMinutes,restMinutes});
                const savedPacing=resume?previous.pacing:null;
                const protection=courseRunProtection(resume?previous:null,report.chapters,resume?previous.chapterIndex:0,limits.maxConsecutiveChapterFailures,failureProtectionEnabled);
                report.protection=protection;
                const run = {id:crypto.randomUUID(),queue,report,settings,protection,
                    retrying:retry||resume&&previous.retrying===true,originalQueue:retry?previous.originalQueue||previous.queue:resume?previous.originalQueue||previous.queue:queue,
                    previousReport:retry?previous.report:resume?previous.previousReport||null:null,submit:resume ? false : submit===true,
                    learning,pacing:{activeMs:Number.isFinite(savedPacing?.activeMs)?Math.max(0,savedPacing.activeMs):0,activeStartedAt:now(),restUntil:learning.restEnabled&&Number.isFinite(savedPacing?.restUntil)?savedPacing.restUntil:null},
                    skipLearned:resume ? previous.skipLearned!==false : skipLearned!==false,
                    continueOnTimeout:resume ? previous.continueOnTimeout!==false : continueOnTimeout!==false,
                    muteVideo:resume ? previous.muteVideo!==false : muteVideo!==false,
                    skipUnanswerable:resume ? previous.skipUnanswerable===true : skipUnanswerable===true,
                    videoQuizAuto:resume ? previous.videoQuizAuto===true : videoQuizAuto!==false,
                    speedEnabled:resume ? previous.speedEnabled===true : speedEnabled===true,
                    fromCurrent:resume ? previous.fromCurrent===true : fromCurrent===true,startChapterId:resume ? previous.startChapterId||queue[0].id : queue[0].id,
                    rangeStart,probeBlocked:(previous?.report?.chapters||[]).some(chapter=>chapter.tasks?.some(task=>(task.submissionStarted||task.videoQuizUnconfirmed)&&task.status!=='done')),
                    chapterIndex:resume ? previous.chapterIndex : 0,tabIndex:resume ? previous.tabIndex : 0,tabProgress:resume?previous.tabProgress||null:null,
                    cancelled:false,abort:new AbortController(),expected:null,navigating:false,lastSaved:0};
                run.cancelWait = new Promise(resolve => { run.cancelWake = resolve; });
                if(skipCurrent) {
                    const chapter=report.chapters[run.chapterIndex];chapter.status='skipped';chapter.reason='用户跳过本章节';
                    for(const task of chapter.tasks.filter(task=>task.status==='stopped')) {task.status='skipped';task.reason=chapter.reason;}
                    courseRecordChapterOutcome(run.protection,chapter,run.chapterIndex);
                    run.chapterIndex++;run.tabIndex=0;
                }
                current = run;
                let lease = owner.getElementById('cx-ai-course-lease');
                if (!lease) { lease = owner.createElement('span'); lease.id = 'cx-ai-course-lease'; lease.hidden = true; owner.body.append(lease); }
                lease.setAttribute('data-run-id',run.id);
                const pausePacing=()=>{
                    if(run.pacing.activeStartedAt!==null)run.pacing.activeMs+=Math.max(0,now()-run.pacing.activeStartedAt);
                    run.pacing.activeStartedAt=null;
                };
                const resumePacing=()=>{if(!run.cancelled&&run.pacing.restUntil===null&&run.pacing.activeStartedAt===null)run.pacing.activeStartedAt=now();};
                if(run.pacing.restUntil!==null)pausePacing();
                const save = () => {
                    if(run.claimed && get(key,null)?.ownerId!==run.id)throw new Error('运行锁已失效');
                    if(run.pacing.activeStartedAt!==null){pausePacing();resumePacing();}
                    report.pacing={...run.pacing,restEnabled:run.learning.restEnabled};
                    set(key,{status:report.status,session,ownerId:run.id,handoff:run.handoff===true,heartbeat:now(),settings:modelConfigurationSignature(settings),submit:run.submit,skipLearned:run.skipLearned,fromCurrent:run.fromCurrent,startChapterId:run.startChapterId,continueOnTimeout:run.continueOnTimeout,muteVideo:run.muteVideo,skipUnanswerable:run.skipUnanswerable,videoQuizAuto:run.videoQuizAuto,speedEnabled:run.speedEnabled,
                        scope,retrying:run.retrying,protection:{...run.protection},originalQueue:run.originalQueue,previousReport:run.previousReport,
                        learning:run.learning,pacing:{...run.pacing},rangeStart:run.rangeStart,queue,chapterIndex:run.chapterIndex,tabIndex:run.tabIndex,tabProgress:run.tabProgress,report});
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
                    if (run.cancelled) throw run.stopError || cancelledError();
                    if (owner.getElementById('cx-ai-course-lease')?.getAttribute('data-run-id') !== run.id) throw new Error('运行锁已失效');
                    if (run.claimed && get(key,null)?.ownerId !== run.id) throw new Error('运行锁已失效');
                    if (courseScoreKey(owner) !== scope) throw new Error('课程或账号已变化');
                    const tree = courseFrameTree(owner), blocker = courseBlocker(tree.documents, run.videoQuizAuto ? courseVideoQuizCandidate(run.activeVideo || (tree.documents.flatMap(doc=>[...doc.querySelectorAll('video')]).filter(courseElementVisible).length===1 ? tree.documents.flatMap(doc=>[...doc.querySelectorAll('video')]).filter(courseElementVisible)[0] : null)) : null);
                    if (blocker) throw new Error(blocker);
                    // 提交跳转时当前测验及父 iframe 可短暂不可读；仅在有界提交等待中容许该父链。
                    // 读取等待只暂缓 iframe 不可读；用户换章/换标签、验证码和运行锁仍立即检查。
                    if (!run.navigating && !run.frameLoading && !run.locating && tree.inaccessible.some(frame => !run.chapter?.submitting || !run.chapter.submissionFrames?.has(frame)))
                        throw Object.assign(new Error('任务 iframe 跨域或尚未加载，无法确认控件；请人工检查'),{code:'COURSE_FRAME_UNAVAILABLE',cxCode:'CX-MAT-004'});
                    if (run.expected && !run.navigating) {
                        const active = readCourseCatalog(owner)?.entries.find(item => !item.isGroup && item.active);
                        if (active?.id !== run.expected) throw new Error('用户切换了章节，已停止，避免操作新题目');
                        if (run.expectedTab && courseTabSnapshot(owner).activeId !== run.expectedTab) throw new Error('当前栏目已变化或无法唯一确认，已停止');
                    }
                };
                const skippedError=()=>Object.assign(new Error('用户跳过本章节'),{code:'CHAPTER_SKIPPED'});
                const navigationContext=(id,catalog=readCourseCatalog(owner))=>{
                    const entries=catalog?.entries.filter(item=>!item.isGroup)||[],index=entries.findIndex(item=>item.id===id);
                    const entry=entries[index],previous=entries[index-1];
                    const previousRecord=report.chapters.find(item=>item.id===previous?.id)||run.previousReport?.chapters?.find(item=>item.id===previous?.id);
                    return {entry,previous,previousRecord};
                };
                const recordNavigationBoundary=boundary=>{
                    const {entry,previous}=navigationContext(boundary.id),locked=boundary.status==='sequence-locked';
                    const label=item=>item?`${item.number} ${item.title}`.trim():'';
                    const reason=locked?`后续章节尚未解锁。请先完成${previous?' '+label(previous):'前置章节'}的剩余任务，完成后可重试。`
                        :`章节 ${label(entry)||boundary.id} 的原生入口尚未确认，已停止，请检查课程目录后重试。`;
                    report.navigationBoundary={...boundary,number:entry?.number||'',title:entry?.title||'',previousId:previous?.id||null,
                        previousNumber:previous?.number||'',previousTitle:previous?.title||''};
                    report.reason=reason;
                    const index=queue.findIndex(item=>item.id===boundary.id),record=report.chapters[index];
                    if(record&&['unvisited','running','waiting-unlock','navigation-unknown'].includes(record.status)) {
                        record.status=locked?'waiting-unlock':'navigation-unknown';record.reason=reason;
                    }
                    if(index>=0)for(const later of report.chapters.slice(index+1).filter(item=>item.status==='unvisited'))
                        later.reason=`前方章节 ${label(entry)||boundary.id} ${locked?'尚未解锁':'入口未确认'}，本轮未访问`;
                };
                const unlockStarted=new Map();
                const awaitChapterAccess=async chapter=>{
                    let catalog=readCourseCatalog(owner),access=courseChapterAccess(owner,chapter,catalog);
                    if(access.allowed)return access.entry;
                    const {previous,previousRecord}=navigationContext(chapter.id,catalog);
                    const active=catalog?.entries.filter(item=>!item.isGroup&&item.active)||[];
                    const confirmed=previous&&(previous.completed||previous.pending===0)&&!(previous.pending>0)
                        && !['timed-out','skipped','stopped','manual-pending'].includes(previousRecord?.status);
                    if(access.status!=='sequence-locked'||!confirmed||active.length!==1||!courseChapterAccess(owner,active[0],catalog).current)
                        return courseRequireChapterAccess(owner,chapter,catalog);
                    if(!unlockStarted.has(chapter.id))unlockStarted.set(chapter.id,now());
                    const started=unlockStarted.get(chapter.id),expected=run.expected,expectedTab=run.expectedTab,context=run.chapter;
                    const record=report.chapters.find(item=>item.id===chapter.id),oldStatus=record?.status,oldReason=record?.reason;
                    if(record&&['unvisited','waiting-unlock','navigation-unknown'].includes(record.status)) {
                        record.status='waiting-unlock';record.reason='前置章节已完成，正在等待原生入口解锁';
                    }
                    run.expected=active[0].id;run.expectedTab=courseTabSnapshot(owner).activeId||null;
                    run.waitingUnlock=true;pausePacing();
                    try {
                        emitRun(`前置章节已完成，正在检测 ${chapter.number||''} 是否解锁…`,'course-waiting-unlock');
                        while(true) {
                            guardRun();if(context&&(context!==run.chapter||context.skipped))throw skippedError();
                            catalog=readCourseCatalog(owner);access=courseChapterAccess(owner,chapter,catalog);
                            if(access.allowed) {
                                if(record?.status==='waiting-unlock'){record.status=oldStatus==='waiting-unlock'||oldStatus==='navigation-unknown'?'unvisited':oldStatus;record.reason=oldReason||'';}
                                return access.entry;
                            }
                            if(access.status!=='sequence-locked'||now()-started>=limits.unlockWaitMs)return courseRequireChapterAccess(owner,chapter,catalog);
                            await Promise.race([sleep(Math.min(limits.pollMs,limits.unlockWaitMs-(now()-started))),run.cancelWait,...(context?[context.wait]:[])]);
                        }
                    } finally {
                        run.waitingUnlock=false;run.expected=expected;run.expectedTab=expectedTab;resumePacing();
                        lease.setAttribute('data-can-skip',String(api.canSkip));
                    }
                };
                const waitForFrameReady = async (settle = false, target = null) => {
                    // 仅在明确等待的读取窗口暂缓不可读 iframe；窗口内不执行任务操作。
                    const context=run.chapter;
                    run.frameLoading=true;run.frameReadRetries=0;
                    const check=()=>{
                        guardRun();
                        if(context && (context!==run.chapter || context.skipped))throw skippedError();
                    };
                    const delay=async()=>{
                        check();
                        await Promise.race([sleep(limits.frameReadDelayMs),run.cancelWait,...(context?[context.wait]:[])]);
                        check();
                    };
                    try {
                        check();
                        if(settle){if(courseTaskTargetReady(owner,target))report.locator.readyHits++;else await delay();}
                        while(!courseContentReady(owner)) {
                            if(run.frameReadRetries>=limits.maxFrameReadRetries)
                                throw Object.assign(new Error(`任务 iframe 跨域或尚未加载，无法确认控件；等待后重试 ${limits.maxFrameReadRetries} 次仍不可读，请人工检查`),{code:'COURSE_FRAME_UNAVAILABLE'});
                            run.frameReadRetries++;
                            emitRun(`正在等待课程控件加载…重试 ${run.frameReadRetries}/${limits.maxFrameReadRetries}`,'course-loading');
                            await delay();
                        }
                        check();run.frameReadRetries=0;
                    } finally {run.frameLoading=false;}
                };

                const waitForRest=async()=>{
                    pausePacing();run.resting=true;
                    if(run.pacing.restUntil===null)run.pacing.restUntil=now()+run.learning.restMinutes*60000;
                    save();
                    try {
                        while(now()<run.pacing.restUntil){
                            guardRun();const left=Math.max(0,run.pacing.restUntil-now());
                            emitRun(`章节已结束，休息中，剩余 ${Math.ceil(left/1000)} 秒`,'course-rest');
                            await Promise.race([sleep(Math.min(limits.pollMs,left)),run.cancelWait]);guardRun();
                        }
                        guardRun();run.pacing.activeMs=0;run.pacing.restUntil=null;
                    } finally {run.resting=false;resumePacing();save();}
                };
                const rememberExcluded=(chapter,items)=>{
                    for(const item of items||[]) {
                        report.locator.excludedTabs++;
                        item.tasks.forEach((summary,index)=>{
                            const decision=item.decisions[index],manual=['quiz-disabled','knowledge-graph'].includes(decision.reason);
                            chapter.tasks.push({tab:item.tab.id,type:summary.type,status:manual?'manual-pending':decision.reason==='already'?'already':'not-required',
                                reason:manual?decision.reason==='quiz-disabled'?'自动提交章节测验已关闭，测验已跳过且未提交':'知识图谱已自动跳过，未计为完成':'任务摘要已核实',located:true});
                        });
                    }
                };
                const locateAhead=async(entry,context)=>{
                    const boundary=run.rangeStart?.chapterId===entry.id?run.rangeStart:null;
                    const locationBefore=readCourseCatalog(owner)?.entries.find(item=>item.active)?.id,tabBefore=courseTabs(owner).find(tab=>tab.active)?.id;
                    const catalogBefore=JSON.stringify(readCourseCatalog(owner)?.entries.filter(item=>!item.isGroup).map(item=>item.id));
                    const check=()=>{
                        guardRun();if(context!==run.chapter||context.skipped)throw skippedError();
                        const catalog=readCourseCatalog(owner);
                        if(catalog?.entries.find(item=>item.active)?.id!==locationBefore||courseTabs(owner).find(tab=>tab.active)?.id!==tabBefore
                            ||JSON.stringify(catalog?.entries.filter(item=>!item.isGroup).map(item=>item.id))!==catalogBefore)throw new Error('定位期间章节或栏目发生变化，请重新开始');
                    };
                    run.probeCheck=check;run.locating=true;pausePacing();const started=now();
                    try {
                        emitRun('正在定位任务…','course-locating');check();
                        const catalog=readCourseCatalog(owner),range=queue.slice(run.chapterIndex).filter(item=>!resume||!['done','no-tasks','already','skipped','timed-out','manual-pending'].includes(report.chapters.find(ch=>ch.id===item.id)?.status))
                            .map(item=>{const found=catalog.entries.find(ch=>ch.id===item.id&&!ch.isGroup);if(!found?.node?.isConnected)throw new Error('课程目录发生变化或章节不存在');return found;});
                        const location=run.probeBlocked?{entry,probe:{known:false,reason:'submission-unconfirmed'}}:await findNextCourseTask(range,{owner,submit:run.submit,skipLearned:run.skipLearned,retrying:run.retrying,
                            startChapterId:entry.id,startTabId:boundary?.tabId==='current'?null:boundary?.tabId,startCardId:boundary?.cardId,
                            startTabIndex:Math.max(run.tabIndex,boundary?.tabIndex||0),check:()=>run.probeCheck(),now,timeoutMs:limits.loadMs,
                            onRequest:()=>report.locator.requests++,onCacheHit:()=>report.locator.cacheHits++,onDeduplicated:()=>report.locator.deduplicated++},context.abort.signal);
                        check();if(location.probe?.reason==='start-tab-missing')throw new Error('本次起点栏目发生变化，请重新开始');
                        return location;
                    }finally{report.locator.elapsedMs+=Math.max(0,now()-started);resumePacing();}
                };
                const processChapter = async (chapter,entry,location) => {
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
                        const value = await Promise.race([promise,context.wait.then(() => {throw skippedError();}),run.cancelWait.then(() => {throw run.stopError || cancelledError();})]); guard(); return value;
                    };
                    const taskDone = async node => {
                        if (courseTaskComplete(node) === false) await until(() => courseTaskComplete(node) === true,limits.completionMs,'播放/阅读结束，但平台未确认任务完成');
                    };
                    const playVideo = async (video, task) => {
                        let contextCapturedAt=-Infinity;
                        run.activeVideo=video;
                        if ((run.skipLearned||run.retrying) && courseTaskComplete(video) === true) {task.status='already';return;}
                        video.muted=run.muteVideo;
                        task.startSeconds=Number(video.currentTime);task.resumes=0;task.unstableResumes=0;task.pauseCount=0;task.playbackEvents=[];task.startedAt=now();task.seekCount=0;task.rollbackCount=0;
                        let wakeMedia=null,pendingSeek=null,fatalError=null,replay=null,requiredReplay=null;
                        let excludedWaitMs=0,waitingStartedAt=null,foregroundWaitingStartedAt=null,manualWaitingStartedAt=null,quizWaitingStartedAt=null;
                        let foregroundPausePending=false,policyPauseExpected=false,playingEventCount=0;
                        const pauseControl={manualIntentUntil:0,manualPaused:false,lastAttemptAt:-Infinity,recoveryBlocked:false};
                        let playRequestPending=false;
                        const speedAttempts=new WeakMap();
                        let speedGeneration=0;
                        const suspendSpeed=()=>{
                            courseReleaseVideoSpeed(video,speedAttempts,true);
                            const state=speedAttempts.get(video)?.state;if(state)task.speedState={...state};
                        };
                        task.speedState={status:'unknown',rates:[],evidence:'not-checked',selectedRate:null,outcome:!run.speedEnabled?'switch-off':settings.videoInfoEnabled?'recognition-enabled':'unchanged'};
                        const syncVideoWaitBudget=()=>{
                            const waiting=foregroundWaitingStartedAt!==null||manualWaitingStartedAt!==null||quizWaitingStartedAt!==null;
                            if(waiting&&waitingStartedAt===null)waitingStartedAt=now();
                            else if(!waiting&&waitingStartedAt!==null){excludedWaitMs+=Math.max(0,now()-waitingStartedAt);waitingStartedAt=null;}
                        };
                        const videoBudgetNow=()=>{const at=now();return at-excludedWaitMs-(waitingStartedAt===null?0:Math.max(0,at-waitingStartedAt));};
                        task.pauseState={waiting:false,waitCount:0,waitMs:0,reason:null};
                        task.backgroundState={installed:Boolean(backgroundPlaybackGuard),installedAt:backgroundPlaybackGuard?.installedAt??null,
                            installedReadyState:backgroundPlaybackGuard?.installedReadyState??null,interceptedMouseouts:0,recoveryAttempts:0,category:'playing',reason:null};
                        task.foregroundState={required:false,evidence:null,waitCount:0,waitMs:0,waiting:false};
                        const playbackRate=()=>{const rate=Number(video.playbackRate);return Number.isFinite(rate)&&rate>0?rate:1;};
                        // 被动记录公开媒体事件；不修改播放器回调、页面可见性或平台上报。
                        const snapshot=event=>({event,at:now(),budgetAt:videoBudgetNow(),seconds:Number(video.currentTime),duration:Number(video.duration),paused:video.paused,
                            readyState:video.readyState,networkState:video.networkState,seeking:Boolean(video.seeking),rate:playbackRate(),
                            visibility:owner.visibilityState || 'unknown',focused:typeof owner.hasFocus==='function'?owner.hasFocus():null,errorCode:video.error?.code ?? null});
                        let trustedSample=snapshot('initial'),lastMotionAt=videoBudgetNow(),resumeProgress=0,frontierSeconds=task.startSeconds;
                        const replayDeadline=at=>replay.deadline+(replay.requiredPauseAt===undefined?0:Math.max(0,at-replay.requiredPauseAt));
                        const finishRequiredReplay=at=>{
                            if(replay?.requiredPauseAt!==undefined){
                                const excluded=Math.max(0,at-replay.requiredPauseAt);replay.startedBudgetAt+=excluded;replay.deadline+=excluded;delete replay.requiredPauseAt;
                            }
                            requiredReplay=null;
                        };
                        const startRequiredReplay=(grant,current)=>{
                            finishRequiredReplay(current.budgetAt);
                            const distance=Math.max(0,grant.from-current.seconds),rate=Math.min(pendingSeek?.anchor.rate||current.rate,current.rate);
                            requiredReplay={record:grant.record,attempt:grant.attempt,from:grant.from,startedBudgetAt:current.budgetAt,distance,lowestRate:rate,
                                deadline:current.budgetAt+(distance+limits.resumeProgressSeconds)/rate*1000+limits.videoReplayGraceMs};
                            if(replay)replay.requiredPauseAt=current.budgetAt;
                            grant.record.rewatch={attempt:grant.attempt,from:grant.from,to:current.seconds,distance,deadline:requiredReplay.deadline};
                        };
                        const recordReplay=(current,outcome='replaying')=>{
                            if(!replay)return;
                            task.replayState={startedAt:replay.startedAt,startSeconds:replay.startSeconds,frontierAtStart:replay.frontierAtStart,
                                frontierSeconds,deadline:current.at+Math.max(0,replayDeadline(current.budgetAt)-current.budgetAt),elapsed:Math.max(0,(current.at-replay.startedAt)/1000),remaining:Math.max(0,(replayDeadline(current.budgetAt)-current.budgetAt)/1000),outcome};
                        };
                        const recordSeek=(current,outcome,decision)=>{
                            const anchor=pendingSeek.anchor;
                            task.seekState={from:anchor.seconds,to:current.seconds,elapsed:Math.max(0,(current.at-anchor.at)/1000),
                                allowedForward:decision.allowedForward,delta:decision.delta,rollbackSeconds:Math.max(0,-decision.delta),
                                direction:decision.delta < -limits.videoProgressEpsilonSeconds?'backward':decision.delta>limits.videoProgressEpsilonSeconds?'forward':'same',
                                evidence:decision.evidence,outcome,seeking:current.seeking,readyState:current.readyState};
                        };
                        const seekTimeout=current=>{
                            recordSeek(current,'timeout',courseVideoPositionDecision(pendingSeek.anchor,current,courseVideoPlayedRanges(video),limits));
                            fatalError ||= courseTimeoutError('视频定位长时间未恢复，请检查播放器或网络');
                        };
                        const beginSeek=current=>{
                            if(!pendingSeek){pendingSeek={startedAt:current.at,startedBudgetAt:current.budgetAt,anchor:{...trustedSample},stableSince:null,finalSettleDeadline:null};task.seekCount++;}
                            else if(pendingSeek.finalSettleDeadline!==null)seekTimeout(current);
                            // 重复定位只重置稳定窗口，不延长起点或截止时间。
                            pendingSeek.stableSince=null;
                        };
                        const commitSample=(current,natural)=>{
                            const delta=current.seconds-trustedSample.seconds;
                            if(replay&&!current.paused){
                                replay.lowestRate=Math.min(replay.lowestRate,current.rate);
                                replay.deadline=replay.startedBudgetAt+(replay.initialDistance+limits.resumeProgressSeconds)/replay.lowestRate*1000+limits.videoReplayGraceMs;
                            }
                            if(requiredReplay&&!current.paused){
                                requiredReplay.lowestRate=Math.min(requiredReplay.lowestRate,current.rate);
                                requiredReplay.deadline=requiredReplay.startedBudgetAt+(requiredReplay.distance+limits.resumeProgressSeconds)/requiredReplay.lowestRate*1000+limits.videoReplayGraceMs;
                                requiredReplay.record.rewatch.deadline=requiredReplay.deadline;
                            }
                            if(natural&&delta>limits.videoProgressEpsilonSeconds&&!(trustedSample.paused&&current.paused)){
                                lastMotionAt=current.budgetAt;resumeProgress+=delta;
                                if(resumeProgress>=limits.resumeProgressSeconds){task.unstableResumes=0;resumeProgress=0;pauseControl.recoveryBlocked=false;}
                                frontierSeconds=Math.max(frontierSeconds,current.seconds);
                                if(replay){
                                    if(frontierSeconds>=replay.frontierAtStart+limits.resumeProgressSeconds){recordReplay(current,'advanced');replay=null;}
                                }
                            }
                            trustedSample=current;
                            task.progressState={lastMotionAt,resumeProgressSeconds:resumeProgress,frontierSeconds};
                            recordReplay(current);
                        };
                        // 所有媒体事件和轮询先校验位置再提交采样。回调仅登记，主循环统一判定/抛错。
                        const observe=(current,canFinalize=false)=>{
                            if(fatalError || foregroundWaitingStartedAt!==null)return;
                            const played=courseVideoPlayedRanges(video);
                            const decision=courseVideoPositionDecision(pendingSeek?.anchor||trustedSample,current,played,limits);
                            if(current.event==='seeking'||current.seeking)beginSeek(current);
                            else if(!pendingSeek&&(current.event==='seeked'||decision.kind==='rollback'||decision.kind==='replay-seek'||decision.kind==='forward-jump'||
                                decision.kind==='unready'&&(!Number.isFinite(current.seconds)||Math.abs(decision.delta)>limits.videoProgressEpsilonSeconds||current.event==='ended')))beginSeek(current);
                            if(fatalError)return;
                            // 普通缓冲且位置未变不属于定位，沿用原停滞等待。
                            if(!pendingSeek&&decision.kind==='unready')return;
                            if(!pendingSeek){commitSample(current,true);return;}
                            const check=courseVideoPositionDecision(pendingSeek.anchor,current,played,limits);
                            recordSeek(current,'pending',check);
                            const expired=current.budgetAt-pendingSeek.startedBudgetAt>=limits.videoSeekTimeoutMs;
                            if(check.kind==='unready'){
                                pendingSeek.stableSince=null;
                                if(expired||pendingSeek.finalSettleDeadline!==null)seekTimeout(current);
                                return;
                            }
                            if(pendingSeek.stableSince===null)pendingSeek.stableSince=current.budgetAt;
                            // 已恢复的状态先复查；晚唤醒最多获得一次最终稳定窗口。
                            if(expired&&pendingSeek.finalSettleDeadline===null)pendingSeek.finalSettleDeadline=current.budgetAt+limits.videoSeekStableMs;
                            if(!canFinalize)return;
                            if(current.budgetAt-pendingSeek.stableSince<limits.videoSeekStableMs){
                                if(pendingSeek.finalSettleDeadline!==null&&current.budgetAt>=pendingSeek.finalSettleDeadline)seekTimeout(current);
                                return;
                            }
                            if(check.kind==='forward-jump'){
                                recordSeek(current,'forward-jump',check);
                                fatalError=new Error(`检测到视频进度跳转（${Number.isFinite(pendingSeek.anchor.seconds)?pendingSeek.anchor.seconds.toFixed(2):'未知'} → ${current.seconds.toFixed(2)} 秒），${check.evidence==='played-gap'?'存在未播区间，':''}无法确认完整播放`);
                                return;
                            }
                            if(check.kind==='rollback'){
                                task.rollbackCount++;
                                if(rewatchGrant){
                                    startRequiredReplay(rewatchGrant,current);
                                    rewatchGrant=null;
                                }
                                if(!replay&&!requiredReplay){
                                    const lowestRate=Math.min(pendingSeek.anchor.rate,current.rate),initialDistance=Math.max(0,frontierSeconds-current.seconds);
                                    replay={startedAt:current.at,startedBudgetAt:current.budgetAt,startSeconds:current.seconds,frontierAtStart:frontierSeconds,initialDistance,lowestRate,
                                        deadline:current.budgetAt+(initialDistance+limits.resumeProgressSeconds)/lowestRate*1000+limits.videoReplayGraceMs};
                                }
                            }
                            recordSeek(current,check.kind,check);pendingSeek=null;
                            // 定位位移不计播放进展，不清零失败计时或恢复预算。
                            commitSample(current,false);
                        };
                        const materialRecord=settings.videoInfoEnabled?chapterContextStore(owner):null;
                        const videoInfo=createCourseVideoInfo(settings,{signal:context.abort.signal,now,guard:()=>{
                            guard();
                            if(!video.isConnected || !courseFrameTree(owner).documents.includes(video.ownerDocument))throw new Error('视频页面已切换');
                        },
                            onItems:items=>{guard();if(materialRecord)mergeCourseContext(materialRecord.store,materialRecord.identity.id,items);},
                            onStatus:message=>{task.infoStatus=String(message).slice(0,240);}});
                        const collectVideoInfo=(forceText=false)=>{
                            if(!settings.videoInfoEnabled||quizWaitingStartedAt!==null||courseVideoQuizCandidate(video))return;
                            try {
                                videoInfo.observe(video);
                                if(forceText || now()-contextCapturedAt>=5000){captureCurrentCourseContext(owner,{video,expectedIdentity:materialRecord?.identity.id});contextCapturedAt=now();}
                            } catch {task.infoStatus='当前课程资料无法读取，正常播放继续';}
                        };
                        const onMediaEvent=event=>{
                            if(context.skipped || run.cancelled || event.type==='pause' && video.ended)return;
                            if(['pause','seeking','loadstart','emptied'].includes(event.type))suspendSpeed();
                            if(['loadstart','emptied'].includes(event.type))speedGeneration++;
                            const state=snapshot(event.type);observe(state);
                            if(state.paused&&!policyPauseExpected&&pauseControl.manualIntentUntil>0&&state.at<=pauseControl.manualIntentUntil)pauseControl.manualPaused=true;
                            if(event.type==='playing'&&foregroundWaitingStartedAt!==null&&!video.paused){foregroundPausePending=true;policyPauseExpected=true;video.pause();}
                            collectVideoInfo();
                            // timeupdate 只维护可信采样，不占用最近 12 条关键事件日志。
                            if(event.type==='timeupdate'){wakeMedia?.();return;}
                            task.playbackState=state;
                            if(event.type==='pause'){
                                task.pauseCount++;task.lastPause=state;
                                if(!policyPauseExpected&&pauseControl.manualIntentUntil>0&&state.at<=pauseControl.manualIntentUntil)pauseControl.manualPaused=true;
                                policyPauseExpected=false;
                            }
                            if(event.type==='playing'&&!video.paused){foregroundPausePending=false;playingEventCount++;pauseControl.manualPaused=false;pauseControl.manualIntentUntil=0;}
                            task.playbackEvents.push(state);if(task.playbackEvents.length>12)task.playbackEvents.shift();
                            wakeMedia?.();
                        };
                        // 媒体事件唤醒当前轮询；避免暂停后只能等后台定时器恢复调度。
                        const waitForMedia=async()=>{
                            let wake;const mediaEvent=new Promise(resolve=>{wake=resolve;wakeMedia=resolve;});
                            try {await race(Promise.race([wait(limits.pollMs),mediaEvent]));}
                            finally {if(wakeMedia===wake)wakeMedia=null;}
                        };
                        const popupKey=`cx_video_quiz:${scope}:${entry.id}:${run.expectedTab || 'current'}:${task.number || 1}`;
                        task.videoQuizzes=get(popupKey,[]);
                        if(!Array.isArray(task.videoQuizzes))task.videoQuizzes=[];
                        let rewatchGrant=null;
                        const quizHandler=createCourseVideoQuizHandler(video,task.videoQuizzes,{
                            settings:{...settings,diagnosticTaskId},signal:context.abort.signal,now,confirmMs:limits.videoQuizConfirmMs,
                            guard:()=>{guard();if(!video.isConnected||!courseFrameTree(owner).documents.includes(video.ownerDocument))throw new Error('视频节点或页面已替换，已停止');},
                            wake:()=>wakeMedia?.(),wait:waitForMedia,playingCount:()=>playingEventCount,
                            status:message=>emit(message,'course-video-quiz'),
                            save:()=>{set(popupKey,task.videoQuizzes);save();},
                            font:ensureFontDecoded,solve:(snapshot,config,status)=>solveQuestionBatches(snapshot,config,status,{retryTransient:true}),
                            prefill:prefillChecked,submitting:value=>{context.submitting=value;task.videoQuizUnconfirmed=value;},
                            waiting:value=>{
                                if(value)suspendSpeed();
                                if(value&&quizWaitingStartedAt===null){quizWaitingStartedAt=now();syncVideoWaitBudget();pausePacing();}
                                if(!value&&quizWaitingStartedAt!==null){quizWaitingStartedAt=null;syncVideoWaitBudget();if(foregroundWaitingStartedAt===null&&manualWaitingStartedAt===null)resumePacing();}
                            },
                            rewatch:record=>{
                                const history=record.history.at(-1);if(!history?.wrong||history.rewatchGranted)return;
                                const from=Number.isFinite(history.beforeSeconds)?history.beforeSeconds:pendingSeek?.anchor.seconds??trustedSample.seconds;
                                history.rewatchGranted=true;rewatchGrant={record,attempt:record.attempts,from,issuedAt:videoBudgetNow()};
                                // 原生回退事件可能先于结果 DOM 到达；确认判错后只给该轮一次额度。
                                if(!pendingSeek&&Number.isFinite(video.currentTime)&&video.currentTime<=from&&!video.seeking&&video.readyState>=2){
                                    startRequiredReplay(rewatchGrant,snapshot('rewatch'));rewatchGrant=null;
                                }
                            }
                        });
                        const handleVideoQuiz=async()=>{
                            if(!run.videoQuizAuto)return false;
                            const handled=await quizHandler.handle();
                            if(requiredReplay?.record.phase==='passed')finishRequiredReplay(videoBudgetNow());
                            return handled;
                        };
                        const enterForegroundWait=()=>{
                            const policy=courseVideoForegroundPolicy(video);
                            if(policy.required){task.foregroundState.required=true;task.foregroundState.evidence=policy.evidence;}
                            const state=courseOwnerForegroundState(owner);
                            if(!task.foregroundState.required || state.visible&&state.focused)return false;
                            if(foregroundWaitingStartedAt===null){
                                suspendSpeed();foregroundWaitingStartedAt=now();task.foregroundState.waitCount++;task.foregroundState.waiting=true;
                                syncVideoWaitBudget();pausePacing();
                            }
                            if(!video.paused&&!video.ended){foregroundPausePending=true;policyPauseExpected=true;video.pause();}
                            return true;
                        };
                        const onForegroundChange=()=>{if(!run.cancelled&&!context.skipped){enterForegroundWait();wakeMedia?.();}};
                        const finishForegroundWait=()=>{
                            if(foregroundWaitingStartedAt===null)return;
                            const elapsed=Math.max(0,now()-foregroundWaitingStartedAt);
                            task.foregroundState.waitMs+=elapsed;task.foregroundState.waiting=false;foregroundWaitingStartedAt=null;syncVideoWaitBudget();
                            if(pendingSeek)pendingSeek.stableSince=null;
                            if(manualWaitingStartedAt===null&&quizWaitingStartedAt===null)resumePacing();
                        };
                        const waitForVideoForeground=async()=>{
                            await handleVideoQuiz();
                            try {
                                while(enterForegroundWait()){
                                    await handleVideoQuiz();guard();
                                    if(!video.isConnected || !courseFrameTree(owner).documents.includes(video.ownerDocument))throw new Error('视频节点或页面已替换，已停止');
                                    emit('本任务要求前台观看，等待返回课程页','course-foreground');
                                    await waitForMedia();
                                }
                            } finally {finishForegroundWait();}
                        };
                        const waitForManualPlayback=async()=>{
                            suspendSpeed();
                            if(manualWaitingStartedAt===null){
                                manualWaitingStartedAt=now();task.pauseState.waitCount++;task.pauseState.waiting=true;
                                task.pauseState.reason=pauseControl.recoveryBlocked?'连续恢复无效，请返回课程页手动播放':'已手动暂停，请手动播放后继续';
                                task.backgroundState.category=pauseControl.recoveryBlocked?'recovery-blocked':'manual';task.backgroundState.reason=task.pauseState.reason;
                                syncVideoWaitBudget();pausePacing();
                            }
                            try {
                                while(video.paused&&!video.ended){
                                    await handleVideoQuiz();guard();await waitForVideoForeground();
                                    if(!video.isConnected || !courseFrameTree(owner).documents.includes(video.ownerDocument))throw new Error('视频节点或页面已替换，已停止');
                                    if(video.error)throw new Error(`视频加载/播放失败（错误 ${video.error.code}）`);
                                    emit('视频已暂停，等待你手动播放后继续','course-paused');await waitForMedia();
                                }
                                foregroundPausePending=false;pauseControl.manualPaused=false;pauseControl.manualIntentUntil=0;
                                task.backgroundState.category='playing';task.backgroundState.reason=null;
                            } finally {
                                if(manualWaitingStartedAt!==null)task.pauseState.waitMs+=Math.max(0,now()-manualWaitingStartedAt);
                                manualWaitingStartedAt=null,quizWaitingStartedAt=null;task.pauseState.waiting=false;syncVideoWaitBudget();
                                if(foregroundWaitingStartedAt===null&&quizWaitingStartedAt===null)resumePacing();
                            }
                        };
                        const onPlayerInput=event=>{
                            if(context.skipped||run.cancelled||video.paused||video.ended||!courseVideoPauseInput(event,video))return;
                            pauseControl.manualIntentUntil=now()+limits.videoManualPauseIntentMs;
                        };
                        const pauseDocuments=[...new Set([owner,video.ownerDocument])];
                        for(const doc of pauseDocuments)for(const type of ['pointerdown','click','keydown'])doc.addEventListener(type,onPlayerInput,true);
                        const releaseProtection=backgroundPlaybackGuard?.activate({video,
                            canProtect:()=>{
                                if(current!==run||run.cancelled||context!==run.chapter||context.skipped||context.submitting||run.resting
                                    ||fatalError||pendingSeek||video.seeking||video.error||video.readyState<2||pauseControl.manualPaused||pauseControl.recoveryBlocked||pauseControl.manualIntentUntil>0&&now()<=pauseControl.manualIntentUntil
                                    ||manualWaitingStartedAt!==null||foregroundWaitingStartedAt!==null||quizWaitingStartedAt!==null
                                    ||task.foregroundState.required||courseVideoForegroundPolicy(video).required||courseVideoQuizCandidate(video))return false;
                                guard();return courseFrameTree(owner).documents.includes(video.ownerDocument);
                            },onSuppressed:()=>{task.backgroundState.interceptedMouseouts++;}})||(()=>{});
                        run.releaseVideoProtection=releaseProtection;
                        const eventTypes=['pause','playing','waiting','stalled','error','ended','timeupdate','seeking','seeked','canplay','loadeddata','ratechange','loadstart','emptied'];
                        for(const type of eventTypes)video.addEventListener(type,onMediaEvent);
                        owner.addEventListener('visibilitychange',onForegroundChange);
                        owner.defaultView.addEventListener('blur',onForegroundChange);
                        owner.defaultView.addEventListener('focus',onForegroundChange);
                        try {
                            const videoUntil=async(test,message)=>{
                                const end=videoBudgetNow()+limits.videoLoadMs;
                                while(true){
                                    guard();await waitForVideoForeground();
                                    const value=test();if(value)return value;
                                    if(videoBudgetNow()>=end)throw courseTimeoutError(message);
                                    await waitForMedia();
                                }
                            };
                            const startPlayback=async(recovery=false)=>{
                                guard();
                                await waitForVideoForeground();
                                try {
                                    video.muted=run.muteVideo;
                                    const startDeadline=videoBudgetNow()+limits.videoLoadMs,playingAtStart=playingEventCount;
                                    let lastAttemptAt=-Infinity,playError=null,foregroundWaitCount=task.foregroundState.waitCount;
                                    while(true){
                                        guard();await waitForVideoForeground();
                                        if(!video.isConnected||!courseFrameTree(owner).documents.includes(video.ownerDocument))throw new Error('视频节点或页面已替换，已停止');
                                        if(video.error)throw new Error(`视频加载/播放失败（错误 ${video.error.code}）`);
                                        if(recovery){
                                            observe(snapshot('recovery-review'),true);if(fatalError)throw fatalError;
                                            if(pendingSeek){await waitForMedia();continue;}
                                        }
                                        // 明确手动暂停交给人工等待；未知中断可有限重试，浏览器拒绝不能绕过。
                                        if(pauseControl.manualPaused&&video.paused&&(!playError||playError.name==='AbortError'))break;
                                        if(playError?.name==='AbortError'&&(task.foregroundState.waitCount>foregroundWaitCount
                                            ||!pauseControl.manualPaused))playError=null;
                                        if(playError)throw playError;
                                        // 已收到真正开始播放的事件，随后暂停交给人工暂停流程，不能抢播。
                                        if(playingEventCount>playingAtStart||video.ended||!video.paused&&video.readyState>=2)break;
                                        if(recovery&&task.unstableResumes>=limits.maxResumes){pauseControl.recoveryBlocked=true;return;}
                                        if(videoBudgetNow()>=startDeadline)throw courseTimeoutError('视频启动超时，播放入口重试后仍未开始播放');
                                        if(!playRequestPending&&videoBudgetNow()-lastAttemptAt>=(recovery?limits.resumeMs:limits.videoStartRetryMs)
                                            &&(!recovery||now()-pauseControl.lastAttemptAt>=limits.resumeMs)) {
                                            lastAttemptAt=videoBudgetNow();pauseControl.lastAttemptAt=now();foregroundWaitCount=task.foregroundState.waitCount;
                                            task.startAttempts=(task.startAttempts||0)+1;
                                            if(recovery){
                                                if(task.unstableResumes===0)resumeProgress=0;
                                                task.resumes++;task.unstableResumes++;task.backgroundState.recoveryAttempts++;task.backgroundState.category='recovering';
                                            }
                                            const button=courseVideoStartButton(video);
                                            if(button)button.click();
                                            else {
                                                playRequestPending=true;
                                                Promise.resolve(video.play()).then(()=>{if(context.abort.signal.aborted||run.cancelled)video.pause();},error=>{playError=error;})
                                                    .finally(()=>{playRequestPending=false;wakeMedia?.();});
                                            }
                                            if(playingEventCount>playingAtStart||video.ended||!video.paused&&video.readyState>=2)continue;
                                        }
                                        emit('视频尚未开始播放，等待启动重试…','course-video-start');
                                        await waitForMedia();
                                    }
                                    guard();
                                } catch(error) {
                                    if(context.skipped || run.cancelled)throw error;
                                    throw Object.assign(new Error(error.name==='NotAllowedError'?'浏览器阻止自动播放，请手动启用播放后重新开始':`视频无法启动：${error.message}`),{code:error.code});
                                }
                            };
                            if(video.paused)await startPlayback();
                            if(video.paused&&!video.ended&&pauseControl.manualPaused)await waitForManualPlayback();
                            emit('已启动视频，正在读取时长…','course-video');
                            await videoUntil(()=>Number.isFinite(video.duration)&&video.duration>0,'视频时长无法读取或仍在加载');
                            task.durationSeconds=Number(video.duration);lastMotionAt=videoBudgetNow();
                            while(true) {
                                guard();
                                if (!video.isConnected) throw new Error('视频节点已替换，已停止');
                                await waitForVideoForeground();
                                await handleVideoQuiz();
                                collectVideoInfo();
                                if(!courseFrameTree(owner).documents.includes(video.ownerDocument)) throw new Error('视频页面已切换，已停止');
                                video.muted=run.muteVideo;
                                if (video.error) throw new Error(`视频加载/播放失败（错误 ${video.error.code}）`);
                                if(video.paused&&!foregroundPausePending&&pauseControl.manualIntentUntil>0&&now()<=pauseControl.manualIntentUntil)pauseControl.manualPaused=true;
                                const wasPending=Boolean(pendingSeek),currentSample=snapshot('poll');observe(currentSample,true);
                                if(fatalError)throw fatalError;
                                // 先完成位置判定，再处理当前结束状态；后台晚唤醒不能把已正常结束的重播判为超时。
                                if(pendingSeek){
                                    if(video.paused){pauseControl.recoveryBlocked ||= task.unstableResumes>=limits.maxResumes;}
                                    if(video.paused&&(pauseControl.manualPaused||pauseControl.recoveryBlocked))await waitForManualPlayback();
                                    else await waitForMedia();
                                    continue;
                                }
                                for(const quiz of task.videoQuizzes){
                                    if(quiz.phase==='replay-wait'&&quiz.rewatch&&video.currentTime>quiz.rewatch.from+limits.videoProgressEpsilonSeconds
                                        &&!video.paused&&!courseVideoQuizCandidate(video)){
                                        quiz.phase='passed';quiz.gateResult='回看后平台允许继续';
                                        if(requiredReplay?.record===quiz)finishRequiredReplay(currentSample.budgetAt);
                                        set(popupKey,task.videoQuizzes);save();
                                    }
                                }
                                if(video.ended){await handleVideoQuiz();guard();recordReplay(currentSample,'ended');break;}
                                if(requiredReplay&&currentSample.budgetAt>=requiredReplay.deadline)throw courseTimeoutError('视频弹题要求回看，长时间未恢复正常播放');
                                if(replay&&currentSample.budgetAt>=replayDeadline(currentSample.budgetAt)){recordReplay(currentSample,'timeout');throw courseTimeoutError('视频反复回退，长时间没有新增播放进展');}
                                if(!video.ended&&video.paused){
                                    // 未收到 pause 事件时也回读可信输入意图；不能因后台事件排队而抢播。
                                    if(pauseControl.manualIntentUntil>0&&now()<=pauseControl.manualIntentUntil&&!foregroundPausePending)pauseControl.manualPaused=true;
                                    pauseControl.recoveryBlocked ||= task.unstableResumes>=limits.maxResumes;
                                    if(pauseControl.manualPaused||pauseControl.recoveryBlocked){await waitForManualPlayback();continue;}
                                    if(videoBudgetNow()-lastMotionAt>=limits.stallMs)throw courseTimeoutError('视频进度长时间没有变化，可能正在缓冲或暂停');
                                    task.backgroundState.category='unknown';task.backgroundState.reason='暂停来源未确认，按旧版规则有限恢复';
                                    if(video.readyState>=2&&now()-pauseControl.lastAttemptAt>=limits.resumeMs){
                                        emit('视频暂停，正在尝试恢复播放','course-video');await startPlayback(true);
                                    }else await waitForMedia();
                                    continue;
                                }
                                foregroundPausePending=false;task.backgroundState.category='playing';task.backgroundState.reason=null;
                                // 复用已通过弹题、前台、定位和媒体检查的播放入口；不在人工等待期间操作菜单。
                                if(video.readyState>=2&&!courseVideoQuizCandidate(video))task.speedState=courseApplyVideoSpeed(video,speedAttempts,
                                    {enabled:run.speedEnabled&&!settings.videoInfoEnabled,disabledReason:settings.videoInfoEnabled&&run.speedEnabled?'recognition-enabled':'switch-off',now,readyMs:limits.speedReadyMs,confirmMs:limits.speedConfirmMs,generation:speedGeneration});
                                // 定位位移不刷新停滞时间。先给一次普通媒体采样机会，随后必检原停滞计时；
                                // 连续定位也不能反复续期，只有等待期间的真实普通播放进展能避免超时。
                                if(wasPending&&!video.ended){
                                    await waitForMedia();
                                    if(fatalError)throw fatalError;
                                    // 等待期间可能已结束；回到统一入口复查位置，再处理完成，不能先报停滞。
                                    if(video.ended)continue;
                                    if(videoBudgetNow()-lastMotionAt>=limits.stallMs)throw courseTimeoutError('视频进度长时间没有变化，可能正在缓冲或暂停');
                                    continue;
                                }
                                if (videoBudgetNow()-lastMotionAt>=limits.stallMs) throw courseTimeoutError('视频进度长时间没有变化，可能正在缓冲或暂停');
                                const remaining=Math.max(0,video.duration-video.currentTime);
                                emit(`第 ${run.chapterIndex+1}/${queue.length} 章：视频 ${Math.floor(video.currentTime)}/${Math.floor(video.duration)} 秒，剩余约 ${Math.ceil(remaining)} 秒`,'course-video');
                                await waitForMedia();
                            }
                            await taskDone(video);
                            if(settings.videoInfoEnabled){
                                collectVideoInfo(true);videoInfo.observe(video,{force:true});
                                emit('视频已结束，正在整理已采样的画面信息…','course-video');await race(videoInfo.flush());guard();
                            }
                            task.status='done';task.endedAt=now();report.videos++;
                        } finally {
                            suspendSpeed();
                            releaseProtection();if(run.releaseVideoProtection===releaseProtection)run.releaseVideoProtection=null;
                            for(const doc of pauseDocuments)for(const type of ['pointerdown','click','keydown'])doc.removeEventListener(type,onPlayerInput,true);
                            quizHandler.close();videoInfo.close();
                            task.playbackState=snapshot('snapshot');
                            for(const type of eventTypes)video.removeEventListener(type,onMediaEvent);
                            owner.removeEventListener('visibilitychange',onForegroundChange);
                            owner.defaultView.removeEventListener('blur',onForegroundChange);
                            owner.defaultView.removeEventListener('focus',onForegroundChange);
                            finishForegroundWait();if(task.status==='done'||task.status==='already')run.activeVideo=null;
                        }
                    };
                    const readDocument = async (reader, task) => {
                        if((run.skipLearned||run.retrying) && courseTaskComplete(reader.node)===true){task.status='already';return;}
                        const materialIdentity=chapterContextIdentity(owner)?.id;
                        const collectDocumentInfo=()=>{
                            if(!settings.videoInfoEnabled)return;
                            try {captureCurrentCourseContext(owner,{reader,expectedIdentity:materialIdentity});}
                            catch {task.infoStatus='当前课件文字无法读取，正常阅读继续';}
                        };
                        collectDocumentInfo();
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
                                collectDocumentInfo();
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
                        if(!run.submit) {
                            task.status='manual-pending';task.reason='自动提交章节测验已关闭，已跳过且未提交，需人工处理';
                            chapter.issues.push({number:null,reason:task.reason});
                            emit('自动提交已关闭，跳过章节测验并继续…','course-running');
                            return;
                        }
                        emit('正在分析章节测验…','generating');await race(ensureFontDecoded(doc));guard();
                        const body=doc.body;
                        const checkQuiz=()=>{guard();if(!courseFrameTree(owner).documents.includes(doc)||doc.body!==body) throw new Error('测验页面已切换，已停止');};
                        const snapshot=extractQuestionSnapshot(doc,{}, {taskId:diagnosticTaskId,checkCurrent:checkQuiz,signal:context.abort.signal});
                        snapshot.courseContext=settings.videoInfoEnabled?captureCurrentCourseContext(owner):[];
                        const data={version:ASSISTANT_VERSION,schemaVersion:3,questions:snapshot.questions,media:snapshot.media,total:snapshot.questions.length};
                        ctl.output(data);
                        if(!data.questions.length) throw new Error('测验没有可提取的题目');
                        if(!settings.key || !settings.model) {
                            chapter.issues.push(...data.questions.map(q=>({number:q.number,reason:'章节测验需要先配置模型和 API Key'})));
                            throw new Error('章节测验需要先配置模型和 API Key');
                        }
                        const known=data.questions.filter(q=>q.capabilities.analyze);
                        if(!known.length) {
                            chapter.issues.push(...data.questions.map(q=>({number:q.number,reason:q.diagnostics.join('；')||'题型未适配'})));
                            throw Object.assign(new Error('测验题型尚未适配，无法自动填写'),{code:'COURSE_MANUAL_ANSWER_REQUIRED'});
                        }
                        let answers;
                        try { answers=await race(solveQuestionBatches(snapshot,{...settings,diagnosticTaskId,courseContext:snapshot.courseContext,signal:context.abort.signal},message=>emit(message,'generating'))); }
                        catch(error) {guard();chapter.issues.push(...data.questions.map(q=>({number:q.number,reason:`未完成分析：${error.message}`})));throw error;}
                        guard();checkSnapshot(snapshot);
                        const payload={...data,...answers,model:settings.model};ctl.output(payload);
                        const byId=new Map(answers.answers.map(a=>[a.id,a])),units=questionAnswerSnapshot(snapshot).questions;
                        const summary=answers.answers.some(a=>a.answer.length)
                            ? await race(prefillChecked(snapshot,answers.answers))
                            : {filled:0,already:0,skipped:data.total,unverified:0,details:answers.answers.map(a=>`第${a.number}题：${a.answerPolicy?.reason || a.reason || '需人工处理'}`)};
                        guard();checkSnapshot(snapshot);ctl.output({...payload,prefill:summary});
                        const invalid=units.filter(q=>!questionCanAutoAnswer(q,byId.get(q.id)?.answerPolicy) || !q.capabilities.prefill || !byId.get(q.id)?.answer?.length);
                        if(invalid.length || summary.skipped || summary.unverified || summary.filled+summary.already!==units.length) {
                            chapter.issues.push(...invalid.map(q=>({number:q.number,reason:(byId.get(q.id)?.answerPolicy?.status!=='auto'?byId.get(q.id)?.answerPolicy?.reason:null) || byId.get(q.id)?.reason || q.diagnostics.join('；') || '无可靠答案或控件不可自动填写'})));
                            if(!invalid.length)chapter.issues.push(...summary.details.map(reason=>({number:Number(reason.match(/第\s*(\d+)\s*题/)?.[1])||null,reason})));
                            const error=new Error('支持的题目已处理，仍有题目需人工完成，未提交测验');error.code='COURSE_MANUAL_ANSWER_REQUIRED';throw error;
                        }
                        if(summary.requiresManualSave) {
                            chapter.issues.push({number:null,reason:'UEditor 答案已预填并同步到表单，请人工保存或提交'});
                            throw Object.assign(new Error('富文本答案已预填并同步到表单，等待人工保存或提交'),{code:'COURSE_MANUAL_ANSWER_REQUIRED',requiresManualSave:true});
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
                    const legacyCatalog=readCourseCatalog(owner)?.structure==='legacy-h4';
                    const boundary=run.rangeStart?.chapterId===chapter.id?run.rangeStart:null;
                    const firstIndex=Math.max(run.tabIndex,boundary?.tabIndex||0);
                    const catalogBefore=JSON.stringify(readCourseCatalog(owner)?.entries.filter(item=>!item.isGroup).map(item=>item.id));
                    let probe=location.probe,initialProbeTab=location.tab?.id;
                    if(!probe?.known||location.reason){report.locator.fallbacks++;const reason=location.reason||probe?.reason||'probe-unavailable';report.locator.reasons??={};report.locator.reasons[reason]=(report.locator.reasons[reason]||0)+1;}
                    run.tabIndex=location.tab?.index??firstIndex;
                    entry=courseRequireChapterAccess(owner,entry);
                    run.expected=entry.id;run.expectedTab=null;run.navigating=true;chapter.status='running';
                    emit(`正在打开章节：${entry.number} ${entry.title}${location.tab?' · '+location.tab.title:''}`,'course-navigating');
                    const before=courseContentFingerprint(owner);
                    const access=courseChapterAccess(owner,entry);
                    entry=courseRequireChapterAccess(owner,entry);
                    if(!access.current) {
                        save();report.locator.chapterNavigations++;entry.target.click();
                        await until(()=>readCourseCatalog(owner)?.entries.some(item=>item.id===entry.id&&item.active)
                            && courseContentChanged(before,courseContentFingerprint(owner)),limits.loadMs,'章节内容未成功切换');
                    }
                    const tabJump=location.tab&&courseTabs(owner).find(tab=>tab.active)?.id!==location.tab.id;
                    if(!tabJump)await waitForFrameReady(true,{chapterId:entry.id,tabId:location.tab?.id,type:location.targetType});
                    run.navigating=Boolean(tabJump);run.locating=false;guard();
                    run.probeCheck=()=>{guard();if(JSON.stringify(readCourseCatalog(owner)?.entries.filter(item=>!item.isGroup).map(item=>item.id))!==catalogBefore)
                        throw Object.assign(new Error('定位期间课程目录发生变化，请重新开始'),{code:'COURSE_LOCATOR_CHANGED'});};
                    let tabState;
                    await until(()=>{tabState=courseTabSnapshot(owner);return tabState.ready;},limits.loadMs,'栏目列表或 active 状态未就绪');
                    let tabs=tabState.tabs.length?tabState.tabs:[{id:'current',title:'当前页面',active:true}];
                    let tabIds=tabs.map(tab=>tab.id);
                    let rangeTruncated=Boolean(boundary&&tabIds.indexOf(boundary.tabId)>0);
                    if(boundary&&(!tabIds.includes(boundary.tabId)||boundary.cardId&&tabs.find(tab=>tab.id===boundary.tabId)?.node.getAttribute('cardid')!==boundary.cardId))throw new Error('本次起点栏目发生变化，请重新开始');
                    if(probe?.known&&JSON.stringify(probe.tabs.map(tab=>[tab.id,tab.cardId]))!==JSON.stringify(tabs.map(tab=>[tab.id,tab.node?.getAttribute('cardid')||'']))) {
                        // Native rendering can change the pre-read column descriptors. Discard this
                        // chapter's exclusions and inspect its live columns within the frozen range.
                        courseInvalidateTaskProbe(owner,entry.id);
                        probe=null;initialProbeTab=null;run.tabIndex=firstIndex;
                        report.locator.fallbacks++;report.locator.reasons??={};
                        report.locator.reasons['live-tabs-changed']=(report.locator.reasons['live-tabs-changed']||0)+1;
                        emit('栏目列表已更新，正在核对当前章节任务…','course-locating');
                    } else rememberExcluded(chapter,location.excluded);
                    const savedTabs=run.tabProgress?.chapterId===chapter.id?run.tabProgress:null;
                    const startTabId=savedTabs?.currentId || (probe?.known?location.tab?.id:null) || boundary?.tabId;
                    if(startTabId&&startTabId!=='current') {
                        const start=tabIds.indexOf(startTabId);
                        if(start<0)throw new Error('本轮记录的起始栏目已移除，无法继续原队列');
                        run.tabIndex=start;
                    }
                    const visitedTabs=new Set(savedTabs?.completed||tabs.slice(0,run.tabIndex).map(tab=>tab.id));
                    const identities=new Map(savedTabs?.identities||tabs.map(tab=>[tab.id,tab.node?.getAttribute('cardid')||'']));
                    let currentTabId=null,tabSignature=JSON.stringify([...identities]),tabRebound=false;
                    const refreshTabs=()=>{
                        const live=courseTabSnapshot(owner);
                        if(!live.ready)return false;
                        const next=live.tabs.length?live.tabs:[{id:'current',title:'当前页面',active:true}];
                        const pairs=next.map(tab=>[tab.id,tab.node?.getAttribute('cardid')||'']);
                        for(const [id,card] of pairs)if(identities.get(id)&&identities.get(id)!==card) {
                            if(!card)return false;
                            throw new Error('栏目对应内容已变化，无法继续使用原任务队列');
                        }
                        if(boundary&&(!next.some(tab=>tab.id===boundary.tabId)||boundary.cardId&&next.find(tab=>tab.id===boundary.tabId)?.node?.getAttribute('cardid')!==boundary.cardId))
                            throw new Error('本次起点栏目发生变化，请重新开始');
                        if(currentTabId&&currentTabId!=='current'&&!next.some(tab=>tab.id===currentTabId))throw new Error('正在处理的栏目已移除，无法确认任务状态');
                        if(next[0].id!=='current'&&(currentTabId==='current'||visitedTabs.has('current'))) {
                            // current 只是栏目未出现时的临时页面，不能把它的完成记录转给后来出现的 active 栏目。
                            // 原生加载可同时替换 iframe；结束旧页面处理，再从真实栏目重新读取任务和完成状态。
                            visitedTabs.delete('current');identities.delete('current');currentTabId=null;tabSignature=null;
                            run.expectedTab=live.activeId;tabRebound=true;
                            emit('栏目已加载，正在重新核对实际栏目任务…','course-running');
                        }
                        const signature=JSON.stringify(pairs);
                        if(signature!==tabSignature) {
                            courseInvalidateTaskProbe(owner,entry.id);probe=null;initialProbeTab=null;tabSignature=signature;
                            for(const [id,card] of pairs)identities.set(id,card);
                        }
                        tabs=next;tabIds=tabs.map(tab=>tab.id);
                        rangeTruncated=Boolean(boundary&&tabIds.indexOf(boundary.tabId)>0);
                        const index=tabIds.indexOf(currentTabId);
                        if(index>=0)run.tabIndex=index;
                        return true;
                    };
                    const nextTab=()=>tabs.find((tab,index)=>!visitedTabs.has(tab.id)&&(!boundary||index>=tabIds.indexOf(boundary.tabId)));
                    const markTab=()=>{
                        visitedTabs.add(currentTabId);
                        run.tabProgress={chapterId:chapter.id,currentId:currentTabId,completed:[...visitedTabs],identities:[...identities]};
                        save();
                    };
                    let taskFreeOnly=!chapter.tasks.some(task=>task.type!=='non-task');
                    tabLoop:for(;;) {
                        await until(refreshTabs,limits.loadMs,'栏目列表或 active 状态持续无法确认');
                        let tab=nextTab();
                        if(!tab) {
                            await wait(limits.settleMs);
                            await until(refreshTabs,limits.loadMs,'栏目结构更新后未就绪');
                            tab=nextTab();
                            if(!tab&&!rangeTruncated&&!chapter.tasks.some(task=>task.status==='manual-pending')) {
                                const state=()=>readCourseCatalog(owner)?.entries.find(item=>item.id===entry.id);
                                if(state()?.pending>0&&!state()?.completed) {
                                    emit('正在核对新增栏目或平台完成确认…','course-running');
                                    await until(()=>refreshTabs()&&(nextTab()||state()?.completed||state()?.pending===0),limits.completionMs,'栏目已核对，本章仍有未完成任务或平台未确认');
                                    tab=nextTab();
                                }
                            }
                            if(!tab)break;
                        }
                        const id=tab.id;currentTabId=id;run.tabIndex=tabIds.indexOf(id);
                        run.tabProgress={chapterId:chapter.id,currentId:id,completed:[...visitedTabs],identities:[...identities]};
                        let readyType=id===initialProbeTab?location.targetType:null;
                        if(tab.disabled)throw new Error('章节页面标签未解锁，无法自动继续');
                        if(probe?.known&&id!==initialProbeTab) {
                            const descriptor=probe.tabs.find(item=>item.id===id);let summary;
                            const started=now();pausePacing();run.locating=true;
                            const activeTab=courseTabs(owner).find(item=>item.active)?.id;
                            try {emit(`正在定位任务… ${entry.number} · ${tab?.title||id}`,'course-locating');summary=await probe.read(descriptor);guard();
                                if(courseTabs(owner).find(item=>item.active)?.id!==activeTab)throw new Error('定位期间栏目发生变化，请重新开始');
                            } catch(error){guard();if(context.abort.signal.aborted||error.code==='COURSE_LOCATOR_CHANGED')throw error;summary={known:false};}
                            finally {run.locating=false;report.locator.elapsedMs+=Math.max(0,now()-started);resumePacing();}
                            if(summary?.known) {
                                const decisions=summary.tasks.map(task=>courseTaskEligibility(task,run));
                                if(decisions.every(item=>item.status==='excluded')){rememberExcluded(chapter,[{tab:descriptor,tasks:summary.tasks,decisions}]);taskFreeOnly=false;markTab();continue;}
                                readyType=summary.tasks[decisions.findIndex(item=>item.status!=='excluded')]?.type;
                            }
                        }
                        if(tab && !tab.active) {
                            if(!courseElementVisible(tab.node))throw new Error('下一栏目入口尚不可见，无法安全切换');
                            const old=courseContentFingerprint(owner);run.navigating=true;save();report.locator.tabNavigations++;tab.node.click();
                            await until(()=>courseTabs(owner).some(item=>item.id===id&&item.active)
                                && courseContentChanged(old,courseContentFingerprint(owner)),limits.loadMs,'页面标签未成功切换');
                            await waitForFrameReady(true,{chapterId:entry.id,tabId:id,type:readyType});run.navigating=false;
                        }
                        run.expectedTab=id==='current'?null:id;
                        await waitForFrameReady(tabRebound,{chapterId:entry.id,tabId:id,type:readyType});tabRebound=false;
                        run.navigating=false;guard();
                        let tree=courseFrameTree(owner);
                        let docs=tree.documents.slice(1);
                        if(docs.some(doc=>doc.querySelector('.fanyaMarking_left')))throw new Error('检测到作业页面，无法自动刷课');
                        let allTasks=coursePageTasks(tree);
                        // 只有可见任务点且无可用控件时才等加载；不凭标签名称或附件外壳推测还有任务。
                        if(!allTasks.length && coursePageHasTaskPoints(tree)) {
                            emit('正在等待任务控件加载…','course-running');
                            await until(()=>{
                                tree=courseFrameTree(owner);docs=tree.documents.slice(1);allTasks=coursePageTasks(tree);
                                if(docs.some(doc=>doc.querySelector('.fanyaMarking_left')))throw new Error('检测到作业页面，无法自动刷课');
                                return allTasks.length || coursePageWithoutTasks(tree,allTasks);
                            },limits.loadMs,'任务控件未适配或仍未加载，无法自动完成此页面');
                        }
                        if(coursePageWithoutTasks(tree,allTasks)) {
                            chapter.tasks.push({tab:id,type:'non-task',status:'not-required'});
                            emit('当前栏目没有任务点，正在核对后续栏目…','course-running');markTab();continue;
                        }
                        taskFreeOnly=false;
                        let tasks=allTasks.filter(item=>courseTaskRequired(item.node)!==false);
                        const processed=new Set();
                        const manualNodes=new Set();
                        let videoNumber=0,documentNumber=0;
                        while(tasks.length) {
                            const item=tasks[0];
                            guard();
                            const task={tab:id,type:item.type,status:'running'};
                            if(item.type==='video')task.number=++videoNumber;
                            if(item.type==='document')task.number=++documentNumber;
                            chapter.tasks.push(task);
                            if(courseTaskComplete(item.node)===true||item.type==='quiz'&&courseQuizComplete(item.doc))task.status='already';
                            else if(item.type==='video')await playVideo(item.node,task);
                            else if(item.type==='document') {emit('正在阅读资料…','course-document');await readDocument(item.reader,task);if(settings.videoInfoEnabled)captureCurrentCourseContext(owner,{reader:item.reader});}
                            else if(item.type==='knowledge-graph') {
                                task.status=courseTaskComplete(item.node)===true?'already':'manual-pending';
                                task.reason='知识图谱已自动跳过，未计为完成';
                                manualNodes.add(item.node);
                                if(task.status==='manual-pending')chapter.issues.push({number:null,reason:task.reason});
                                emit('知识图谱已跳过，继续后续任务…','course-running');
                            } else {
                                const issueStart=chapter.issues.length;
                                try {await solveQuiz(item.doc,task,chapter);}
                                catch(error) {
                                    guard();
                                    // 只放行已确定的作答适用性问题；验证、网络及提交异常保持原停止规则。
                                    if(!run.skipUnanswerable || error.code!=='COURSE_MANUAL_ANSWER_REQUIRED' || context.submitting
                                        || chapter.tasks.some(t=>t.submissionStarted&&t.status!=='done'))throw error;
                                    task.status='manual-pending';task.reason=error.message;
                                    if(error.requiresManualSave)task.requiresManualSave=true;
                                    task.manualQuestions=chapter.issues.slice(issueStart).map(issue=>({number:issue.number,reason:clean(issue.reason).slice(0,200)}));
                                    manualNodes.add(item.node);
                                    emit(task.requiresManualSave?'富文本答案已预填并同步到表单，未提交，继续后续任务…':'此测验含无法自动答题的题目，已保留支持题答案；不提交，继续后续任务…','course-running');
                                }
                            }
                            if(task.status==='manual-pending')manualNodes.add(item.node);
                            if(task.status==='done')courseInvalidateTaskProbe(owner,entry.id);
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
                            await until(refreshTabs,limits.loadMs,'处理任务后栏目列表未就绪');
                            if(currentTabId!==id)continue tabLoop;
                            const lastTab=!tabs.some(tab=>tab.id!==id&&!visitedTabs.has(tab.id)&&(!boundary||tabIds.indexOf(tab.id)>=tabIds.indexOf(boundary.tabId)));
                            const pendingHere=()=>courseFrameTree(owner).documents.slice(1).some(doc=>[...doc.querySelectorAll('.ans-attach-ct,[data-course-task]')]
                                .some(node=>courseElementVisible(node)&&courseTaskRequired(node)!==false&&courseTaskComplete(node)===false
                                    && (courseTaskLabel(node)||courseVisibleMarker(node,'.ans-job-icon'))
                                    && ![...manualNodes].some(quiz=>courseTaskContains(node,quiz)||courseTaskContains(quiz,node))));
                            // 中途标签处理结束后先遍历后续标签；整章剩余数不能阻止标签切换。
                            if(!tasks.length && lastTab && (legacyCatalog ? pendingHere() : (pendingHere() || !rangeTruncated&&!chapter.tasks.some(task=>task.status==='manual-pending')) && entryState()?.pending>0 && !entryState()?.completed)) {
                                emit('正在等待后续任务或平台完成确认…','course-running');
                                const next=await until(()=>{
                                    if(!refreshTabs())return false;
                                    if(currentTabId!==id)return {tasks:[],rebound:true};
                                    if(tabs.some(tab=>tab.id!==id&&!visitedTabs.has(tab.id)&&(!boundary||tabIds.indexOf(tab.id)>=tabIds.indexOf(boundary.tabId))))return {tasks:[]};
                                    const found=collectNext();
                                    if(found.length)return {tasks:found};
                                    if(!pendingHere() && (legacyCatalog||rangeTruncated||chapter.tasks.some(task=>task.status==='manual-pending')))return {tasks:[]};
                                    return entryState()?.completed||entryState()?.pending===0?{tasks:[]}:false;
                                },limits.completionMs,'本章仍有未完成任务或后续控件未加载');
                                if(next.rebound)continue tabLoop;
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
                        markTab();
                    }
                    const pending=()=>readCourseCatalog(owner)?.entries.find(item=>item.id===entry.id);
                    if(taskFreeOnly) {chapter.status='no-tasks';chapter.reason='已遍历全部页面，未发现可见任务点；未计为完成';save();return;}
                    if(chapter.tasks.some(task=>task.status==='manual-pending')&&!pending()?.completed&&pending()?.pending!==0) {
                        chapter.status='manual-pending';chapter.reason=chapter.tasks.some(task=>task.type==='knowledge-graph'&&task.status==='manual-pending')
                            ?'包含已跳过的知识图谱，未计为完成，需人工处理':chapter.tasks.some(task=>task.requiresManualSave)
                            ?'富文本答案已预填并同步到表单，等待人工保存或提交':!run.submit?'自动提交章节测验已关闭，测验已跳过且未提交，需人工处理':'包含无法自动答题的测验，已跳过且未提交，需人工处理';save();return;
                    }
                    if(rangeTruncated&&!pending()?.completed&&pending()?.pending!==0) {
                        chapter.status='manual-pending';chapter.remainingUnconfirmed=true;
                        chapter.reason='已处理本次起点之后的栏目；起点之前未纳入本轮，保留整章未完成状态';save();return;
                    }
                    if(chapter.tasks.some(task=>task.tab===tabIds[tabIds.length-1]&&task.type==='non-task')
                        && !pending()?.completed && pending()?.pending!==0) {
                        chapter.status='manual-pending';chapter.remainingUnconfirmed=true;
                        chapter.reason='已遍历全部标签，最后一页无任务控件，已继续下一节；目录仍未确认完成，保留待人工核对';
                        save();return;
                    }
                    if(legacyCatalog && !pending()?.completed && pending()?.pending!==0) {
                        chapter.status='manual-pending';chapter.remainingUnconfirmed=true;
                        chapter.reason='已处理本章实际任务；旧版目录未提供整章完成标记，保留待核对并继续下一节';save();return;
                    }
                    if(!pending()?.completed && pending()?.pending!==0) await until(()=>pending()?.completed||pending()?.pending===0,limits.completionMs,'本章仍有未完成任务或状态未提供，已停止');
                    chapter.status='done';save();
                };
                run.validate=guardRun;run.notify=emitRun;
                const onUnload = () => {
                    if(!current) return;
                    run.leaving=true;
                    run.handoff=run.navigating||run.resting;
                    report.status=run.handoff?'running':'stopped'; report.reason=run.handoff?'页面导航中，等待恢复':'页面已离开或刷新，自动流程停止';
                    save();api.stop(report.reason);
                };
                owner.defaultView.addEventListener('pagehide',onUnload,{once:true});
                let watchdog;
                try {
                    save();
                    watchdog=owner.defaultView.setInterval(()=>{
                        try {guardRun();if(now()-run.lastSaved>2500)save();} catch(error) {api.stop(error.message,error);}
                    },limits.pollMs);
                    if(run.protection.enabled && run.protection.consecutiveFailures>=run.protection.limit){run.protection.triggered=true;run.protection.triggeredAt=now();save();throw courseFailureLimitError(run.protection.limit);}
                    if(run.pacing.restUntil!==null)await waitForRest();
                    for(;run.chapterIndex<queue.length;run.chapterIndex++,run.tabIndex=0) {
                        run.locating=true;guardRun();let chapter=report.chapters[run.chapterIndex];
                        if(resume&&['done','no-tasks','already','skipped','timed-out','manual-pending'].includes(chapter.status))continue;
                        let entry=readCourseCatalog(owner)?.entries.find(item=>item.id===chapter.id);
                        if(!entry?.node?.isConnected) throw new Error('课程目录发生变化或章节不存在');
                        if((run.skipLearned||run.retrying) && entry.completed){chapter.status='already';courseRecordChapterOutcome(run.protection,chapter,run.chapterIndex);save();continue;}
                        entry=await awaitChapterAccess(entry);
                        const context={abort:new AbortController(),skipped:false,submitting:false};
                        context.wait=new Promise(resolve=>{context.wake=resolve;});run.chapter=context;
                        try {
                            let location,boundarySince=null;
                            while(true) {
                                location=await locateAhead(entry,context);
                                for(const skipped of location.skipped||[]) {
                                    const index=queue.findIndex(item=>item.id===skipped.entry.id),record=report.chapters[index];
                                    rememberExcluded(record,skipped.tabs);
                                    record.status=skipped.reason==='already'?'already':record.tasks.some(task=>task.status==='manual-pending')?'manual-pending':'no-tasks';
                                    record.reason=record.status==='manual-pending'?'本次设置已排除剩余任务，保留未完成状态':record.status==='already'?'平台目录已完成':'任务摘要中没有本次需要执行的任务，未计为整章完成';
                                    courseRecordChapterOutcome(run.protection,record,index);
                                }
                                if(!location.boundary)break;
                                boundarySince??=now();
                                if(now()-boundarySince>=limits.unlockWaitMs)throw Object.assign(new Error('章节原生入口持续变化，请重新开始'),{
                                    code:'COURSE_NAVIGATION_UNKNOWN',navigationBoundary:{...location.boundary,status:'unknown',reason:'navigation-unstable'}});
                                const boundaryIndex=queue.findIndex(item=>item.id===location.boundary.id);
                                if(boundaryIndex<run.chapterIndex)throw new Error('已定位章节的入口发生变化，请重新开始');
                                run.chapterIndex=boundaryIndex;run.tabIndex=0;chapter=report.chapters[boundaryIndex];
                                entry=await awaitChapterAccess(chapter);
                            }
                            if(!location.entry){run.chapterIndex=queue.length;save();break;}
                            const targetIndex=queue.findIndex(item=>item.id===location.entry.id);
                            if(targetIndex<run.chapterIndex)throw new Error('定位结果超出本次范围');
                            if(targetIndex!==run.chapterIndex)run.tabIndex=0;
                            run.chapterIndex=targetIndex;chapter=report.chapters[targetIndex];entry=readCourseCatalog(owner)?.entries.find(item=>item.id===chapter.id);
                            if(!entry?.node?.isConnected)throw new Error('课程目录发生变化或章节不存在');
                            entry=await awaitChapterAccess(entry);
                            save();await processChapter(chapter,entry,location);
                        }
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
                                // 先结束章节、记录失败，再决定是否允许进入下一节。
                            } else throw error;
                            save();
                        } finally {
                            context.abort.abort();
                            if(context.skipped || context.timedOut) run.activeVideo?.pause();
                            run.chapter=null;
                            run.expected=null;run.expectedTab=null;run.navigating=false;
                            lease.setAttribute('data-can-skip','false');
                        }
                        courseRecordChapterOutcome(run.protection,chapter,run.chapterIndex);
                        if(run.protection.enabled && run.protection.consecutiveFailures>=run.protection.limit) {
                            run.protection.triggered=true;run.protection.triggeredAt=now();save();
                            throw courseFailureLimitError(run.protection.limit);
                        }
                        save();
                        const nextCatalog=readCourseCatalog(owner);
                        const nextChapter=queue.slice(run.chapterIndex+1).find(item=>{
                            const next=nextCatalog?.entries.find(entry=>entry.id===item.id);
                            return next&&!(run.skipLearned&&next.completed);
                        });
                        if(nextChapter)await awaitChapterAccess(nextChapter);
                        if(chapter.status==='timed-out')emitRun(`本章节超时；连续超时 ${run.protection.consecutiveFailures}${run.protection.enabled?'/'+run.protection.limit:'，失败次数保护已关闭'}，继续下一节`,'course-running');
                        const hasNext=Boolean(nextChapter);
                        if(run.learning.restEnabled&&['done','no-tasks'].includes(chapter.status)&&hasNext){
                            const activeMs=run.pacing.activeMs+(run.pacing.activeStartedAt===null?0:Math.max(0,now()-run.pacing.activeStartedAt));
                            if(activeMs>=run.learning.studyMinutes*60000)await waitForRest();
                        }
                    }
                    report.status='done';
                } catch(error) {
                    if(!error.navigationBoundary) {
                        const diagnostic=recordCxDiagnostic(error,{module:'course',operation:'run',taskId:diagnosticTaskId});
                        runDiagnosticCode=diagnostic.code;
                        ctl.state.lastErrorCode=runDiagnosticCode;
                    }
                    if(!run.leaving) {report.status='stopped';report.reason=error.message;}
                    if(error.navigationBoundary)recordNavigationBoundary(error.navigationBoundary);
                    const chapter=report.chapters[run.chapterIndex];
                    if(!error.navigationBoundary && error.code!=='COURSE_FAILURE_LIMIT' && report.status==='stopped' && chapter && !['already','done','waiting-unlock','navigation-unknown','timed-out','skipped','manual-pending','no-tasks'].includes(chapter.status)) {
                        chapter.status='stopped';
                        for(const task of chapter.tasks.filter(task=>task.status==='running')) {task.status='stopped';task.reason=error.message;}
                        if(!chapter.issues.length) chapter.issues.push({number:null,reason:error.message});
                    }
                } finally {
                    pausePacing();
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
                refreshScope();
                const previous=key?get(key,null):null;
                if(!previous?.protection?.triggered && previous?.status==='running' && previous.handoff===true && previous.session===session && now()-previous.heartbeat<60000) return api.start({resume:true});
            }
        };
        // 同一课程的多个同源标签页共享浏览器互斥锁；不会锁住另一门课程。
        const startUnlocked=api.start;
        let starting=false;
        api.start=async options=>{
            if(starting || current || courseRunActive(owner))return;
            refreshScope();const startScope=scope;
            starting=true;
            try {
                const locks=owner.defaultView.navigator.locks;
                if(!scope || !locks?.request)return await startUnlocked(options);
                return await locks.request(`cx-ai-course-run:${scope}`,{ifAvailable:true},lock=>{
                    if(!lock){ctl.report('另一个页面正在运行本课程，请先停止该页面','error');return;}
                    if(courseScoreKey(owner)!==startScope){ctl.report('获取运行锁期间课程或账号已变化，请重新开始','error');return;}
                    return startUnlocked(options);
                });
            } catch(error) {ctl.report(error.message,'error');}
            finally {starting=false;}
        };
        courseRunnerControllers.set(owner,api);
        return api;
    }
    function initCourseRunControls(doc, ctl) {
        const owner=studyOwnerDocument(doc),s=panelView.shadow;
        const stopButton=s.getElementById('course-stop');
        let stopRunId=null,stopUntil=0,stopTimer=null,stopCountdownTimer=null;
        const clearStopConfirmation=()=>{
            if(stopTimer!==null)doc.defaultView?.clearTimeout(stopTimer);
            if(stopCountdownTimer!==null)doc.defaultView?.clearInterval(stopCountdownTimer);
            stopTimer=null;stopCountdownTimer=null;stopRunId=null;stopUntil=0;
            stopButton.textContent='停止';stopButton.classList.remove('stop-confirm');
        };
        panelView.clearStopConfirmation=clearStopConfirmation;
        const updateStopCountdown=()=>{
            if(!stopRunId)return;
            const seconds=Math.ceil((stopUntil-Date.now())/1000);
            if(seconds<=0){clearStopConfirmation();return;}
            stopButton.textContent=`确认停止（${seconds}s）`;
        };
        const skipLearned=s.getElementById('course-skip-learned'),fromCurrent=s.getElementById('course-from-current'),timeoutNext=s.getElementById('course-timeout-next'),muteVideo=s.getElementById('course-mute-video'),skipUnanswerable=s.getElementById('course-skip-unanswerable'),videoQuizAuto=s.getElementById('course-video-quiz-auto'),speedEnabled=s.getElementById('course-speed-enabled');
        const autoSubmit=s.getElementById('course-auto-submit');
        const failureProtection=s.getElementById('course-failure-protection');
        failureProtection.checked=get('cx_course_failure_protection_enabled',false)===true;
        failureProtection.onchange=event=>{
            if(!trustedAssistantActivation(event,failureProtection,'change')||courseRunActive(doc)||ctl.state.busy){render();return;}
            set('cx_course_failure_protection_enabled',failureProtection.checked);render();
        };
        const restEnabled=s.getElementById('course-rest-enabled'),studyMinutes=s.getElementById('course-study-minutes'),restMinutes=s.getElementById('course-rest-minutes');
        const renderLearningFields=()=>{
            const cfg=readCourseLearningSettings();restEnabled.checked=cfg.restEnabled;studyMinutes.value=cfg.studyMinutes;restMinutes.value=cfg.restMinutes;
        };
        renderLearningFields();
        for(const [control,key,field] of [[restEnabled,'cx_course_rest_enabled','restEnabled'],[studyMinutes,'cx_course_study_minutes','studyMinutes'],[restMinutes,'cx_course_rest_minutes','restMinutes']])control.onchange=()=>{
            if(courseRunActive(doc)||ctl.state.busy){renderLearningFields();return;}
            const value=field==='restEnabled'?control.checked:Number(control.value);
            const cfg=courseLearningSettings({...readCourseLearningSettings(),[field]:value});
            s.getElementById('course-learning-message').textContent=cfg[field]!==value?'请输入范围内的整数，已恢复默认值。':'学习设置已保存';
            set(key,cfg[field]);renderLearningFields();
        };
        for(const [control,key,fallback] of [[skipLearned,'cx_course_skip_learned',true],[fromCurrent,'cx_course_from_current',false],[timeoutNext,'cx_course_timeout_next',true],[muteVideo,'cx_course_mute_video',true],[skipUnanswerable,'cx_course_skip_unanswerable',false],[videoQuizAuto,'cx_course_video_quiz_auto',true],[speedEnabled,'cx_course_speed_enabled',false]]) {
            control.checked=get(key,fallback)===true;
            control.onchange=()=>set(key,control.checked);
        }
        // 自动提交权限仅属于本次明确选择，不从旧设置或网页修改恢复。
        let submitAuthorized=false;autoSubmit.checked=false;
        autoSubmit.onchange=event=>{
            if(!trustedAssistantActivation(event,autoSubmit,'change') || !courseRunController(owner)||courseRunActive(doc)||ctl.state.busy){autoSubmit.checked=submitAuthorized;return;}
            const enabling=autoSubmit.checked===true;
            submitAuthorized=enabling&&assistantConfirm('本次运行会自动提交章节测验，AI 答案可能错误。是否允许本次运行自动提交？')===true;
            if(courseRunActive(doc)||ctl.state.busy)submitAuthorized=false;
            autoSubmit.checked=submitAuthorized;
        };
        // Consume the one-run authorization; render the checkbox from the active run separately.
        const takeSubmitPermission=()=>{const allowed=submitAuthorized;submitAuthorized=false;return allowed;};
        skipUnanswerable.onchange=()=>{
            if(courseRunActive(doc)||ctl.state.busy){skipUnanswerable.checked=get('cx_course_skip_unanswerable',false)===true;return;}
            set('cx_course_skip_unanswerable',skipUnanswerable.checked);render();
        };
        videoQuizAuto.onchange=event=>{
            if(!trustedAssistantActivation(event,videoQuizAuto,'change')||courseRunActive(doc)||ctl.state.busy){videoQuizAuto.checked=get('cx_course_video_quiz_auto',true)!==false;return;}
            set('cx_course_video_quiz_auto',videoQuizAuto.checked);render();
        };
        speedEnabled.onchange=event=>{
            if(!trustedAssistantActivation(event,speedEnabled,'change')||courseRunActive(doc)||ctl.state.busy){speedEnabled.checked=get('cx_course_speed_enabled',false)===true;return;}
            set('cx_course_speed_enabled',speedEnabled.checked);render();
        };
        const latestReport=()=>courseRunner?.report || (owner&&courseScoreKey(owner)?get(`cx_course_run:${courseScoreKey(owner)}`,null)?.report:null);
        const retryButton=s.getElementById('course-retry'),retryConfirm=s.getElementById('course-retry-confirm'),retryMessage=s.getElementById('course-retry-message');
        let retryToken=null;
        const clearRetryConfirmation=()=>{retryToken=null;retryConfirm.hidden=true;retryMessage.textContent='';};
        panelView.clearRetryConfirmation=clearRetryConfirmation;
        const retryCandidate=()=>owner&&courseScoreKey(owner)?courseRetryCandidate(owner,get(`cx_course_run:${courseScoreKey(owner)}`,null)):{allowed:false,reason:'仅课程学习页面支持重试'};
        retryButton.onclick=event=>{
            if(!trustedAssistantActivation(event,retryButton) || !courseRunController(owner))return;
            const candidate=retryCandidate();
            if(ctl.state.busy||!candidate.allowed){clearRetryConfirmation();return;}
            retryToken=candidate.token;retryConfirm.hidden=false;
            retryMessage.textContent=`将按原顺序重试 ${candidate.queue.length} 个待处理章节：${candidate.queue[0].number} ${candidate.queue[0].title} 起。请检查页面与设置后确认。`;
        };
        s.getElementById('course-retry-cancel').onclick=clearRetryConfirmation;
        s.getElementById('course-retry-accept').onclick=event=>{
            if(!trustedAssistantActivation(event,s.getElementById('course-retry-accept')) || !courseRunController(owner))return;
            const token=retryToken,candidate=retryCandidate();clearRetryConfirmation();
            if(token===null||ctl.state.busy||!candidate.allowed||candidate.token!==token){ctl.report(candidate.reason||'运行记录已变化，请重新确认重试','error');return;}
            courseRunController(owner)?.retryIncomplete(token,{submit:takeSubmitPermission()});
        };
        s.getElementById('close').addEventListener('click',clearRetryConfirmation);
        const renderPending=report=>{
            const pending=coursePendingChapters(report),summary=s.getElementById('course-pending-summary'),list=s.getElementById('course-pending-list');
            const hasManualTasks=report?.chapters?.some(chapter=>chapter.remainingUnconfirmed===true||chapter.tasks?.some(task=>task.status==='manual-pending'&&(task.type==='knowledge-graph'||task.reason?.startsWith('自动提交章节测验已关闭'))));
            const count=pending.failed.length+pending.skipped.length+pending.manual.length+pending.waiting.length+pending.navigation.length+pending.unvisited.length;
            s.getElementById('course-pending').hidden=!report||count===0&&pending.taskFree.length===0;
            summary.textContent=`待处理章节：失败 ${pending.failed.length}，用户跳过 ${pending.skipped.length}，${hasManualTasks?'需人工处理':'无法答题'} ${pending.manual.length}${pending.waiting.length?`，待解锁 ${pending.waiting.length}`:''}${pending.navigation.length?`，入口未确认 ${pending.navigation.length}`:''}，尚未处理 ${pending.unvisited.length}${pending.taskFree.length?`；无任务 ${pending.taskFree.length}`:''}`;
            list.replaceChildren();
            for(const [key,label] of [['failed','失败'],['skipped','用户跳过'],['manual',hasManualTasks?'需人工处理（已跳过）':'无法自动答题（未提交）'],['waiting','待解锁'],['navigation','入口未确认'],['unvisited','尚未处理'],['taskFree','无任务']])for(const item of pending[key]){
                const li=doc.createElement('li');li.textContent=`${label} · ${item.number} ${item.title}${item.reason?'：'+item.reason:''}`;list.append(li);
            }
            const protection=report?.protection;
            const enabled=courseRunActive(doc)?protection?.enabled===true:get('cx_course_failure_protection_enabled',false)===true;
            s.getElementById('course-protection-status').textContent=protection?.triggered?`连续 ${protection.limit} 个章节超时，已保护性停止（CX-EXE-008）`:
                `连续失败保护性停止：${enabled?'开启（连续三个章节超时后停止）':'关闭'}${protection?.consecutiveFailures?`；本轮连续超时 ${protection.consecutiveFailures} 次`:''}`;
            const candidate=retryCandidate();retryButton.disabled=!courseRunController(owner)||ctl.state.busy||!candidate.allowed;retryButton.hidden=!report;
            retryButton.title=candidate.allowed?'按原队列顺序重试待处理章节':candidate.reason;
            if(retryToken && (ctl.state.busy||!candidate.allowed||candidate.token!==retryToken))clearRetryConfirmation();
        };
        const render=()=>{
            const running=courseRunActive(doc),report=latestReport();
            renderPending(report);
            const lease=owner?.getElementById('cx-ai-course-lease');
            if(stopRunId && (!running || lease?.getAttribute('data-run-id')!==stopRunId || Date.now()>=stopUntil))clearStopConfirmation();
            updateStopCountdown();
            const duration=Number(lease?.getAttribute('data-video-duration'));
            const raw=lease?.getAttribute('data-video-current'), elapsed=Number(raw);
            const valid=running && lease?.getAttribute('data-phase')==='course-video' && raw!==null && Number.isFinite(duration) && duration>0 && Number.isFinite(elapsed);
            const progress=s.getElementById('video-progress');
            s.getElementById('video-progress-wrap').hidden=!valid;
            progress.max=valid?duration:1;progress.value=valid?Math.max(0,Math.min(duration,elapsed)):0;
            progress.setAttribute('aria-valuetext',valid?`${Math.floor(progress.value)} / ${Math.floor(duration)} 秒`:'无正在播放的视频');
            s.getElementById('video-progress-text').textContent=valid?`${Math.floor(progress.value/duration*100)}%`:'';
            const hasCommands=Boolean(courseRunController(owner));
            s.getElementById('course-start').disabled=!hasCommands||running||ctl.state.busy;
            s.getElementById('course-stop').disabled=!hasCommands||!running;
            s.getElementById('course-skip').disabled=!hasCommands||(running ? owner?.getElementById('cx-ai-course-lease')?.getAttribute('data-can-skip')!=='true' : !courseSkipResume(owner));
            autoSubmit.checked=running ? courseRunController(owner)?.autoSubmitEnabled===true : submitAuthorized;
            s.getElementById('course-auto-submit').disabled=!hasCommands||running||ctl.state.busy;
            skipLearned.disabled=running||ctl.state.busy;
            fromCurrent.disabled=running||ctl.state.busy;
            timeoutNext.disabled=running||ctl.state.busy;
            failureProtection.checked=running?report?.protection?.enabled===true:get('cx_course_failure_protection_enabled',false)===true;
            failureProtection.disabled=running||ctl.state.busy;
            muteVideo.disabled=running||ctl.state.busy;
            skipUnanswerable.disabled=running||ctl.state.busy;videoQuizAuto.disabled=running||ctl.state.busy;speedEnabled.disabled=running||ctl.state.busy;
            for(const control of [restEnabled,studyMinutes,restMinutes])control.disabled=running||ctl.state.busy;
            s.getElementById('course-run-note').textContent=owner&&!hasCommands?'请通过课程主页面的学习通AI助手操作自动学习。':owner?(skipUnanswerable.checked?'自动播放视频、阅读资料；未开启自动提交时跳过章节测验。开启后，无法自动答题的测验保留答案、不提交并继续，仍需人工完成。遇到验证或运行异常时沿用原保护规则。':'自动播放视频、阅读资料；未开启自动提交时跳过章节测验，开启后处理章节测验；遇到人脸识别或无法可靠作答时停止。'):'仅课程学习页面支持；独立作业页无法刷课。';
            if(speedEnabled.checked)s.getElementById('course-run-note').textContent+=readModelConfiguration().videoInfoEnabled?' 已开启视频信息识别，本次不用倍速。':' 倍速仅选择原生提供的最高不超过 2x 档位。';
            s.getElementById('course-report').textContent=courseReportText(report);
        };
        panelView.renderCourseRunControls=render;
        if(owner===doc) {
            courseRunner=createCourseRunner(owner,ctl);
        }
        s.getElementById('course-start').onclick=event=>{
            if(!trustedAssistantActivation(event,s.getElementById('course-start')) || !courseRunController(owner))return;
            courseRunController(owner).start({submit:takeSubmitPermission(),skipLearned:skipLearned.checked,fromCurrent:fromCurrent.checked,continueOnTimeout:timeoutNext.checked,failureProtectionEnabled:failureProtection.checked,muteVideo:muteVideo.checked,skipUnanswerable:skipUnanswerable.checked,videoQuizAuto:videoQuizAuto.checked,speedEnabled:speedEnabled.checked,...readCourseLearningSettings()});
        };
        s.getElementById('course-skip').onclick=event=>{if(trustedAssistantActivation(event,s.getElementById('course-skip')))courseRunController(owner)?.skip();};
        stopButton.onclick=event=>{
            if(!trustedAssistantActivation(event,stopButton) || !courseRunController(owner))return;
            const runId=owner?.getElementById('cx-ai-course-lease')?.getAttribute('data-run-id');
            if(!runId){clearStopConfirmation();return;}
            if(stopRunId===runId && Date.now()<stopUntil){
                clearStopConfirmation();courseRunController(owner)?.stop();return;
            }
            clearStopConfirmation();stopRunId=runId;stopUntil=Date.now()+5000;
            updateStopCountdown();stopButton.classList.add('stop-confirm');
            stopTimer=doc.defaultView.setTimeout(clearStopConfirmation,5000);
            stopCountdownTimer=doc.defaultView.setInterval(updateStopCountdown,1000);
        };
        s.getElementById('close').addEventListener('click',clearStopConfirmation);
        s.getElementById('course-copy-report').onclick=async()=>{
            try{await navigator.clipboard.writeText(safeCourseDiagnosticReport(latestReport()));ctl.report('运行安全摘要已复制');}
            catch{ctl.report('无法复制，请选中报告后复制');}
        };
        const disconnect=()=>{
            clearStopConfirmation();clearRetryConfirmation();
            s.getElementById('close').removeEventListener('click',clearRetryConfirmation);
            s.getElementById('close').removeEventListener('click',clearStopConfirmation);
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
