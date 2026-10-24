    // A tab-bound outer queue. Chapter execution and all native task actions stay in course-runner.
    const COURSE_QUEUE_PREFIX='cx_course_queue:';
    const COURSE_QUEUE_ACTIVE=['navigating-course','starting-course','running','returning','skipping'];
    let courseQueueRuntime=null;
    function courseQueueRecord() {
        const runtime=courseQueueRuntime;
        if(!runtime?.id||!runtime.tab)return null;
        const record=get(COURSE_QUEUE_PREFIX+runtime.id,null);
        return record?.id===runtime.id&&record.ownerTab===runtime.tab.cxCourseTabId&&Array.isArray(record.items)
            &&Number.isSafeInteger(record.index)&&record.index>=0&&record.index<=record.items.length?record:null;
    }
    function courseQueueActive(record=courseQueueRecord()) {return Boolean(record&&COURSE_QUEUE_ACTIVE.includes(record.phase));}
    function courseQueueIntermediate(url) {
        return Boolean(url&&(isCourseStudyHost(url.hostname)||url.hostname==='mooc2-ans.chaoxing.com')
            &&['/visit/stucoursemiddle','/mycourse/transfer'].includes(url.pathname));
    }
    function courseQueueWrite(record,patch) {
        const latest=courseQueueRecord();
        if(!latest||latest.id!==record.id||latest.turn!==record.turn)return null;
        const next={...latest,...patch,updatedAt:Date.now()};set(COURSE_QUEUE_PREFIX+next.id,next);return next;
    }
    function courseQueueNotify() {
        const runtime=courseQueueRuntime;
        if(!runtime||runtime.closed)return;
        document.dispatchEvent(new Event('cx-ai-course-queue-update'));
    }
    function courseQueuePacing(value) {
        return {activeMs:Number.isFinite(value?.activeMs)?Math.max(0,Math.min(value.activeMs,31536000000)):0,
            restUntil:Number.isFinite(value?.restUntil)&&value.restUntil<=Date.now()+3600000?value.restUntil:null};
    }
    function courseQueueToken(record=courseQueueRecord()) {
        return record?{id:record.id,turn:record.turn,index:record.index}:null;
    }
    function courseQueueTokenMatches(token,record=courseQueueRecord()) {
        return Boolean(token&&record&&token.id===record.id&&token.turn===record.turn&&token.index===record.index);
    }
    function courseQueueValidContext(token,doc=document) {
        const record=courseQueueRecord(),item=record?.items[record.index];
        if(!courseQueueTokenMatches(token,record)||!courseQueueActive(record)||!item||record.model!==courseHomeModelSignature())return false;
        const identity=isCourseHomeURL(pageURL(doc))?courseHomeIdentity(doc):courseStudyContext(doc);
        if(sameCourseHomeIdentity(identity,item.identity))return true;
        // Missing cpi may be supplied by the still-loading native cards; conflicts never qualify.
        return isCourseStudyURL(pageURL(doc))&&['starting-course','running'].includes(record.phase)
            &&identity.reason==='identity-incomplete'&&identity.course===item.identity.course&&identity.classroom===item.identity.classroom
            &&!identity.student;
    }
    function courseQueueStop(message='已停止课程队列') {
        const record=courseQueueRecord();if(!courseQueueActive(record))return;
        courseQueueWrite(record,{phase:'stopped',message,submitAuthorized:false,endedAt:Date.now()});
        if(record.launchId)courseHomeFail(record.launchId,message,'cancelled');
        courseQueueRuntime.home?.cancel();
        courseQueueRuntime.ctl?.report(message,'idle',false);courseQueueNotify();
    }
    function courseQueueAttachLaunch(token,id) {
        const record=courseQueueRecord();
        if(!courseQueueValidContext(token)||!courseQueueTokenMatches(token,record))throw new Error('课程队列已取消或身份已变化');
        courseQueueWrite(record,{launchId:id,phase:'starting-course'});
    }
    function courseQueueCheckRun(run,owner) {
        if(run.queueContext&&!courseQueueValidContext(run.queueContext,owner))
            throw Object.assign(new Error('课程队列已停止或课程身份已变化'),{code:'COURSE_QUEUE_CANCELLED'});
    }
    function courseQueueRunStarted(run,owner) {
        if(!run.queueContext)return;
        courseQueueCheckRun(run,owner);
        const record=courseQueueRecord();
        const items=record.items.map((item,index)=>index===record.index?{...item,status:'running'}:item);
        courseQueueWrite(record,{phase:'running',items,runId:run.id,deadline:Date.now()+COURSE_HOME_TTL});
        courseQueueRuntime.expectedLeave=false;courseQueueNotify();
    }
    function courseQueueRunLeaving(run) {
        if(!run.queueContext||!courseQueueTokenMatches(run.queueContext))return;
        if(run.handoff)courseQueueWrite(courseQueueRecord(),{pacing:courseQueuePacing(run.pacing),deadline:Date.now()+COURSE_HOME_TTL});
        else courseQueueStop('页面已离开或刷新，课程队列已停止');
    }
    function courseQueueUnsafeReport(report) {
        return Boolean(report?.chapters?.some(chapter=>chapter.tasks?.some(task=>task.videoQuizUnconfirmed
            ||task.submissionStarted&&task.status!=='done')));
    }
    function courseQueueOutcome(report,record) {
        if(!report)return {advance:false,status:'failed',reason:'自动学习未启动，请查看当前页面状态'};
        if(report.protection?.triggered||courseQueueUnsafeReport(report))return {advance:false,status:'failed',reason:report.reason||'存在需要人工确认的任务结果'};
        if(report.stopCode==='COURSE_NATIVE_BLOCKER')return {advance:false,status:'failed',reason:report.reason};
        if(report.navigationBoundary?.status==='sequence-locked')return {advance:true,status:'waiting-unlock',reason:report.reason};
        if(report.navigationBoundary)return {advance:false,status:'failed',reason:report.reason};
        if(report.status==='done') {
            const chapters=report.chapters||[],complete=chapters.length>0&&chapters.every(item=>['already','done','no-tasks'].includes(item.status));
            return {advance:true,status:complete?'completed':'pending',reason:complete?'任务点已完成':'本轮已处理，仍有待办'};
        }
        if(['COURSE_TIMEOUT','TIMEOUT'].includes(report.stopCode)&&record.options.continueOnTimeout)
            return {advance:true,status:'pending',reason:report.reason};
        return {advance:false,status:'failed',reason:report.reason||'自动学习已停止'};
    }
    function courseQueueReturn(record) {
        const runtime=courseQueueRuntime;
        if(!runtime||runtime.closed||!courseQueueActive(record))return;
        const url=new URL(record.returnURL);
        if(url.origin!=='https://i.chaoxing.com'||url.pathname!=='/base'){courseQueueStop('课程列表返回地址已失效');return;}
        courseQueueWrite(record,{phase:'returning',deadline:Date.now()+COURSE_HOME_TTL,launchId:null});
        runtime.expectedLeave=true;location.assign(url.href);
    }
    async function courseQueueFinish(token,report,override=null) {
        let record=courseQueueRecord();
        if(!courseQueueTokenMatches(token,record)||!courseQueueActive(record)||courseQueueRuntime.closed)return;
        if(report?.status==='running')return; // A chapter handoff is still the same course run.
        if(isCourseStudyURL(pageURL(document))&&(courseRunController(document)?.busy||courseRunActive(document)))return;
        const blocker=isCourseStudyURL(pageURL(document))?courseBlocker(courseFrameTree(document).documents):null;
        const result=blocker?{advance:false,status:'failed',reason:blocker}:override||courseQueueOutcome(report,record),items=record.items.map((item,index)=>index===record.index
            ?{...item,status:result.status,reason:result.reason,report:report||null}:item);
        record=courseQueueWrite(record,{items,pacing:report?.pacing?courseQueuePacing(report.pacing):record.pacing,message:result.reason});
        if(!record)return;
        if(!result.advance){courseQueueStop(result.reason);return;}
        record=courseQueueWrite(record,{index:record.index+1,turn:crypto.randomUUID(),runId:null,launchId:null});
        courseQueueReturn(record);
    }
    async function courseQueueRunFinished(token,report) {
        const record=courseQueueRecord();
        if(!courseQueueTokenMatches(token,record))return;
        if(record.phase==='skipping')return courseQueueFinish(token,report,{advance:true,status:'skipped',reason:'用户跳过本课程'});
        return courseQueueFinish(token,report);
    }
    async function courseQueueReady() {return courseQueueRuntime?.ready;}
    function initCourseQueueTransport() {
        if(window!==window.top||courseQueueRuntime)return;
        const url=pageURL(document);
        if(!url||!['i.chaoxing.com','mooc2-ans.chaoxing.com'].includes(url.hostname)&&!isCourseStudyHost(url.hostname))return;
        const runtime=courseQueueRuntime={tab:null,id:null,closed:false,expectedLeave:false,working:false,selected:new Set(),ctl:null,home:null};
        runtime.ready=(async()=>{
            try {
                runtime.tab=await courseHomeTab();
                const fresh=await courseHomeTabRead();runtime.id=courseHomeUUID(fresh.cxCourseQueueId)?fresh.cxCourseQueueId:null;
                if(runtime.closed)return;
                const record=courseQueueRecord();
                if(courseQueueActive(record)&&Date.now()-record.updatedAt>86400000)courseQueueStop('课程队列记录已过期，请重新开始');
                if(courseQueueActive(record)&&!isCourseListPage()&&!isCourseHomeURL(url)&&!isCourseStudyURL(url)) {
                    const native=courseQueueIntermediate(url)&&['navigating-course','starting-course'].includes(record.phase);
                    if(!native)courseQueueStop('已离开课程队列的原生导航流程');
                    else runtime.deadlineTimer=setTimeout(()=>{
                        courseQueueStop('原生课程入口未完成跳转，请检查当前页面');
                        if(document.body&&!panelView) {
                            if(!controller)controller=createAssistantController();
                            createAssistantPanel(document,controller);controller.openPanel('chapters');
                            controller.report('原生课程入口未完成跳转，请检查当前页面','error',false);
                        }
                    },Math.max(0,record.deadline-Date.now()));
                }
                if(runtime.id)runtime.listener=GM_addValueChangeListener(COURSE_QUEUE_PREFIX+runtime.id,()=>courseQueueNotify());
                courseQueueNotify();
            }catch{}
        })();
        window.addEventListener('pagehide',()=>{
            const record=courseQueueRecord();
            const launching=record?.phase==='starting-course'&&['preparing','navigating','waiting','consumed','started'].includes(courseHomeRecord(record.launchId)?.status);
            const intermediate=courseQueueIntermediate(pageURL(document))&&['navigating-course','starting-course'].includes(record?.phase);
            if(courseQueueActive(record)&&record.phase!=='running'&&!runtime.expectedLeave&&!launching&&!intermediate)courseQueueStop('页面已离开，课程队列已停止');
            runtime.closed=true;clearInterval(runtime.timer);
            clearTimeout(runtime.deadlineTimer);
            if(runtime.listener!==undefined)GM_removeValueChangeListener(runtime.listener);
        },{once:true});
    }
    function createCourseQueueAdapter(doc,ctl,view,home) {
        if(doc.defaultView!==doc.defaultView.top||!courseQueueRuntime)return null;
        const runtime=courseQueueRuntime;runtime.ctl=ctl;runtime.home=home;
        const list=isCourseListPage(doc);
        const api={
            get record(){return courseQueueRecord();},get list(){return list;},get active(){return courseQueueActive();},
            get available(){const snapshot=courseListSnapshot();return Boolean(runtime.tab&&list&&snapshot?.ready&&snapshot.items.some(item=>runtime.selected.has(item.key)&&courseListItemSelectable(item)));},
            get selected(){return runtime.selected;},
            async start(options,retry=false) {
                if(api.active||runtime.working||ctl.state.busy)return;
                runtime.working=true;
                try {
                    await runtime.ready;
                    const snapshot=courseListSnapshot();
                    if(!snapshot?.ready)throw new Error('课程列表尚未加载，请稍候');
                    const previous=api.record,chosen=retry?previous?.items.filter(item=>!['completed','no-tasks'].includes(item.status)):snapshot.items.filter(item=>runtime.selected.has(item.key));
                    if(!chosen?.length)throw new Error('请选择本次课程');
                    for(const item of chosen){
                        const current=snapshot.items.find(entry=>entry.key===item.key&&sameCourseHomeIdentity(entry.identity,item.identity));
                        if(item.ended||!current||current.ended)throw new Error('所选课程或账号已变化，请重新选择');
                        if(!retry&&!courseListItemSelectable(current))throw new Error('所选课程当前无任务点，请重新选择');
                    }
                    const id=crypto.randomUUID(),items=retry?previous.items.map(item=>['completed','no-tasks'].includes(item.status)?item:{...item,status:'waiting',reason:'',report:null})
                        :chosen.map(({href,...item})=>({...item,status:'waiting',reason:'',report:null}));
                    const record={id,ownerTab:runtime.tab.cxCourseTabId,turn:crypto.randomUUID(),index:0,items,
                        phase:'returning',returnURL:pageURL(doc).href,options:courseHomeOptions({...options,submit:false}),model:courseHomeModelSignature(),
                        submitAuthorized:options.submit===true&&JSON.stringify(options.submitScope)===JSON.stringify(chosen.map(item=>item.key).sort()),
                        pacing:courseQueuePacing(null),createdAt:Date.now(),updatedAt:Date.now(),deadline:Date.now()+COURSE_HOME_TTL,message:'正在准备课程队列'};
                    const tab=await courseHomeTabRead();tab.cxCourseQueueId=id;await courseHomeSaveTab(tab);
                    if(runtime.closed)return;
                    if(runtime.listener!==undefined)GM_removeValueChangeListener(runtime.listener);
                    runtime.id=id;set(COURSE_QUEUE_PREFIX+id,record);
                    runtime.listener=GM_addValueChangeListener(COURSE_QUEUE_PREFIX+id,()=>courseQueueNotify());
                    if(previous)GM_deleteValue(COURSE_QUEUE_PREFIX+previous.id);
                    courseQueueNotify();
                }catch(error){ctl.report(error.message,'error',false);}finally{runtime.working=false;}
            },
            stop(){if(!api.active)return;courseQueueStop();home?.cancel();courseRunController(doc)?.stop('用户停止课程队列');},
            get canSkip(){return api.active&&!courseQueueUnsafeReport(courseRunController(doc)?.report)
                &&(!courseRunController(doc)?.busy||courseRunController(doc).canSkip);},
            skip(){
                const record=api.record;if(!api.canSkip||!record)return;
                courseQueueWrite(record,{phase:'skipping',message:'正在跳过本课程'});
                const runner=courseRunController(doc);
                if(runner?.busy)runner.stop('用户跳过本课程');
                else {home?.cancel();courseQueueFinish(courseQueueToken(record),null,{advance:true,status:'skipped',reason:'用户跳过本课程'});}
            }
        };
        runtime.api=api;
        const tick=async()=>{
            if(runtime.closed||runtime.working)return;
            const record=api.record;if(!api.active)return;
            runtime.working=true;
            try {
                if(record.model!==courseHomeModelSignature())throw new Error('模型设置已变化，课程队列已停止');
                const item=record.items[record.index];
                if(list) {
                    if(record.phase!=='returning')throw new Error('已返回课程列表，原课程队列已停止');
                    const snapshot=courseListSnapshot();
                    if(!snapshot?.ready){if(Date.now()>record.deadline)throw new Error('课程列表加载超时');return;}
                    let index=record.index;
                    while(index<record.items.length&&['completed','no-tasks'].includes(record.items[index].status))index++;
                    if(index!==record.index){courseQueueWrite(record,{index});return;}
                    if(!item){courseQueueWrite(record,{phase:'done',message:'课程队列已结束',submitAuthorized:false,endedAt:Date.now()});ctl.openPanel('chapters');view.shadow.getElementById('course-queue-selection').open=false;ctl.report('课程队列已结束','done',false);return;}
                    const fresh=await resolveCourseListEntry(item);
                    if(!courseQueueTokenMatches(courseQueueToken(record))||!api.active)return;
                    if(record.options.skipLearned&&fresh.total>0&&fresh.completed===fresh.total){
                        const items=record.items.map((entry,i)=>i===record.index?{...entry,status:'completed',reason:'平台任务点已完成',completed:fresh.completed,total:fresh.total}:entry);
                        courseQueueWrite(record,{items,index:record.index+1,turn:crypto.randomUUID()});return;
                    }
                    courseQueueWrite(record,{phase:'navigating-course',deadline:Date.now()+COURSE_HOME_TTL,message:`正在进入：${item.title}`});
                    runtime.expectedLeave=true;location.assign(fresh.href);return;
                }
                if(!item){if(Date.now()>record.deadline)throw new Error('课程队列返回列表超时');return;}
                if(isCourseHomeURL(pageURL(doc))) {
                    if(!sameCourseHomeIdentity(courseHomeIdentity(doc),item.identity))throw new Error('到达的课程或账号与队列不一致');
                    const blocker=courseHomeBlocker(doc);if(blocker)throw new Error(blocker);
                    if(record.phase==='navigating-course'&&home?.available&&!home.pending&&!home.active) {
                        courseQueueWrite(record,{phase:'starting-course'});
                        const launch=await home.start({...record.options,submit:record.submitAuthorized===true,queueContext:courseQueueToken(record),queuePacing:record.pacing});
                        if(!launch&&!home.pending)throw new Error(ctl.state.message||'课程启动交接未创建，请检查原生入口');
                        return;
                    }
                    if(record.phase==='starting-course'&&record.launchId) {
                        const launch=courseHomeRecord(record.launchId);
                        if(launch?.status==='complete'&&!home.pending){await courseQueueFinish(courseQueueToken(record),null,{advance:true,status:launch.emptyCourse?'no-tasks':'completed',reason:launch.message});return;}
                        if(launch?.status==='blocked'&&launch.navigationBoundary?.status==='sequence-locked'&&!home.pending){await courseQueueFinish(courseQueueToken(record),null,{advance:true,status:'waiting-unlock',reason:launch.message});return;}
                        if(['failed','cancelled','blocked'].includes(launch?.status))throw new Error(launch.message);
                    }
                } else if(isCourseStudyURL(pageURL(doc))) {
                    const identity=courseStudyContext(doc);
                    if(identity.complete&&!sameCourseHomeIdentity(identity,item.identity))throw new Error('学习页面的课程或账号与队列不一致');
                    if(record.phase==='running'&&courseRunController(doc)?.busy)return;
                } else if(!courseQueueIntermediate(pageURL(doc))) {
                    throw new Error('已离开课程队列的原生导航流程');
                }
                if(Date.now()>record.deadline)throw new Error('课程启动或恢复超时，请检查当前页面');
            }catch(error){courseQueueStop(error.message);courseRunController(doc)?.stop(error.message);}
            finally{runtime.working=false;courseQueueNotify();}
        };
        runtime.timer=setInterval(tick,500);
        runtime.ready.then(()=>{tick();courseQueueNotify();});
        return api;
    }
