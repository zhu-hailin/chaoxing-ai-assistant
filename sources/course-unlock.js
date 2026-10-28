    // A separate navigation-only run: no solver, prefill, document completion or task-report request.
    function createCourseUnlockRun(owner,ctl,{limits,now,sleep,continueOnTimeout=true,failureProtectionEnabled=false}) {
        const scope=courseScoreKey(owner),key=`cx_course_unlock:${scope}`,id=crypto.randomUUID();
        const catalog=readCourseCatalog(owner),entries=catalog?.entries.filter(item=>!item.isGroup)||[];
        const report={mode:'unlock',scope,status:'running',startedAt:now(),endedAt:null,reason:'',chapters:entries.map(item=>({id:item.id,number:item.number,title:item.title,status:'unvisited',tasks:[],issues:[]}))};
        const run={id,mode:'unlock',report,cancelled:false,abort:new AbortController(),chapter:null,activeVideo:null,expected:null,expectedTab:null,navigating:false};
        run.cancelWait=new Promise(resolve=>{run.cancelWake=resolve;});
        let lease=null,claimed=false,lastSaved=0,loading=false,watchdog=null,chapterIndex=0;
        const playingDocuments=new Set();
        const pauseNativePlayback=event=>{
            if(run.cancelled||event.target?.tagName!=='VIDEO')return;
            try{guard(true);event.target.pause();}
            catch(error){run.stopError=error;run.cancelled=true;run.cancelWake();}
        };
        const protection=report.protection=courseRunProtection(null,report.chapters,0,limits.maxConsecutiveChapterFailures,failureProtectionEnabled);
        const save=()=>{
            if(claimed&&get(key,null)?.ownerId!==id)throw new Error('解锁运行锁已失效');
            set(key,{mode:'unlock',status:report.status,ownerId:id,heartbeat:now(),queue:entries.map(({id,number,title})=>({id,number,title})),report});
            claimed=true;lastSaved=now();
        };
        const notify=(message,phase='course-unlocking')=>{
            if(!lease)return;
            lease.setAttribute('data-chapter-id',run.expected||report.chapters[chapterIndex]?.id||'');
            lease.setAttribute('data-phase',phase);lease.setAttribute('data-message',message);
            lease.setAttribute('data-can-skip',String(Boolean(run.chapter&&!run.verification?.pending)));
            ctl.report(message,phase,true);owner.dispatchEvent(new owner.defaultView.Event('cx-ai-course-update'));
        };
        run.notify=notify;
        const verification=run.verification=createCourseVerification(owner,{mode:'unlock',now,notify:waiting=>{
            if(waiting)notify('等待学习通扫码核验','course-verification-wait');
        }});
        const clock=()=>now()-verification.excludedMs;
        const guard=(allowVerification=false)=>{
            if(run.cancelled)throw run.stopError||cancelledError();
            if(run.chapter?.skipped)throw Object.assign(new Error('用户跳过本章节'),{code:'CHAPTER_SKIPPED'});
            if(!scope||courseScoreKey(owner)!==scope)throw new Error('课程或账号已变化');
            if(owner.getElementById('cx-ai-course-lease')?.getAttribute('data-run-id')!==id||claimed&&get(key,null)?.ownerId!==id)throw new Error('解锁运行锁已失效');
            if(!run.navigating) {
                if(run.expected&&readCourseCatalog(owner)?.entries.find(item=>item.active&&!item.isGroup)?.id!==run.expected)throw new Error('用户切换了章节，已停止解锁');
                if(run.expectedTab&&courseTabSnapshot(owner).activeId!==run.expectedTab)throw new Error('当前栏目已变化，已停止解锁');
            }
            const tree=courseFrameTree(owner);
            for(const doc of tree.documents.slice(1)) {
                if(!playingDocuments.has(doc)){playingDocuments.add(doc);doc.addEventListener('playing',pauseNativePlayback,true);}
                for(const video of [...doc.querySelectorAll('video')].filter(courseElementVisible)) {
                    backgroundPlaybackGuard?.suppressForUnlock(video);
                    if(!video.paused)video.pause();
                }
            }
            verification.poll(tree,run.activeVideo);
            const blocker=courseBlocker(tree.documents,null,verification);
            if(blocker)throw Object.assign(new Error(blocker),{code:'COURSE_NATIVE_BLOCKER'});
            if(!loading&&!run.navigating&&tree.inaccessible.length)throw Object.assign(new Error('任务框架无法读取，请人工检查'),{code:'COURSE_FRAME_UNAVAILABLE'});
            if(verification.pending&&!allowVerification)throw courseVerificationWaitError();
            return tree;
        };
        run.validate=guard;
        const ready=async()=>{
            guard(true);
            while(verification.pending){await Promise.race([sleep(limits.pollMs),run.cancelWait,run.chapter.wait]);guard(true);}
            guard();
        };
        const wait=async ms=>{
            const deadline=clock()+ms;
            do {await ready();if(clock()>=deadline)break;await Promise.race([sleep(Math.min(limits.pollMs,deadline-clock())),run.cancelWait,run.chapter.wait]);}while(true);
            await ready();
        };
        const until=async(test,message)=>{
            const deadline=clock()+limits.loadMs;
            while(true){await ready();const value=test();if(value)return value;if(clock()>=deadline)throw courseTimeoutError(message);await wait(Math.min(limits.pollMs,deadline-clock()));}
        };
        const load=async()=>{
            loading=true;
            try {
                await until(()=>{
                    const tree=courseFrameTree(owner),fingerprint=courseContentFingerprint(owner);
                    if(!courseContentReady(owner)||!courseTabSnapshot(owner).ready||tree.inaccessible.length
                        ||tree.documents.slice(1).some(doc=>doc.readyState==='loading'||doc.querySelector('[aria-busy="true"],.ans-loading,[data-loading]')))return false;
                    try {
                        const expected=new URL(fingerprint.src,owner.URL),actual=new URL(fingerprint.doc.URL);
                        return expected.origin===actual.origin&&expected.pathname===actual.pathname
                            &&['courseid','clazzid','knowledgeid','num'].every(name=>expected.searchParams.get(name)===actual.searchParams.get(name));
                    }catch{return false;}
                },'解锁时等待栏目加载超时');
                await wait(limits.settleMs);
            } finally {loading=false;}
        };
        const inspectVideo=async(video,task)=>{
            run.activeVideo=video;
            const onPlaying=()=>{if(!run.cancelled&&video.isConnected)video.pause();};
            // Disarm standalone continuous playback before the first pause.
            const release=backgroundPlaybackGuard?.activate({video,suppressPlayback:true,canProtect:()=>false,onSuppressed:()=>{}})||(()=>{});
            run.releaseVideoProtection=release;
            video.addEventListener('playing',onPlaying);
            try {
                await ready();
                if(!video.isConnected)throw new Error('视频控件已替换，请重新确认任务');
                const button=courseVideoStartButton(video);
                if(!button){task.status='pending';task.reason='没有唯一的原生播放入口，留待人工触发';await wait(2000);return;}
                const passes=verification.passes;
                guard();button.click();
                guard(true);if(!video.paused)video.pause();
                const deadline=clock()+2000;
                while(true) {
                    await ready();
                    if(!video.isConnected)throw new Error('视频控件已替换，请重新确认任务');
                    if(!video.paused)video.pause();
                    if(verification.passes>passes){task.status='verified';return;}
                    if(clock()>=deadline){task.status='visited';return;}
                    await wait(Math.min(limits.pollMs,deadline-clock()));
                }
            } finally {
                video.removeEventListener('playing',onPlaying);if(video.isConnected&&!video.paused)video.pause();
                release();if(run.releaseVideoProtection===release)run.releaseVideoProtection=null;run.activeVideo=null;
            }
        };
        const visitChapter=async record=>{
            let entry=courseRequireChapterAccess(owner,record);
            run.expected=entry.id;run.expectedTab=null;run.navigating=true;
            const before=courseContentFingerprint(owner),access=courseChapterAccess(owner,entry);
            try {
                if(!access.current) {
                    guard();entry=courseRequireChapterAccess(owner,record);entry.target.click();
                    await until(()=>readCourseCatalog(owner)?.entries.some(item=>item.id===entry.id&&item.active)
                        &&courseContentChanged(before,courseContentFingerprint(owner)),'章节内容未成功切换');
                }
                await load();
            } finally {run.navigating=false;}
            const visited=new Set();
            while(true) {
                await ready();const state=courseTabSnapshot(owner);
                if(!state.ready)throw new Error('栏目状态无法确认，已停止解锁');
                const tabs=state.tabs.length?state.tabs:[{id:'current',title:'当前页面',active:true}],tab=tabs.find(item=>!visited.has(item.id));
                if(!tab)break;
                if(tab.disabled)throw new Error('章节栏目尚未解锁，请先处理平台前置任务');
                if(tab.id!=='current'&&!tab.active) {
                    run.expectedTab=null;run.navigating=true;
                    try {
                        guard();const live=courseTabSnapshot(owner).tabs.find(item=>item.id===tab.id);
                        if(!live?.node?.isConnected||live.disabled)throw new Error('栏目原生入口已变化');
                        live.node.click();
                        await until(()=>courseTabSnapshot(owner).activeId===tab.id,'栏目内容未成功切换');await load();
                    } finally {run.navigating=false;}
                }
                run.expectedTab=tab.id==='current'?null:tab.id;
                notify(`正在解锁：${record.number} ${record.title} · ${tab.title}`);
                const processed=new Set();let found=false,observedEmpty=false;
                while(true) {
                    await ready();const tree=guard();
                    const items=coursePageTasks(tree).filter(item=>courseTaskRequired(item.node)!==false);
                    const item=items.find(item=>!processed.has(item.node));
                    if(!item) {
                        if(!found&&!observedEmpty){observedEmpty=true;await wait(2000);continue;}
                        break;
                    }
                    found=true;
                    const task={tab:tab.id,type:item.type,status:'pending'};record.tasks.push(task);
                    if(courseTaskComplete(item.node)===true||item.type==='quiz'&&courseQuizComplete(item.doc))task.status='already';
                    else if(item.type==='video')await inspectVideo(item.node,task);
                    else {
                        const passes=verification.passes;await wait(2000);
                        task.status=verification.passes>passes?'verified':'visited';
                    }
                    processed.add(item.node);save();
                }
                if(!found) {
                    const unknown=coursePageHasTaskPoints(courseFrameTree(owner));
                    record.tasks.push({tab:tab.id,type:'page',status:unknown?'pending':'visited',...(unknown?{reason:'页面存在未识别任务点，已打开，留待人工确认'}:{})});
                }
                await ready();visited.add(tab.id);save();
            }
            record.status=record.tasks.some(task=>task.status==='pending')?'pending':record.tasks.some(task=>task.status==='verified')?'verified':'visited';
        };
        const onUnload=()=>{run.cancelled=true;run.stopError=cancelledError();run.cancelWake();};
        run.start=async()=>{
            try {
                if(!scope||studyOwnerDocument(owner)!==owner||!owner.querySelector('#mainid #iframe')||!entries.length)throw new Error('请在目录已就绪的课程学习页面解锁课程');
                const other=get(`cx_course_run:${scope}`,null),previous=get(key,null);
                if([other,previous].some(item=>item?.status==='running'&&now()-item.heartbeat<15000))throw new Error('另一个页面正在运行本课程，请先停止该页面');
                lease=owner.getElementById('cx-ai-course-lease');
                if(!lease){lease=owner.createElement('span');lease.id='cx-ai-course-lease';lease.hidden=true;owner.body.append(lease);}
                lease.setAttribute('data-run-id',id);lease.setAttribute('data-mode','unlock');ctl.state.busy=true;save();
                owner.defaultView.addEventListener('pagehide',onUnload,{once:true});
                watchdog=owner.defaultView.setInterval(()=>{
                    try{guard(true);if(now()-lastSaved>2500)save();}
                    catch(error){if(error.code==='CHAPTER_SKIPPED')return;run.stopError=error;run.cancelled=true;run.cancelWake();}
                },limits.pollMs);
                for(;chapterIndex<report.chapters.length;chapterIndex++) {
                    const record=report.chapters[chapterIndex];
                    run.chapter={abort:new AbortController(),skipped:false,submitting:false};
                    run.chapter.wait=new Promise(resolve=>{run.chapter.wake=resolve;});
                    try {
                        if(run.cancelled)throw run.stopError||cancelledError();
                        if(courseScoreKey(owner)!==scope)throw new Error('课程或账号已变化');
                        const entry=readCourseCatalog(owner)?.entries.find(item=>item.id===record.id);
                        if(!entry?.node?.isConnected)throw new Error('课程目录发生变化，已停止解锁');
                        if(entry.completed===true){record.status='already';protection.consecutiveFailures=0;continue;}
                        await ready();
                        record.status='running';await visitChapter(record);protection.consecutiveFailures=0;
                    } catch(error) {
                        if(run.chapter.skipped){record.status='skipped';record.reason='用户跳过本章节';}
                        else if(continueOnTimeout&&['COURSE_TIMEOUT','TIMEOUT'].includes(error.code)) {
                            record.status='timed-out';record.reason=error.message;protection.consecutiveFailures++;
                        } else throw error;
                        for(const task of record.tasks.filter(task=>task.status==='pending'))task.reason ||= record.reason;
                    } finally {
                        run.chapter.abort.abort();run.chapter=null;run.activeVideo?.pause();run.activeVideo=null;
                        run.expected=null;run.expectedTab=null;run.navigating=false;save();
                    }
                    if(protection.enabled&&protection.consecutiveFailures>=protection.limit){protection.triggered=true;throw courseFailureLimitError(protection.limit);}
                }
                report.status='done';
            } catch(error) {
                report.status='stopped';report.reason=error.message;report.stopCode=error.code||'COURSE_UNLOCK_STOPPED';
                const record=report.chapters[chapterIndex];
                if(record&&['running','unvisited'].includes(record.status)){record.status='stopped';record.reason=error.message;}
                for(const task of record?.tasks||[])if(task.status==='pending')task.reason ||= error.message;
            }
            finally {
                run.activeVideo?.pause();run.releaseVideoProtection?.();verification.close();
                for(const doc of playingDocuments)doc.removeEventListener('playing',pauseNativePlayback,true);
                playingDocuments.clear();
                if(watchdog!==null)owner.defaultView.clearInterval(watchdog);
                owner.defaultView.removeEventListener('pagehide',onUnload);
                report.endedAt=now();if(claimed)try{save();}catch{report.status='stopped';report.stopCode='COURSE_SAVE_FAILED';report.reason+='；解锁记录保存失败';}
                if(lease?.getAttribute('data-run-id')===id){lease.removeAttribute('data-run-id');lease.removeAttribute('data-mode');}
                ctl.state.busy=false;ctl.report(courseReportText(report),report.status==='done'?'done':'error',false);
                owner.dispatchEvent(new owner.defaultView.Event('cx-ai-course-update'));
            }
            return report;
        };
        return run;
    }
