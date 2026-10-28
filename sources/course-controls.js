    // 课程面板控件与状态展示；课程执行逻辑保留在 course-runner.js。
    function coursePanelStatusMessage(state, doc = document) {
        const queue=courseQueueRecord();
        if(courseQueueActive(queue)&&!courseRunActive(doc))return queue.message||'课程队列运行中';
        const owner=studyOwnerDocument(doc),scope=owner&&courseScoreKey(owner);
        const report=courseRunner?.report || (scope?get(`cx_course_run:${scope}`,null)?.report:null);
        if(report?.mode==='unlock'&&state.message===courseReportText(report))return report.status==='running'?'正在遍历解锁课程':report.status==='done'?'解锁遍历结束':'解锁已停止';
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
    function initCourseRunControls(doc, ctl, view) {
        const owner=studyOwnerDocument(doc),s=view.shadow;
        const home=view.courseHomeLauncher=createCourseHomeLauncher(doc,ctl);
        const queue=view.courseQueue=createCourseQueueAdapter(doc,ctl,view,home);
        const canStart=()=>queue?.list?queue.available:Boolean(courseRunController(owner)||home?.available);
        const stopButton=s.getElementById('course-stop');
        const unlockButton=s.getElementById('course-unlock');
        let stopRunId=null,stopUntil=0,stopTimer=null,stopCountdownTimer=null;
        const clearStopConfirmation=()=>{
            if(stopTimer!==null)doc.defaultView?.clearTimeout(stopTimer);
            if(stopCountdownTimer!==null)doc.defaultView?.clearInterval(stopCountdownTimer);
            stopTimer=null;stopCountdownTimer=null;stopRunId=null;stopUntil=0;
            stopButton.textContent=home?.pending?'取消启动':'停止';stopButton.classList.remove('stop-confirm');
        };
        view.clearStopConfirmation=clearStopConfirmation;
        const updateStopCountdown=()=>{
            if(!stopRunId)return;
            const seconds=Math.ceil((stopUntil-Date.now())/1000);
            if(seconds<=0){clearStopConfirmation();return;}
            stopButton.textContent=`确认停止（${seconds}s）`;
        };
        const skipLearned=s.getElementById('course-skip-learned'),fromCurrent=s.getElementById('course-from-current'),timeoutNext=s.getElementById('course-timeout-next'),muteVideo=s.getElementById('course-mute-video'),skipUnanswerable=s.getElementById('course-skip-unanswerable'),videoQuizAuto=s.getElementById('course-video-quiz-auto'),speedEnabled=s.getElementById('course-speed-enabled');
        const autoSubmit=s.getElementById('course-auto-submit');
        const forcePlayback=s.getElementById('course-force-playback'),videoPause=s.getElementById('course-video-pause');
        forcePlayback.checked=courseForcePlaybackEnabled();
        forcePlayback.onchange=event=>{
            if(!trustedAssistantActivation(event,forcePlayback,'change')){forcePlayback.checked=courseForcePlaybackEnabled();return;}
            set('cx_course_force_playback',forcePlayback.checked);backgroundPlaybackGuard?.refresh();render();
        };
        videoPause.onclick=event=>{
            if(!trustedAssistantActivation(event,videoPause))return;
            try {backgroundPlaybackGuard?.togglePause();}catch(error){ctl.report(error.message,'error');}
            render();
        };
        const delayEnabled=s.getElementById('course-video-delay-enabled'),delayMode=s.getElementById('course-video-delay-mode'),
            delayFixed=s.getElementById('course-video-delay-fixed'),delayMin=s.getElementById('course-video-delay-min'),delayMax=s.getElementById('course-video-delay-max');
        const renderDelay=()=>{
            const cfg=queue?.active?courseVideoDelaySettings(queue.record.options.videoDelay):readCourseVideoDelaySettings(),random=cfg.mode==='random';
            delayEnabled.checked=cfg.enabled;delayMode.value=cfg.mode;delayFixed.value=cfg.fixedSeconds;delayMin.value=cfg.minSeconds;delayMax.value=cfg.maxSeconds;
            s.getElementById('course-video-delay-fields').hidden=!cfg.enabled;
            delayFixed.hidden=random;s.getElementById('course-video-delay-random').hidden=!random;
            s.getElementById('course-video-delay-value').textContent=random?`${cfg.minSeconds}–${cfg.maxSeconds} 秒`:`${cfg.fixedSeconds} 秒`;
            s.getElementById('course-video-delay-random').style.setProperty('--delay-min',`${cfg.minSeconds/60*100}%`);
            s.getElementById('course-video-delay-random').style.setProperty('--delay-max',`${cfg.maxSeconds/60*100}%`);
            delayMin.style.zIndex=cfg.minSeconds===60?'3':'';
            for(const control of [delayEnabled,delayMode,delayFixed,delayMin,delayMax])setAssistantControlDisabled(control,courseRunActive(doc)||queue?.active||ctl.state.busy,'任务运行中，请结束后再修改视频间隔');
        };
        for(const [control,field,type] of [[delayEnabled,'enabled','change'],[delayMode,'mode','change'],[delayFixed,'fixedSeconds','input'],[delayMin,'minSeconds','input'],[delayMax,'maxSeconds','input']]) {
            control.addEventListener(type,event=>{
                if(!trustedAssistantActivation(event,control,type)||courseRunActive(doc)||queue?.active||ctl.state.busy){renderDelay();return;}
                const cfg=readCourseVideoDelaySettings();
                cfg[field]=field==='enabled'?control.checked:field==='mode'?control.value:Number(control.value);
                if(field==='minSeconds')cfg.minSeconds=Math.min(cfg.minSeconds,cfg.maxSeconds);
                if(field==='maxSeconds')cfg.maxSeconds=Math.max(cfg.maxSeconds,cfg.minSeconds);
                set('cx_course_video_delay',courseVideoDelaySettings(cfg));renderDelay();
            });
        }
        const failureProtection=s.getElementById('course-failure-protection');
        failureProtection.checked=get('cx_course_failure_protection_enabled',false)===true;
        failureProtection.onchange=event=>{
            if(!trustedAssistantActivation(event,failureProtection,'change')||courseRunActive(doc)||queue?.active||ctl.state.busy){render();return;}
            set('cx_course_failure_protection_enabled',failureProtection.checked);render();
        };
        const restEnabled=s.getElementById('course-rest-enabled'),studyMinutes=s.getElementById('course-study-minutes'),restMinutes=s.getElementById('course-rest-minutes');
        const renderLearningFields=()=>{
            const cfg=queue?.active?courseLearningSettings(queue.record.options):readCourseLearningSettings();restEnabled.checked=cfg.restEnabled;studyMinutes.value=cfg.studyMinutes;restMinutes.value=cfg.restMinutes;
        };
        renderLearningFields();
        for(const [control,key,field] of [[restEnabled,'cx_course_rest_enabled','restEnabled'],[studyMinutes,'cx_course_study_minutes','studyMinutes'],[restMinutes,'cx_course_rest_minutes','restMinutes']])control.onchange=()=>{
            if(courseRunActive(doc)||queue?.active||ctl.state.busy){renderLearningFields();return;}
            const value=field==='restEnabled'?control.checked:Number(control.value);
            const cfg=courseLearningSettings({...readCourseLearningSettings(),[field]:value});
            s.getElementById('course-learning-message').textContent=cfg[field]!==value?'请输入范围内的整数，已恢复默认值。':'学习设置已保存';
            set(key,cfg[field]);renderLearningFields();
        };
        for(const [control,key,fallback] of [[skipLearned,'cx_course_skip_learned',true],[fromCurrent,'cx_course_from_current',false],[timeoutNext,'cx_course_timeout_next',true],[muteVideo,'cx_course_mute_video',true],[skipUnanswerable,'cx_course_skip_unanswerable',false],[videoQuizAuto,'cx_course_video_quiz_auto',true],[speedEnabled,'cx_course_speed_enabled',false]]) {
            control.checked=get(key,fallback)===true;
            control.onchange=()=>{if(courseRunActive(doc)||queue?.active||ctl.state.busy){render();return;}set(key,control.checked);render();};
        }
        // 独立的新偏好键；不继承旧版一次性授权或运行记录。
        const submitPreferenceKey='cx_course_submit_preference_v1';
        const submitPreference=()=>get(submitPreferenceKey,false)===true;
        autoSubmit.checked=submitPreference();
        autoSubmit.onchange=event=>{
            if(!trustedAssistantActivation(event,autoSubmit,'change') || !canStart()||courseRunActive(doc)||queue?.active||ctl.state.busy){autoSubmit.checked=submitPreference();return;}
            const enabling=autoSubmit.checked===true;
            const allowed=!enabling||assistantConfirm('开启后会记住自动提交章节测验的设置，后续课程及切换账号也会沿用。AI 答案可能错误，是否开启？')===true;
            if(!courseRunActive(doc)&&!ctl.state.busy&&allowed)set(submitPreferenceKey,enabling);
            autoSubmit.checked=submitPreference();
        };
        const takeSubmitPermission=()=>submitPreference();
        skipUnanswerable.onchange=()=>{
            if(courseRunActive(doc)||queue?.active||ctl.state.busy){skipUnanswerable.checked=get('cx_course_skip_unanswerable',false)===true;return;}
            set('cx_course_skip_unanswerable',skipUnanswerable.checked);render();
        };
        videoQuizAuto.onchange=event=>{
            if(!trustedAssistantActivation(event,videoQuizAuto,'change')||courseRunActive(doc)||queue?.active||ctl.state.busy){videoQuizAuto.checked=get('cx_course_video_quiz_auto',true)!==false;return;}
            set('cx_course_video_quiz_auto',videoQuizAuto.checked);render();
        };
        speedEnabled.onchange=event=>{
            if(!trustedAssistantActivation(event,speedEnabled,'change')||courseRunActive(doc)||queue?.active||ctl.state.busy){speedEnabled.checked=get('cx_course_speed_enabled',false)===true;return;}
            set('cx_course_speed_enabled',speedEnabled.checked);render();
        };
        const latestReport=()=>courseRunner?.report || (owner&&courseScoreKey(owner)?get(`cx_course_run:${courseScoreKey(owner)}`,null)?.report:null);
        const retryButton=s.getElementById('course-retry'),retryConfirm=s.getElementById('course-retry-confirm'),retryMessage=s.getElementById('course-retry-message');
        let retryToken=null;
        const clearRetryConfirmation=()=>{retryToken=null;retryConfirm.hidden=true;retryMessage.textContent='';};
        view.clearRetryConfirmation=clearRetryConfirmation;
        const retryCandidate=()=>owner&&courseScoreKey(owner)?courseRetryCandidate(owner,get(`cx_course_run:${courseScoreKey(owner)}`,null)):{allowed:false,reason:'仅课程学习页面支持重试'};
        retryButton.onclick=event=>{
            if(queue?.list){if(trustedAssistantActivation(event,retryButton)&&!queue.active)queue.start(readRunOptions(),true);return;}
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
            if(report?.mode==='unlock'){s.getElementById('course-pending').hidden=true;retryButton.hidden=true;clearRetryConfirmation();return;}
            const pending=coursePendingChapters(report),summary=s.getElementById('course-pending-summary'),list=s.getElementById('course-pending-list');
            const hasManualTasks=report?.chapters?.some(chapter=>chapter.remainingUnconfirmed===true||chapter.tasks?.some(task=>task.status==='manual-pending'&&(task.type==='knowledge-graph'||task.reason?.startsWith('自动提交章节测验已关闭'))));
            const count=pending.failed.length+pending.skipped.length+pending.manual.length+pending.waiting.length+pending.navigation.length+pending.unvisited.length;
            s.getElementById('course-pending').hidden=!report||count===0&&pending.taskFree.length===0;
            summary.textContent=`待处理章节：失败 ${pending.failed.length}，用户跳过 ${pending.skipped.length}，${hasManualTasks?'需人工处理':'无法答题'} ${pending.manual.length}${pending.waiting.length?`，待解锁 ${pending.waiting.length}`:''}${pending.navigation.length?`，入口未确认 ${pending.navigation.length}`:''}，尚未处理 ${pending.unvisited.length}${pending.taskFree.length?`；无任务 ${pending.taskFree.length}`:''}`;
            list.replaceChildren();
            for(const [key,label] of [['failed','失败'],['skipped','用户跳过'],['manual',hasManualTasks?'需人工处理（已跳过）':'无法自动答题（未提交）'],['waiting','待解锁'],['navigation','入口未确认'],['unvisited','尚未处理'],['taskFree','无任务']])for(const item of pending[key]){
                const li=doc.createElement('li');li.textContent=`${label} · ${item.number} ${item.title}${item.reason?'：'+item.reason:''}`;list.append(li);
            }
            const candidate=retryCandidate();setAssistantControlDisabled(retryButton,!courseRunController(owner)||ctl.state.busy||!candidate.allowed,ctl.state.busy?'当前操作进行中，请结束后重试':candidate.reason || '请在课程学习页面重试');retryButton.hidden=!report;
            if(queue?.list){retryButton.hidden=!queue.record;setAssistantControlDisabled(retryButton,queue.active||!queue.record?.items.some(item=>!['completed','no-tasks'].includes(item.status)),'当前没有可重试的未完成课程');}
            retryButton.title=queue?.list?'重试本队列的未完成课程':candidate.allowed?'按原队列顺序重试待处理章节':candidate.reason;
            if(retryToken && (ctl.state.busy||!candidate.allowed||candidate.token!==retryToken))clearRetryConfirmation();
        };
        const render=()=>{
            const running=courseRunActive(doc),report=latestReport();
            const unlocking=courseRunController(owner)?.mode==='unlock',verifying=Boolean(owner&&courseVerificationSessions.get(owner)?.pending);
            if(queue?.active) {
                const frozen=queue.record.options;
                for(const [control,key] of [[skipLearned,'skipLearned'],[timeoutNext,'continueOnTimeout'],[muteVideo,'muteVideo'],[skipUnanswerable,'skipUnanswerable'],[videoQuizAuto,'videoQuizAuto'],[speedEnabled,'speedEnabled']])control.checked=frozen[key]===true;
                renderLearningFields();
            }
            renderPreview();
            const locked=running||queue?.active||ctl.state.busy;
            const settingsReason=running||queue?.active?'自动学习运行中，请停止后修改本轮设置':'当前操作进行中，请结束后修改设置';
            forcePlayback.checked=courseForcePlaybackEnabled();
            setAssistantControlDisabled(forcePlayback,unlocking||verifying||!backgroundPlaybackGuard&&!home&&!queue?.list,unlocking||verifying?'当前流程正在解锁或等待核验':'请进入课程学习页面使用连续播放');
            const playback=backgroundPlaybackGuard?.controls;
            setAssistantControlDisabled(videoPause,unlocking||verifying||!playback?.available,unlocking||verifying?'当前流程正在解锁或等待核验':'当前暂无可由助手暂停或继续的视频');videoPause.textContent=playback?.paused?'继续':'暂停';
            renderDelay();
            renderPending(report);
            const lease=owner?.getElementById('cx-ai-course-lease');
            const actionRunId=queue?.active?queue.record.id:lease?.getAttribute('data-run-id');
            if(stopRunId && (!actionRunId || actionRunId!==stopRunId || Date.now()>=stopUntil))clearStopConfirmation();
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
            const unavailableReason=queue?.list?(courseListSnapshot()?.ready?'请选择本次课程':doc.documentElement.dataset.cxCourseListReason||'正在加载课程列表'):home?'课程身份或标签页交接能力尚未就绪，请刷新后重试':owner?'请通过课程主页面的助手开始自动学习':'请进入课程首页或学习页面开始刷课';
            setAssistantControlDisabled(s.getElementById('course-start'),!canStart()||locked||home?.pending||home?.active,home?.pending?'正在进入学习页面，可点击“取消启动”':running||queue?.active||home?.active?'自动学习正在进行中':ctl.state.busy?'当前操作进行中，请结束后开始刷课':unavailableReason);
            const canUnlock=Boolean((owner===doc&&courseRunController(owner))||home?.available);
            unlockButton.hidden=Boolean(queue?.list)||(!home&&owner!==doc);
            unlockButton.textContent=unlocking?'解锁中…':'解锁课程';
            setAssistantControlDisabled(unlockButton,locked||home?.pending||home?.active||!canUnlock,home?.pending?'正在进入学习页面，可点击“取消启动”':home?.active||locked?'当前流程进行中，请先停止':'课程身份或标签页交接能力尚未就绪，请刷新后重试');
            if(home)s.getElementById('course-start').title=home.available?'':'课程身份或标签页交接能力尚未就绪，请刷新后重试';
            setAssistantControlDisabled(s.getElementById('course-stop'),home?!home.pending:!hasCommands||!running,home?'当前没有待取消的启动任务':!hasCommands?'请通过课程主页面的助手停止自动学习':'当前没有运行中的自动学习');
            if(queue?.active)setAssistantControlDisabled(stopButton,false);
            if(home&&!stopRunId)stopButton.textContent=home.pending?'取消启动':'停止';
            setAssistantControlDisabled(s.getElementById('course-skip'),!hasCommands||(running ? owner?.getElementById('cx-ai-course-lease')?.getAttribute('data-can-skip')!=='true' : report?.mode==='unlock'||!courseSkipResume(owner)),!hasCommands?'请在课程学习页面跳过章节':running?'当前处理阶段暂不能跳过章节':'当前没有可跳过并继续的章节');
            autoSubmit.checked=running ? courseRunController(owner)?.autoSubmitEnabled===true : submitPreference();
            if(queue?.active&&!running)autoSubmit.checked=queue.record.submitAuthorized===true;
            setAssistantControlDisabled(autoSubmit,!canStart()||locked||home?.active,locked||home?.active?settingsReason:unavailableReason);
            setAssistantControlDisabled(skipLearned,locked,settingsReason);
            setAssistantControlDisabled(fromCurrent,Boolean(home)||queue?.list||queue?.active||locked,home||queue?.list||queue?.active?'从当前开始仅在独立的实际学习页面可用':settingsReason);
            if(home||queue?.list||queue?.active){fromCurrent.checked=false;fromCurrent.title='从当前开始仅在独立的实际学习页面可用';}
            setAssistantControlDisabled(timeoutNext,locked,settingsReason);
            failureProtection.checked=running?report?.protection?.enabled===true:queue?.active?queue.record.options.failureProtectionEnabled===true:get('cx_course_failure_protection_enabled',false)===true;
            for(const control of [failureProtection,muteVideo,skipUnanswerable,videoQuizAuto,speedEnabled,restEnabled,studyMinutes,restMinutes])setAssistantControlDisabled(control,locked,settingsReason);
            s.getElementById('course-report').textContent=courseReportText(report);
            const skipCourse=s.getElementById('course-queue-skip');skipCourse.hidden=!queue?.active;
            setAssistantControlDisabled(skipCourse,!queue?.canSkip,'当前任务正在提交或结果待确认，暂不能跳过本课程');
            setAssistantControlDisabled(s.getElementById('chapter-tab-catalog'),Boolean(queue?.list),'请进入具体课程查看章节目录');
        };
        const renderPreview=initCourseRunPreview(doc,view,queue);
        function readRunOptions(){return {submit:takeSubmitPermission(),submitScope:queue?.list?[...queue.selected].sort():null,skipLearned:skipLearned.checked,fromCurrent:home||queue?.list?false:fromCurrent.checked,continueOnTimeout:timeoutNext.checked,failureProtectionEnabled:failureProtection.checked,muteVideo:muteVideo.checked,skipUnanswerable:skipUnanswerable.checked,videoQuizAuto:videoQuizAuto.checked,speedEnabled:speedEnabled.checked,...readCourseLearningSettings(),videoDelay:readCourseVideoDelaySettings()};}
        view.renderCourseRunControls=render;
        if(owner===doc) {
            courseRunner=createCourseRunner(owner,ctl);
        }
        s.getElementById('course-start').onclick=event=>{
            if(!trustedAssistantActivation(event,s.getElementById('course-start')) || !canStart() || queue?.active || ctl.state.busy || home?.pending || home?.active)return;
            const options=readRunOptions();
            if(queue?.list)queue.start(options);else if(home)home.start(options);else courseRunController(owner).start(options);
        };
        unlockButton.onclick=event=>{
            if(!trustedAssistantActivation(event,unlockButton)||ctl.state.busy||courseRunActive(doc)||queue?.active||queue?.list||home?.pending||home?.active)return;
            const options={mode:'unlock',continueOnTimeout:timeoutNext.checked,failureProtectionEnabled:failureProtection.checked};
            if(home?.available)home.start(options);else if(owner===doc)courseRunController(owner)?.start(options);
        };
        s.getElementById('course-queue-skip').onclick=event=>{if(trustedAssistantActivation(event,s.getElementById('course-queue-skip')))queue?.skip();};
        s.getElementById('course-skip').onclick=event=>{if(trustedAssistantActivation(event,s.getElementById('course-skip')))courseRunController(owner)?.skip();};
        stopButton.onclick=event=>{
            if(!trustedAssistantActivation(event,stopButton))return;
            if(home&&!queue?.active){home.cancel();return;}
            if(!courseRunController(owner)&&!queue?.active)return;
            const runId=queue?.active?queue.record.id:owner?.getElementById('cx-ai-course-lease')?.getAttribute('data-run-id');
            if(!runId){clearStopConfirmation();return;}
            if(stopRunId===runId && Date.now()<stopUntil){
                clearStopConfirmation();if(queue?.active)queue.stop();else courseRunController(owner)?.stop();return;
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
            doc.removeEventListener('cx-ai-course-list-update',update);
            doc.removeEventListener('cx-ai-course-queue-update',update);
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
        doc.addEventListener('cx-ai-course-list-update',update);
        doc.addEventListener('cx-ai-course-queue-update',update);
        doc.defaultView.addEventListener('pagehide',disconnect,{once:true});
        render();
        if(owner===doc) Promise.resolve(courseQueueReady()).then(()=>resumeCourseHomeLaunch(courseRunner,ctl)).then(handled=>{if(!handled&&!courseHomeClosed)courseRunner?.resumeIfNeeded();}).catch(()=>ctl.report('启动交接未完成，请重新开始','error',false));
    }
