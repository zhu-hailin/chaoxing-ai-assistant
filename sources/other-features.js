    const OTHER_FEATURES_KEY = 'cx_other_features';
    const otherFeatureManagers = new WeakMap();
    const otherFeaturePageShows = new WeakSet();
    function otherFeatureSettings() {
        const saved=get(OTHER_FEATURES_KEY,{});
        return {hidePlatformAi:saved?.hidePlatformAi===true,keepVideoPlaying:saved?.keepVideoPlaying===true};
    }
    function createManualVideoProtection(owner, options={}) {
        const clock=options.now||Date.now;
        const resumeMs=options.resumeMs??COURSE_RUN_LIMITS.resumeMs,maxResumes=options.maxResumes??COURSE_RUN_LIMITS.maxResumes;
        const progressSeconds=options.progressSeconds??COURSE_RUN_LIMITS.resumeProgressSeconds;
        let state=null,closed=false,status='播放视频后生效';
        const release=()=>{if(!state)return;state.release?.();state.cleanup();state=null;};
        const allowed=video=>{
            if(closed||courseRunActive(owner)||!video.isConnected||video.ended||video.error||video.seeking)return false;
            const tree=courseFrameTree(owner);
            if(tree.inaccessible.length||courseBlocker(tree.documents))return false;
            const policy=courseVideoForegroundPolicy(video),foreground=courseOwnerForegroundState(owner);
            return !policy.required||foreground.visible&&foreground.focused;
        };
        const bind=video=>{
            release();
            const local={video,manualPaused:false,intentUntil:-Infinity,attempts:0,lastAttemptAt:clock(),pending:false,blocked:false,
                progress:0,lastTime:Number(video.currentTime),lastAt:clock(),rate:Number(video.playbackRate)||1};
            state=local;
            const anchor=()=>{local.lastTime=Number(video.currentTime);local.lastAt=clock();local.rate=Number(video.playbackRate)||1;};
            const input=event=>{if(state===local&&courseVideoPauseInput(event,video)&&!video.paused&&!video.ended)local.intentUntil=clock()+COURSE_RUN_LIMITS.videoManualPauseIntentMs;};
            const pause=()=>{if(state===local){if(clock()<local.intentUntil)local.manualPaused=true;anchor();}};
            const playing=()=>{if(state===local){local.manualPaused=false;local.intentUntil=-Infinity;anchor();}};
            for(const name of ['pointerdown','click','keydown'])video.ownerDocument.addEventListener(name,input,true);
            video.addEventListener('pause',pause);video.addEventListener('playing',playing);
            video.addEventListener('seeking',anchor);video.addEventListener('seeked',anchor);
            local.cleanup=()=>{for(const name of ['pointerdown','click','keydown'])video.ownerDocument.removeEventListener(name,input,true);video.removeEventListener('pause',pause);video.removeEventListener('playing',playing);video.removeEventListener('seeking',anchor);video.removeEventListener('seeked',anchor);};
            local.release=backgroundPlaybackGuard?.activate({video,canProtect:()=>state===local&&!local.manualPaused&&!local.blocked&&allowed(video),onSuppressed:()=>{}});
        };
        const tick=()=>{
            if(closed)return;
            if(courseRunActive(owner)){release();status='自动刷课运行中，使用刷课播放保护';return;}
            const videos=courseFrameTree(owner).documents.flatMap(doc=>[...doc.querySelectorAll('video')]).filter(courseElementVisible);
            const playing=videos.filter(video=>!video.paused&&!video.ended);
            if(playing.length>1){release();status='多个视频同时播放，等待单个视频';return;}
            if(state&&(!videos.includes(state.video)||!state.video.isConnected||state.video.ended))release();
            if(playing.length===1&&state?.video!==playing[0])bind(playing[0]);
            if(!state){status='播放视频后生效';return;}
            const local=state,video=local.video,at=clock(),seconds=Number(video.currentTime),elapsed=Math.max(0,(at-local.lastAt)/1000);
            const delta=seconds-local.lastTime;
            const position=courseVideoPositionDecision({seconds:local.lastTime,at:local.lastAt,rate:local.rate},
                {seconds,at,rate:Number(video.playbackRate)||1,duration:Number(video.duration),seeking:video.seeking,readyState:video.readyState},courseVideoPlayedRanges(video),COURSE_RUN_LIMITS);
            if(!video.paused&&elapsed>0&&delta>0&&position.kind==='continuous')local.progress+=delta;
            local.lastTime=seconds;local.lastAt=at;local.rate=Number(video.playbackRate)||1;
            if(local.progress>=progressSeconds){local.attempts=0;local.blocked=false;local.progress=0;}
            if(!allowed(video)) {
                const foreground=courseOwnerForegroundState(owner);
                if(courseVideoForegroundPolicy(video).required&&(!foreground.visible||!foreground.focused)&&!video.paused)video.pause();
                status='等待页面观看条件或人工处理';return;
            }
            if(local.manualPaused){status='已手动暂停，等待你继续播放';return;}
            if(!video.paused){status='视频播放保护中';return;}
            if(local.blocked){status='自动恢复已达上限，请手动播放';return;}
            if(local.pending||video.readyState<2||at-local.lastAttemptAt<resumeMs){status='等待恢复播放';return;}
            local.lastAttemptAt=at;local.attempts++;local.pending=true;
            if(local.attempts>=maxResumes)local.blocked=true;
            status=`正在恢复播放 ${local.attempts}/${maxResumes}`;
            try {
                Promise.resolve(video.play()).catch(error=>{if(state===local&&error?.name==='NotAllowedError')local.blocked=true;})
                    .finally(()=>{if(state===local)local.pending=false;});
            } catch(error){local.pending=false;if(error?.name==='NotAllowedError')local.blocked=true;}
        };
        return {tick,get status(){return status;},get activeVideo(){return state?.video||null;},close(){if(closed)return;closed=true;release();}};
    }
    function initOtherFeatures(doc=document) {
        const existing=otherFeatureManagers.get(doc);if(existing)return existing;
        const view=doc.defaultView,panels=new Set();let settings=otherFeatureSettings(),timer=null,protection=null,closed=false;
        const controlsPlayback=doc===document&&view.top===view.self&&isCourseStudyURL(view.location);
        const render=()=>{
            for(const shadow of panels){if(!shadow.host.isConnected){panels.delete(shadow);continue;}
                shadow.getElementById('other-hide-platform-ai').checked=settings.hidePlatformAi;
                shadow.getElementById('other-keep-video-playing').checked=settings.keepVideoPlaying;
                shadow.getElementById('other-video-status').textContent=settings.keepVideoPlaying?(protection?.status||'在课程页面播放视频后生效'):'按需开启';
            }
        };
        const tick=()=>{protection?.tick();render();};
        const apply=()=>{
            if(closed)return;settings=otherFeatureSettings();
            let style=doc.getElementById('cx-ai-platform-widgets-style');
            if(!style){style=doc.createElement('style');style.id='cx-ai-platform-widgets-style';(doc.head||doc.documentElement)?.append(style);}
            // Confirmed CxRobotSdkJs roots; never hide a generic .resizer or our assistant host.
            style.textContent=settings.hidePlatformAi?'.cx-robot-wrapper,.cx-robot-side,.cx-robot-side-tips{display:none!important}':'';
            if(controlsPlayback&&settings.keepVideoPlaying&&!protection){protection=createManualVideoProtection(doc);timer=view.setInterval(tick,500);}
            if(!settings.keepVideoPlaying){if(timer!==null)view.clearInterval(timer);timer=null;protection?.close();protection=null;}
            tick();
        };
        const listener=typeof GM_addValueChangeListener==='function'?GM_addValueChangeListener(OTHER_FEATURES_KEY,apply):null;
        const close=()=>{if(closed)return;closed=true;if(timer!==null)view.clearInterval(timer);protection?.close();
            if(listener!==null&&typeof GM_removeValueChangeListener==='function')GM_removeValueChangeListener(listener);
            doc.removeEventListener('cx-ai-course-update',tick);view.removeEventListener('pagehide',close);panels.clear();otherFeatureManagers.delete(doc);};
        const manager={apply,close,bind(shadow){panels.add(shadow);render();}};
        otherFeatureManagers.set(doc,manager);doc.addEventListener('cx-ai-course-update',tick);view.addEventListener('pagehide',close,{once:true});
        if(doc===document&&!otherFeaturePageShows.has(doc)){otherFeaturePageShows.add(doc);view.addEventListener('pageshow',()=>initOtherFeatures(doc));}
        apply();return manager;
    }
    function initOtherFeatureControls(shadow,doc) {
        const manager=initOtherFeatures(doc);manager.bind(shadow);
        for(const [id,field] of [['other-hide-platform-ai','hidePlatformAi'],['other-keep-video-playing','keepVideoPlaying']]) {
            const control=shadow.getElementById(id);
            control.addEventListener('change',event=>{
                if(!trustedAssistantActivation(event,control,'change')){manager.apply();return;}
                set(OTHER_FEATURES_KEY,{...otherFeatureSettings(),[field]:control.checked});manager.apply();
            });
        }
    }
