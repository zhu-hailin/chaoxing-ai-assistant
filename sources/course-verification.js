    // Native face verification stays on the platform; only its loaded QR bitmap is displayed here.
    const courseVerificationSessions = new WeakMap();
    const COURSE_FACE_SELECTOR = '.chapterVideoFaceMaskDiv,.face-recognition,[data-face-verification]';
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
        const root=image.closest(COURSE_FACE_SELECTOR+',.layui-layer-content,.vjs-modal-dialog-content,[role="dialog"]')||image.parentElement;
        if(!root)return null;
        const masks=tree.documents.filter(doc=>parents.has(doc)).flatMap(doc=>[...doc.querySelectorAll(COURSE_FACE_SELECTOR)])
            .filter(node=>courseElementVisible(node));
        return {image,root,masks};
    }
    function courseVerificationWaitError() {
        return Object.assign(new Error('等待学习通扫码核验'),{code:'COURSE_VERIFICATION_WAIT'});
    }
    function createCourseVerification(owner, {mode='study',now=()=>Date.now(),notify=()=>{}}={}) {
        let pending=null,lastPassed=null,closed=false,excluded=0,passes=0;
        const update=()=>owner.dispatchEvent(new owner.defaultView.Event('cx-ai-course-verification'));
        const visible=node=>Boolean(node?.isConnected&&courseElementVisible(node));
        const clearListener=state=>state?.video?.removeEventListener('playing',state.onPlaying);
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
                    state.image=candidate.image;state.root=candidate.root;state.masks=candidate.masks;
                }
                if(visible(state.image)&&state.image.complete&&state.image.naturalWidth>0&&state.image.naturalHeight>0)state.seenImage=true;
                const boundRoot=state.root.matches(COURSE_FACE_SELECTOR+',.layui-layer-content,.vjs-modal-dialog-content,[role="dialog"]');
                state.expired=boundRoot&&[...state.root.querySelectorAll('p,span,div')].some(node=>!node.childElementCount&&visible(node)
                    &&clean(node.textContent).length<120&&/二维码.{0,8}(?:已过期|已失效|失效了)/.test(clean(node.textContent)));
                const gateVisible=visible(state.image)||state.masks.some(visible);
                // Non-video gates require a native, explicit success marker inside the bound gate.
                const nativeSuccess=!state.video&&boundRoot&&state.root.isConnected&&Boolean(
                    state.root.matches('[data-face-verified="true"],[data-verification-status="passed"]')
                    ||[...state.root.querySelectorAll('[role="status"],.success,[data-face-result]')].some(node=>visible(node)
                        &&/^(?:人脸识别成功|人脸验证成功|身份核验通过|验证成功)[！!。\s]*$/.test(clean(node.textContent))));
                if(!state.expired&&state.seenImage&&!visible(state.image)&&(state.video?!gateVisible&&state.playing:nativeSuccess)) {
                    if(mode==='unlock')state.video?.pause();
                    clearListener(state);excluded+=Math.max(0,now()-state.started);passes++;
                    pending=null;lastPassed=state;notify(false);update();
                } else {notify(true);update();}
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
            if(state.expired){canvas.hidden=true;message.textContent='二维码已过期，等待平台刷新';return;}
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
