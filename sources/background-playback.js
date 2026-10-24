    // 课程顶层后台播放保护与独立播放恢复。
    // 字体解密部分源自 wyn665817 的 MIT 脚本；改为文本节点转换和可重入模块。
    function initBackgroundPlayback() {
        if (window.top !== window.self || !isCourseStudyURL(location)) return null;
        if (initBackgroundPlayback.instance) return initBackgroundPlayback.instance;
        let active = null, closed = false, lastScan = -Infinity;
        const videos = new Map(), documents = new Map();
        const notify = () => document.dispatchEvent(new window.Event('cx-ai-course-update'));
        const standalone = () => [...videos.values()].find(record => record.video.isConnected && !record.video.paused && !record.video.ended)
            || [...videos.values()].find(record => record.video.isConnected && record.armed && !record.video.ended)
            || [...videos.values()].find(record => record.video.isConnected && !record.video.ended);
        const allowed = record => {
            const video=record.video;
            if(closed || active || courseRunActive(document) || !record.identity
                || courseScoreKey(document)!==record.identity || !video.isConnected || video.ended || video.error || video.seeking)return false;
            const tree=courseFrameTree(document);
            if(tree.inaccessible.length || !tree.documents.includes(video.ownerDocument) || courseBlocker(tree.documents)
                || courseVideoQuizCandidate(video))return false;
            const foreground=courseOwnerForegroundState(document);
            return !courseVideoForegroundPolicy(video).required || foreground.visible&&foreground.focused;
        };
        const recover = async (record, explicit=false) => {
            const video=record.video;
            if(record.pending || record.manual || !allowed(record) || !explicit&&(!courseForcePlaybackEnabled() || !record.armed || record.blocked)
                || !video.paused || video.readyState<2)return;
            if(explicit){record.attempts=0;record.blocked=false;record.requireUserStart=false;}
            if(record.attempts>=COURSE_RUN_LIMITS.maxResumes){record.blocked=true;controller?.report('视频连续恢复无效，可点击“继续”重试','course-paused');notify();return;}
            record.pending=true;record.attempts++;record.lastAttempt=Date.now();
            record.abort=new AbortController();
            try {
                await requestCourseVideoPlayback(video,record.abort.signal);
                if(closed || record.manual || record.requireUserStart || active || courseRunActive(document) || !allowed(record)) {
                    // Runner 接管后由它决定播放状态，旧恢复回调不再碰播放器。
                    if(!active && !courseRunActive(document))video.pause();
                }
            } catch(error) {
                if(error.name!=='AbortError'&&error.code!=='ABORTED'&&!active&&!closed){record.blocked=true;controller?.report('视频恢复未成功，可点击“继续”重试','course-paused');}
            } finally {record.pending=false;notify();}
        };
        const scan = () => {
            let changedNodes=false;
            const tree=courseFrameTree(document);
            for(const [doc,close] of documents)if(!tree.documents.includes(doc)){close();documents.delete(doc);}
            for(const doc of tree.documents)if(!documents.has(doc)) {
                const discover=event=>{
                    if(event.type==='playing'&&event.target?.tagName==='VIDEO'&&!videos.has(event.target) || event.type==='load'&&event.target?.tagName==='IFRAME') {
                        try {scan();}catch{}
                    }
                };
                doc.addEventListener('playing',discover,true);doc.addEventListener('load',discover,true);
                documents.set(doc,()=>{doc.removeEventListener('playing',discover,true);doc.removeEventListener('load',discover,true);});
            }
            const found=new Set(tree.documents.slice(1).flatMap(doc=>[...doc.querySelectorAll('video')].filter(courseElementVisible)));
            for(const [video,record] of videos)if(!found.has(video)) {record.close();videos.delete(video);changedNodes=true;}
            for(const video of found)if(!videos.has(video)) {
                const record={video,identity:courseScoreKey(document),armed:!video.paused&&!video.ended,manual:false,blocked:false,pending:false,
                    attempts:0,lastAttempt:-Infinity,pausedAt:video.paused?Date.now():null,progress:Number(video.currentTime),requireUserStart:false,userStartUntil:0};
                const changed=event=>{
                    if(event.type==='playing') {
                        clearTimeout(record.resumeTimer);
                        if(record.manual){video.pause();return;}
                        if(!record.requireUserStart || Date.now()<=record.userStartUntil){record.armed=true;record.requireUserStart=false;}
                        record.pausedAt=null;
                    } else if(event.type==='pause') {
                        record.pausedAt??=Date.now();clearTimeout(record.resumeTimer);
                        record.resumeTimer=setTimeout(()=>{if(!record.pending)record.promise=recover(record);},500);
                    }
                    else {record.armed=false;record.manual=false;}
                    notify();
                };
                const input=event=>{if(courseVideoPauseInput(event,video))record.userStartUntil=Date.now()+2000;};
                for(const type of ['playing','pause','ended','emptied'])video.addEventListener(type,changed);
                for(const type of ['pointerdown','keydown'])video.ownerDocument.addEventListener(type,input,true);
                record.close=()=>{
                    record.armed=false;record.requireUserStart=true;clearTimeout(record.resumeTimer);record.abort?.abort();
                    for(const type of ['playing','pause','ended','emptied'])video.removeEventListener(type,changed);
                    for(const type of ['pointerdown','keydown'])video.ownerDocument.removeEventListener(type,input,true);
                };
                videos.set(video,record);
                changedNodes=true;
            }
            if(changedNodes)notify();
        };
        const tick = () => {
            if(closed)return;
            try {
                if(Date.now()-lastScan>=2000){lastScan=Date.now();scan();}
                if(active || courseRunActive(document))return;
                for(const record of videos.values()) {
                    const video=record.video;
                    if(video.ended)continue;
                    if(!video.paused) {
                        record.pausedAt=null;
                        record.identity ||= courseScoreKey(document);
                        if(Number(video.currentTime)-record.progress>=COURSE_RUN_LIMITS.resumeProgressSeconds){record.attempts=0;record.blocked=false;record.progress=Number(video.currentTime);}
                    } else {
                        record.pausedAt??=Date.now();
                        if(!record.pending&&Date.now()-record.pausedAt>=500 && Date.now()-record.lastAttempt>=500)record.promise=recover(record);
                    }
                }
            } catch { /* 页面切换时等待下次重新识别，不执行播放。 */ }
        };
        const onMouseExit = event => {
            if (closed || event.relatedTarget !== null) return;
            const record=!active&&standalone();
            const context = active || record&&{video:record.video,canProtect:()=>courseForcePlaybackEnabled()&&allowed(record)&&!record.manual&&!courseVideoForegroundPolicy(record.video).required,onSuppressed:()=>{}};
            if(!context)return;
            try {
                if (!context.video.isConnected || context.video.paused || context.video.ended
                    || !context.canProtect()) return;
                event.stopImmediatePropagation();
                event.stopPropagation();
                context.onSuppressed();
            } catch { /* 状态无法确认时不拦截，也不在页面事件中抛错。 */ }
        };
        const manager = {
            installedAt: Date.now(), installedReadyState: document.readyState,
            get controls() {
                if(active)return {available:active.video.isConnected&&!active.video.ended&&(active.canToggle?.() ?? true),paused:active.isPaused?.() ?? active.video.paused};
                const record=standalone();
                return {available:Boolean(record&&!courseRunActive(document)),paused:Boolean(record&&(record.manual||record.video.paused))};
            },
            togglePause() {
                if(active){if(active.canToggle?.()!==false)active.togglePause?.();notify();return;}
                const record=standalone();if(!record || courseRunActive(document))return;
                if(record.manual || record.video.paused) {
                    record.manual=false;record.armed=true;if(!record.pending)record.promise=recover(record,true);
                } else {record.manual=true;record.video.pause();}
                notify();
            },
            refresh() {active?.settingsChanged?.();tick();notify();},
            activate(context) {
                if (closed || !context?.video || typeof context.canProtect !== 'function'
                    || typeof context.onSuppressed !== 'function') return () => {};
                active = context;
                courseVideoPlaybackRequests.delete(context.video);
                const record=videos.get(context.video);
                if(record){record.armed=false;record.manual=false;record.requireUserStart=true;record.userStartUntil=0;clearTimeout(record.resumeTimer);if(record.pending){context.video.pause();record.abort?.abort();}}
                notify();
                const release = () => {
                    if (active !== context)return;
                    active=null;
                    const current=videos.get(context.video);
                    if(current){current.armed=false;current.manual=false;current.requireUserStart=true;current.userStartUntil=0;}
                    notify();
                };
                release.settled=record?.pending?record.promise:null;
                return release;
            },
            close() {
                if (closed) return;
                closed = true; active = null;
                window.clearInterval(timer);
                for(const record of videos.values())record.close();videos.clear();
                for(const close of documents.values())close();documents.clear();
                window.removeEventListener('mouseout', onMouseExit, true);
                document.removeEventListener('visibilitychange',onForeground);
                window.removeEventListener('focus',onForeground);
                window.removeEventListener('pagehide', manager.close);
                document.removeEventListener('DOMContentLoaded',tick);
            }
        };
        window.addEventListener('mouseout', onMouseExit, true);
        const onForeground=()=>{active?.wake?.();tick();};
        const timer=window.setInterval(tick,500);
        document.addEventListener('DOMContentLoaded',tick,{once:true});
        document.addEventListener('visibilitychange',onForeground);
        window.addEventListener('focus',onForeground);
        window.addEventListener('pagehide', manager.close, { once: true });
        initBackgroundPlayback.instance = manager;
        return manager;
    }

