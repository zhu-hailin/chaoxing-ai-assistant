    // Native face verification stays on the platform; only its loaded QR bitmap is displayed here.
    const courseVerificationSessions = new WeakMap();
    const COURSE_FACE_SELECTOR = '.chapterVideoFaceMaskDiv,.chapterVideoFaceQrMaskDiv,.face-recognition,[data-face-verification]';
    const COURSE_FACE_ROOT_SELECTOR = COURSE_FACE_SELECTOR+',.faceCollectQrPopVideo,.layui-layer-content,.vjs-modal-dialog-content,[role="dialog"]';
    function courseFaceQRCode(tree, video = null) {
        const images=tree.documents.flatMap(doc=>[...doc.querySelectorAll('img#fcqrimg')])
            .filter(image=>courseElementVisible(image)||courseElementVisible(image.closest(COURSE_FACE_SELECTOR)));
        if(images.length!==1)return null;
        const image=images[0],parents=new Set();
        for(let doc=video?.ownerDocument||image.ownerDocument,depth=0;doc&&depth<12;depth++) {
            parents.add(doc);if(doc===tree.documents[0])break;
            try{doc=doc.defaultView.frameElement?.ownerDocument;}catch{break;}
        }
        if(!parents.has(image.ownerDocument))return null;
        const root=image.closest(COURSE_FACE_ROOT_SELECTOR)||image.parentElement;
        if(!root)return null;
        const masks=tree.documents.filter(doc=>parents.has(doc)).flatMap(doc=>[...doc.querySelectorAll(COURSE_FACE_SELECTOR)])
            .filter(node=>courseElementVisible(node));
        return {image,root,masks};
    }
    function courseFaceQRExpired(image,root) {
        if(!root.matches(COURSE_FACE_ROOT_SELECTOR))return false;
        const scope=image.closest('.ewmDiv')||root;
        return [...scope.querySelectorAll('p,span,strong,em,div,button,a,[role="status"]')].some(node=>{
            if(!courseElementVisible(node))return false;
            const text=clean(node.innerText??node.textContent);
            return text.length<120&&/二维码.{0,8}(?:已过期|已失效|失效了)/.test(text);
        });
    }
    function courseVerificationWaitError() {
        return Object.assign(new Error('等待学习通扫码核验'),{code:'COURSE_VERIFICATION_WAIT'});
    }
    function createCourseVerification(owner, {mode='study',now=()=>Date.now(),notify=()=>{}}={}) {
        let pending=null,lastPassed=null,closed=false,excluded=0,passes=0;
        const update=()=>owner.dispatchEvent(new owner.defaultView.Event('cx-ai-course-verification'));
        const visible=node=>Boolean(node?.isConnected&&courseElementVisible(node));
        const clearRefresh=state=>{
            if(state?.refreshImage)state.refreshImage.removeEventListener('load',state.onRefreshLoad);
            if(state){state.refreshImage=null;state.onRefreshLoad=null;}
        };
        const clearListener=state=>{state?.video?.removeEventListener('playing',state.onPlaying);clearRefresh(state);};
        const refresh=state=>{
            if(!state.expired||!state.root.isConnected||now()-(state.refreshedAt??-Infinity)<5000)return;
            const matches=[...state.root.querySelectorAll('button,a,[role="button"],[onclick],img')].filter(node=>{
                if(!visible(node)||node.disabled||node.getAttribute('aria-disabled')==='true')return false;
                const label=clean(node.getAttribute('aria-label')||node.getAttribute('title')||node.getAttribute('alt')||node.textContent)
                    .replace(/^二维码.{0,8}(?:已过期|已失效|失效了)[，,。:：\s]*/,'');
                return /^(?:点击)?(?:刷新(?:二维码)?|重新获取(?:二维码)?|重新加载(?:二维码)?)[！!。\s]*$/.test(label);
            });
            const candidates=matches.filter(node=>!matches.some(other=>other!==node&&node.contains(other)));
            if(candidates.length!==1){state.refreshMessage='二维码已过期，请在原页面点击刷新';return;}
            state.refreshedAt=now();state.refreshSource=state.image.currentSrc||state.image.src;
            state.seenImage=false;state.playing=false;state.refreshMessage='正在刷新二维码…';
            clearRefresh(state);state.refreshImage=state.image;
            state.onRefreshLoad=()=>{
                if(pending!==state||closed)return;
                state.refreshSource=null;state.refreshMessage='';clearRefresh(state);update();
            };
            state.image.addEventListener('load',state.onRefreshLoad,{once:true});
            candidates[0].click();
        };
        const api={
            owner,mode,get pending(){return pending;},get passes(){return passes;},
            get excludedMs(){return excluded+(pending?Math.max(0,now()-pending.started):0);},
            allows(node) {
                const state=pending||lastPassed;
                return Boolean(state&&(node===state.image||state.masks.includes(node)||node===state.root
                    ||node.ownerDocument===state.image.ownerDocument&&node.contains(state.image)));
            },
            poll(tree,video=null) {
                if(closed)return;
                if(!video){const videos=tree.documents.slice(1).flatMap(doc=>[...doc.querySelectorAll('video')]).filter(courseElementVisible);if(videos.length===1)video=videos[0];}
                const candidate=courseFaceQRCode(tree,video);
                if(!pending&&candidate) {
                    lastPassed=null;
                    const state={...candidate,video,started:now(),playing:false,seenImage:false,id:Symbol('face-verification')};
                    state.onPlaying=event=>{
                        if(event.isTrusted!==true||closed||pending!==state)return;
                        state.playing=true;
                        if(mode==='unlock'||visible(state.image)||state.masks.some(visible))state.video.pause();
                    };
                    pending=state;video?.addEventListener('playing',state.onPlaying);
                    notify(true);update();
                }
                if(!pending)return;
                const state=pending;
                if(!state.video&&video&&candidate){state.video=video;video.addEventListener('playing',state.onPlaying);}
                if(state.video&&(!state.video.isConnected||!tree.documents.includes(state.video.ownerDocument)))
                    throw Object.assign(new Error('核验期间视频页面已替换，请重新确认任务'),{code:'COURSE_VERIFICATION_TARGET_CHANGED'});
                if(!tree.documents.includes(state.image.ownerDocument))
                    throw Object.assign(new Error('核验来源页面已替换，请人工确认'),{code:'COURSE_VERIFICATION_TARGET_CHANGED'});
                if(candidate) {
                    if(candidate.image.ownerDocument!==state.image.ownerDocument)
                        throw Object.assign(new Error('出现新的核验来源，请人工确认'),{code:'COURSE_VERIFICATION_TARGET_CHANGED'});
                    if(candidate.image!==state.image){
                        clearRefresh(state);state.refreshSource=null;state.refreshMessage='';
                        state.playing=false;state.seenImage=false;
                    }
                    state.image=candidate.image;state.root=candidate.root;state.masks=candidate.masks;
                }
                if(visible(state.image)&&state.image.complete&&state.image.naturalWidth>0&&state.image.naturalHeight>0)state.seenImage=true;
                const boundRoot=state.root.matches(COURSE_FACE_ROOT_SELECTOR);
                state.expired=courseFaceQRExpired(state.image,state.root);
                if(state.refreshSource&&(state.image.currentSrc||state.image.src)!==state.refreshSource){
                    state.refreshSource=null;state.refreshMessage='';clearRefresh(state);
                }
                if(mode==='unlock')refresh(state);
                const gateVisible=visible(state.image)||state.masks.some(visible);
                // Non-video gates require a native, explicit success marker inside the bound gate.
                const nativeSuccess=!state.video&&boundRoot&&state.root.isConnected&&Boolean(
                    state.root.matches('[data-face-verified="true"],[data-verification-status="passed"]')
                    ||[...state.root.querySelectorAll('[role="status"],.success,[data-face-result]')].some(node=>visible(node)
                        &&/^(?:人脸识别成功|人脸验证成功|身份核验通过|验证成功)[！!。\s]*$/.test(clean(node.textContent))));
                if(!state.expired&&!state.refreshSource&&state.seenImage&&!visible(state.image)&&(state.video?!gateVisible&&state.playing:nativeSuccess)) {
                    if(mode==='unlock')state.video?.pause();
                    clearListener(state);excluded+=Math.max(0,now()-state.started);passes++;
                    pending=null;lastPassed=state;notify(false);update();
                } else {notify(true);update();}
            },
            reset() {
                if(pending)excluded+=Math.max(0,now()-pending.started);
                clearListener(pending);pending=null;lastPassed=null;
                notify(false);update();
            },
            close() {
                if(closed)return;closed=true;clearListener(pending);pending=null;lastPassed=null;
                if(courseVerificationSessions.get(owner)===api)courseVerificationSessions.delete(owner);
                update();
            },
        };
        courseVerificationSessions.set(owner,api);
        return api;
    }
    function initCourseVerificationView(doc,view) {
        const owner=studyOwnerDocument(doc),s=view.shadow,overlay=s.getElementById('course-verification-page');
        const canvas=s.getElementById('course-verification-qr'),message=s.getElementById('course-verification-message');
        const back=s.getElementById('course-verification-back'),reopen=s.getElementById('course-verification-open');
        const cancelDrag=initPanelDragging(overlay);
        let shown=null,dismissed=null,placement=null,drawnImage=null,drawnSource='',background=[];
        const hide=(dismiss=false)=>{
            if(dismiss&&shown)dismissed=shown.id;
            cancelDrag();
            overlay.hidden=true;
            for(const [node,inert,aria]of background){node.inert=inert;if(aria===null)node.removeAttribute('aria-hidden');else node.setAttribute('aria-hidden',aria);}
            background=[];shown=null;canvas.width=0;canvas.height=0;drawnImage=null;drawnSource='';
            if(placement){const previous=placement;placement=null;if(!dismiss&&previous.mode!=='open')setAssistantWindowMode(previous.mode);else previous.focus?.focus?.();}
        };
        const render=()=>{
            const verification=owner&&courseVerificationSessions.get(owner),state=verification?.pending;
            reopen.hidden=!state;
            if(!state){dismissed=null;if(shown)hide();return;}
            if(shown&&shown!==state)hide();
            if(!shown&&dismissed!==state.id) {
                placement={mode:view.windowMode,focus:s.activeElement};closeProjectIntro();closeResultImage();setAssistantWindowMode('open');
                background=[...s.getElementById('panel').children].filter(node=>node!==overlay).map(node=>[node,node.inert,node.getAttribute('aria-hidden')]);
                for(const [node]of background){node.inert=true;node.setAttribute('aria-hidden','true');}
                shown=state;overlay.hidden=false;back.focus();
            }
            if(!shown)return;
            if(state.expired||state.refreshSource){canvas.hidden=true;drawnImage=null;message.textContent=state.refreshMessage||'二维码已过期，等待平台刷新';return;}
            const image=state.image;
            if(courseElementVisible(image)&&image.complete&&image.naturalWidth>0&&image.naturalHeight>0) {
                const source=image.currentSrc||image.src;
                if(image!==drawnImage||source!==drawnSource) {
                    try {
                        canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
                        const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;context.drawImage(image,0,0);
                        drawnImage=image;drawnSource=source;canvas.hidden=false;
                    } catch {canvas.hidden=true;}
                }
                message.textContent=canvas.hidden?'二维码暂时无法显示，请在学习通原页面扫码':'请使用学习通扫码核验';
            } else {canvas.hidden=true;message.textContent='等待平台二维码或核验结果…';}
        };
        back.onclick=event=>{if(trustedAssistantActivation(event,back))hide(true);};
        reopen.onclick=event=>{if(trustedAssistantActivation(event,reopen)){dismissed=null;render();}};
        overlay.addEventListener('keydown',event=>{
            if(event.key==='Escape'){event.preventDefault();event.stopPropagation();hide(true);}
            else if(event.key==='Tab'){event.preventDefault();back.focus();}
        });
        view.hideCourseVerification=()=>{if(shown)hide(true);};
        owner?.addEventListener('cx-ai-course-verification',render);
        doc.defaultView.addEventListener('pagehide',()=>{owner?.removeEventListener('cx-ai-course-verification',render);if(shown)hide(true);},{once:true});
    }
