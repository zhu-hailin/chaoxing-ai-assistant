    // Personal course list: read native cards in their own iframe; private GM records carry snapshots.
    const COURSE_LIST_CHANNEL='cx-ai-course-list-v1',COURSE_LIST_PREFIX='cx_course_list:',COURSE_LIST_CONNECT_TTL=15000;
    let courseListParent=null,courseListChild=null,courseListBinding=null,courseListClosed=false,courseListAnnounced=false;
    function courseListConnection(status,reason='') {
        const root=document.documentElement;if(!root)return;
        if(root.dataset.cxCourseListConnection===status&&root.dataset.cxCourseListReason===reason)return;
        root.dataset.cxCourseListConnection=status;root.dataset.cxCourseListReason=reason;
        document.dispatchEvent(new Event('cx-ai-course-list-update'));
    }
    function isCourseListPage(doc=document) {
        const url=pageURL(doc);
        return Boolean(url?.origin==='https://i.chaoxing.com'&&url.pathname==='/base'&&doc.defaultView===doc.defaultView.top);
    }
    function isCourseListFrameURL(url) {
        return Boolean(url?.origin===COURSE_HOME_ORIGIN&&['/visit/interaction','/mooc2-ans/visit/interaction'].includes(url.pathname));
    }
    function courseListItemSelectable(item) {
        return Boolean(item&&!item.ended&&Number.isSafeInteger(item.total)&&item.total>0);
    }
    function courseListNativeURL(raw,identity=null) {
        try {
            const url=new URL(raw),context=courseURLContext(url);
            if(url.protocol!=='https:'||url.username||url.password||url.hash
                ||!['mooc1.chaoxing.com','mooc2-ans.chaoxing.com'].includes(url.hostname)
                ||url.pathname!=='/visit/stucoursemiddle'||context.conflict
                ||![context.course,context.classroom,context.student].every(value=>/^\d+$/.test(value))
                ||identity&&!sameCourseHomeIdentity(context,identity))return null;
            return url;
        }catch{return null;}
    }
    function readCourseListCards(doc=document) {
        if(!isCourseListFrameURL(pageURL(doc)))return null;
        const root=doc.getElementById('courselistArea'),seen=new Set(),items=[];
        if(!root||!doc.getElementById('courseList'))return null;
        for(const card of root.querySelectorAll('.course.learnCourse')) {
            const links=[...card.querySelectorAll('h3 a[href]')],link=links.length===1?links[0]:null;
            const url=link&&courseListNativeURL(link.href),context=url&&courseURLContext(url),title=clean(link?.textContent);
            if(!context||!title||title.length>500||card.id!==`c_${context.course}`
                ||!card.classList.contains(`stu_${context.classroom}`))continue;
            const identity={course:context.course,classroom:context.classroom,student:context.student};
            const key=[identity.course,identity.classroom,identity.student].join(':');
            if(seen.has(key))return null;
            seen.add(key);
            const ended=Boolean(card.querySelector('.not-open-tip')&&/课程已结束/.test(clean(card.querySelector('.not-open-tip').textContent)));
            const progress=/任务点进度\s*[:：]\s*(\d+)\s*\/\s*(\d+)/.exec(clean(card.querySelector('.btm-cover .l-txt')?.textContent));
            const done=progress?Number(progress[1]):null,total=progress?Number(progress[2]):null;
            const valid=Number.isSafeInteger(done)&&Number.isSafeInteger(total)&&total>0&&done>=0&&done<=total;
            items.push({key,title,identity,href:url.href,ended,completed:valid?done:null,total:valid?total:null});
        }
        return {items,ready:Boolean(items.length),url:pageURL(doc).href};
    }
    function courseListParentCurrent(state=courseListParent) {
        try{return Boolean(state&&state===courseListParent&&!courseListClosed&&isCourseListPage(state.doc)&&state.frame.isConnected
            &&state.doc.getElementById('frame_content')===state.frame
            &&new URL(state.frame.getAttribute('src'),state.doc.baseURI).href===state.url);}catch{return false;}
    }
    function closeCourseListParent() {
        const state=courseListParent;courseListParent=null;
        if(!state)return;
        clearInterval(state.timer);
        for(const id of state.listeners)GM_removeValueChangeListener(id);
        state.cancel?.();
        for(const suffix of ['',':snapshot',':open',':command',':reply'])GM_deleteValue(COURSE_LIST_PREFIX+state.id+suffix);
    }
    function courseListSnapshot() {return courseListParentCurrent()?courseListParent.snapshot:null;}
    function decodeCourseListSnapshot(state,data) {
        if(!data||data.id!==state.id||!courseHomeUUID(data.documentId)||data.url!==state.url
            ||!Number.isSafeInteger(data.revision)||data.revision<1||typeof data.ready!=='boolean'
            ||!Array.isArray(data.items)||data.items.length>2000)return null;
        const items=[],seen=new Set();
        for(const item of data.items) {
            if(!item||typeof item.title!=='string'||!item.title||item.title.length>500||typeof item.ended!=='boolean'
                ||!item.identity||!['course','classroom','student'].every(field=>/^\d+$/.test(item.identity[field]||''))
                ||!courseListNativeURL(item.href,item.identity)||item.key!==[item.identity.course,item.identity.classroom,item.identity.student].join(':')
                ||seen.has(item.key)||!(item.completed===null&&item.total===null
                    ||Number.isSafeInteger(item.completed)&&Number.isSafeInteger(item.total)&&item.total>0&&item.completed>=0&&item.completed<=item.total))return null;
            seen.add(item.key);items.push({...item,identity:{course:item.identity.course,classroom:item.identity.classroom,student:item.identity.student}});
        }
        return {items,ready:data.ready,documentId:data.documentId,revision:data.revision};
    }
    function retryCourseListBridge(state) {
        if(!courseListParentCurrent(state))return;
        clearInterval(state.timer);
        if(state.attempt<3&&Date.now()<state.startedAt+45000){mountCourseListBridge(state.doc,true,state);return;}
        state.failed=true;courseListConnection('error','课程列表连接超时，请重新连接');
    }
    function mountCourseListBridge(doc,reconnect=false,previous=null) {
        if(!isCourseListPage(doc)||courseListClosed)return;
        const frame=doc.getElementById('frame_content');let url;
        try{url=new URL(frame.getAttribute('src'),doc.baseURI);}catch{}
        if(!frame?.isConnected||!isCourseListFrameURL(url)){closeCourseListParent();return;}
        if(courseListParentCurrent()&&!reconnect)return;
        closeCourseListParent();
        const startedAt=previous?.startedAt||Date.now(),attempt=previous?previous.attempt+1:1;
        const state=courseListParent={doc,frame,url:url.href,id:crypto.randomUUID(),listeners:[],snapshot:null,failed:false,startedAt,attempt,until:Math.min(Date.now()+COURSE_LIST_CONNECT_TTL,startedAt+45000)};
        courseListConnection('connecting','正在连接课程列表');
        courseHomeTab().then(tab=>{
            if(!courseListParentCurrent(state))return;
            const key=COURSE_LIST_PREFIX+state.id;
            state.listeners.push(GM_addValueChangeListener(COURSE_HOME_CATALOG_UPDATE,(_key,_old,value)=>{
                if(!courseListParentCurrent(state)||!courseHomeCatalogStateValid(value))return;
                const cacheKey=courseHomeCatalogStateKey(value.identity),previous=courseHomeCatalogStates.get(cacheKey);
                if(!previous||value.checkedAt>=previous.checkedAt)courseHomeCatalogStates.set(cacheKey,value);
                if(courseHomeCatalogStates.size>2000)courseHomeCatalogStates.delete(courseHomeCatalogStates.keys().next().value);
                if(state.snapshot?.items.some(item=>sameCourseHomeIdentity(item.identity,value.identity)))doc.dispatchEvent(new Event('cx-ai-course-list-update'));
            }));
            state.listeners.push(GM_addValueChangeListener(key+':snapshot',(_key,_old,data)=>{
                if(!courseListParentCurrent(state))return;
                if(data?.closed&&data.documentId===state.snapshot?.documentId){
                    state.snapshot=null;retryCourseListBridge(state);return;
                }
                const decoded=decodeCourseListSnapshot(state,data);
                if(!decoded||decoded.documentId===state.snapshot?.documentId&&decoded.revision<=state.snapshot.revision)return;
                state.snapshot=decoded;state.failed=!decoded.ready&&Date.now()>state.until;
                if(decoded.ready)clearInterval(state.timer);
                courseListConnection(decoded.ready?'ready':state.failed?'error':'loading',decoded.ready?'':state.failed?'课程列表加载超时，点击助手入口重新连接':'课程列表尚未加载');
                doc.dispatchEvent(new doc.defaultView.Event('cx-ai-course-list-update'));
            }));
            set(key,{id:state.id,tabId:tab.cxCourseTabId,url:state.url,until:state.until});
            const send=()=>{
                if(!courseListParentCurrent(state)){
                    if(courseListParent===state)closeCourseListParent();else clearInterval(state.timer);
                    return;
                }
                if(Date.now()>state.until){
                    retryCourseListBridge(state);return;
                }
                frame.contentWindow?.postMessage({channel:COURSE_LIST_CHANNEL,id:state.id},COURSE_HOME_ORIGIN);
            };
            state.timer=setInterval(send,500);send();
        }).catch(()=>{
            if(!courseListParentCurrent(state))return;
            clearInterval(state.timer);state.failed=true;
            courseListConnection('error','标签页身份读取失败，请刷新页面重试');
        });
    }
    async function resolveCourseListEntry(item) {
        const state=courseListParent,snapshot=courseListSnapshot();
        if(!snapshot?.ready||!snapshot.items.some(current=>current.key===item.key&&sameCourseHomeIdentity(current.identity,item.identity)))
            throw new Error('课程列表或账号已变化，请重新选择课程');
        if(state.cancel)throw new Error('正在核对课程入口');
        const id=crypto.randomUUID(),key=COURSE_LIST_PREFIX+state.id;
        return new Promise((resolve,reject)=>{
            let listener,timer;
            const finish=(error,value)=>{clearTimeout(timer);if(listener!==undefined)GM_removeValueChangeListener(listener);state.cancel=null;error?reject(error):resolve(value);};
            state.cancel=()=>finish(new Error('课程列表已更换'));
            listener=GM_addValueChangeListener(key+':reply',(_key,_old,data)=>{
                if(data?.commandId!==id)return;
                if(!courseListParentCurrent(state)||data.documentId!==snapshot.documentId||!sameCourseHomeIdentity(data.item?.identity,item.identity)
                    ||data.item?.key!==item.key||data.item.ended||!courseListNativeURL(data.item.href,item.identity)){
                    finish(new Error(data.message||'课程入口或账号已变化'));return;
                }
                finish(null,data.item);
            });
            timer=setTimeout(()=>finish(new Error('课程列表未响应，请刷新后重试')),5000);
            set(key+':command',{commandId:id,documentId:snapshot.documentId,itemKey:item.key,expiresAt:Date.now()+5000});
        });
    }
    function bindCourseListChild(id) {
        if(!courseHomeUUID(id)||courseListClosed||window===window.top||!document.body||!isCourseListFrameURL(pageURL(document)))return;
        if(courseListChild?.id===id){courseListChild.publish(true);return;}
        if(courseListBinding?.id===id){courseListBinding.check();return;}
        courseListBinding?.close();
        const key=COURSE_LIST_PREFIX+id,binding={id,working:false,changed:false,request:null};
        courseListBinding=binding;
        courseListConnection('connecting','正在核对标签页身份');
        binding.close=()=>{
            clearTimeout(binding.timer);GM_removeValueChangeListener(binding.listener);
            if(courseListBinding===binding)courseListBinding=null;
        };
        binding.check=async()=>{
            if(binding.working||courseListBinding!==binding||courseListClosed)return;
            binding.working=true;
            try {
                const tab=await courseHomeTabRead();
                if(courseListBinding!==binding||courseListClosed)return;
                // Storage changes and message delivery have no shared ordering. Read after awaiting the tab,
                // preferring a private change value received since the listener was installed.
                const request=binding.changed?binding.request:get(key,null);
                let parentOrigin;try{parentOrigin=new URL(document.referrer).origin;}catch{}
                const reason=!request?'等待私有连接记录同步':request.id!==id?'连接记录身份不一致'
                    :!Number.isFinite(request.until)||request.until<Date.now()?'连接记录已过期'
                    :!courseHomeUUID(request.tabId)||!courseHomeUUID(tab.cxCourseTabId)||request.tabId!==tab.cxCourseTabId?'标签页身份尚未同步'
                    :request.url!==pageURL(document).href?'课程列表地址已变化'
                    :parentOrigin!=='https://i.chaoxing.com'?'父页面来源不匹配':'';
                if(reason){courseListConnection('connecting',reason);return;}
                binding.close();attachCourseListChild(id);
            }catch {if(courseListBinding===binding)courseListConnection('connecting','标签页身份读取失败');}
            finally {binding.working=false;}
        };
        binding.listener=GM_addValueChangeListener(key,(_key,_old,value)=>{
            if(courseListBinding!==binding)return;
            binding.changed=true;binding.request=value;binding.check();
        });
        binding.timer=setTimeout(()=>{
            if(courseListBinding!==binding)return;
            binding.close();courseListConnection('error',`${document.documentElement.dataset.cxCourseListReason||'连接未完成'}，点击助手入口重新连接`);
        },COURSE_LIST_CONNECT_TTL);
        binding.check();
    }
    function attachCourseListChild(id) {
        courseListChild?.close();
        const key=COURSE_LIST_PREFIX+id,state={id,documentId:crypto.randomUUID(),revision:0,last:'',consumed:new Set()};
        courseListChild=state;
        state.publish=force=>{
            if(courseListClosed||courseListChild!==state)return;
            const snapshot=readCourseListCards()||{items:[],ready:false,url:pageURL(document).href};
            const text=JSON.stringify(snapshot);if(!force&&text===state.last)return;
            state.last=text;set(key+':snapshot',{...snapshot,id,documentId:state.documentId,revision:++state.revision});
        };
        state.listener=GM_addValueChangeListener(key+':command',(_key,_old,data)=>{
            if(courseListChild!==state||!data||data.documentId!==state.documentId||data.expiresAt<Date.now()
                ||data.expiresAt>Date.now()+6000||!courseHomeUUID(data.commandId)||state.consumed.has(data.commandId))return;
            state.consumed.add(data.commandId);if(state.consumed.size>100)state.consumed.delete(state.consumed.values().next().value);
            const matches=readCourseListCards()?.items.filter(item=>item.key===data.itemKey)||[];
            set(key+':reply',{commandId:data.commandId,documentId:state.documentId,item:matches.length===1?matches[0]:null,message:'课程入口无法唯一确认'});
        });
        const observer=new MutationObserver(()=>{clearTimeout(state.timer);state.timer=setTimeout(()=>{mountCourseListEntry();state.publish(false);},120);});
        observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['href','class','id']});
        state.close=()=>{observer.disconnect();clearTimeout(state.timer);GM_removeValueChangeListener(state.listener);if(get(key,null))set(key+':snapshot',{closed:true,documentId:state.documentId});else GM_deleteValue(key+':snapshot');};
        courseListConnection('ready');mountCourseListEntry();state.publish(true);
    }
    function courseListEntryContext(doc=document) {
        if(!isCourseListFrameURL(pageURL(doc)))return null;
        const searches=doc.querySelectorAll('[id="searchInput"]');
        if(searches.length!==1)return null;
        // The native toolbar is outside #courselistArea on the current course list.
        const toolbar=searches[0].closest('.btn_group');
        const natives=toolbar?[...toolbar.querySelectorAll('.assistantBtn')].filter(node=>node.closest('.btn_group')===toolbar):[];
        return natives.length===1?{toolbar,native:natives[0]}:null;
    }
    function mountCourseListEntry() {
        const context=courseListEntryContext();
        if(!context){document.getElementById('cx-ai-course-list-entry')?.remove();return;}
        const {native}=context;
        let host=document.getElementById('cx-ai-course-list-entry');
        if(!host) {
            host=document.createElement('span');host.id='cx-ai-course-list-entry';
            host.style.cssText='float:right;display:inline-flex;margin-right:14px;align-items:center;height:40px';
            const shadow=host.attachShadow({mode:'open'});
            shadow.innerHTML='<style>button{border:1px solid #e0e7fa;background:#f1f4ff;color:#4b59bd;border-radius:20px;padding:7px 14px;font:13px/1.5 "Microsoft YaHei",sans-serif;white-space:nowrap;cursor:pointer}button:hover{background:#e9eeff}button:focus-visible{outline:2px solid #4b59bd;outline-offset:2px}</style><button type="button" aria-haspopup="dialog">学习通AI助手</button>';
            registerAssistantUiHost(host);
            initAssistantControlFeedback(shadow);
            shadow.querySelector('button').onclick=event=>{
                if(!trustedAssistantActivation(event,shadow.querySelector('button')))return;
                const current=courseListEntryContext();
                if(!current||host.parentElement!==current.toolbar||current.native.nextElementSibling!==host)return;
                // Opening the UI never grants navigation or startup authority; those still use the private binding.
                window.parent.postMessage({channel:COURSE_LIST_CHANNEL,kind:'open-panel'},'https://i.chaoxing.com');
            };
        }
        let parentOrigin;try{parentOrigin=new URL(document.referrer).origin;}catch{}
        setAssistantControlDisabled(host.shadowRoot.querySelector('button'),courseListClosed||window===window.top||parentOrigin!=='https://i.chaoxing.com','请从个人空间课程列表打开助手');
        if(native.nextElementSibling!==host)native.after(host);
        if(!courseListAnnounced&&!courseListClosed&&window!==window.top&&parentOrigin==='https://i.chaoxing.com') {
            courseListAnnounced=true;
            window.parent.postMessage({channel:COURSE_LIST_CHANNEL,kind:'list-ready'},parentOrigin);
        }
    }
    function initCourseListTransport() {
        if(!isCourseListPage()&&!isCourseListFrameURL(pageURL(document)))return;
        window.addEventListener('message',event=>{
            if(event.data?.channel!==COURSE_LIST_CHANNEL)return;
            if(isCourseListPage()&&['open-panel','list-ready'].includes(event.data.kind)&&event.origin===COURSE_HOME_ORIGIN&&!courseListClosed) {
                const frame=document.getElementById('frame_content');let url;
                try{url=new URL(frame?.getAttribute('src'),document.baseURI);}catch{}
                if(!frame?.isConnected||event.source!==frame.contentWindow||!isCourseListFrameURL(url))return;
                if(!courseListParentCurrent()||courseListParent.failed)mountCourseListBridge(document,true);
                if(event.data.kind==='open-panel')controller?.openPanel('chapters');return;
            }
            if(event.data?.channel===COURSE_LIST_CHANNEL&&event.origin==='https://i.chaoxing.com'&&(event.source===window.parent||event.source===null))
                bindCourseListChild(event.data.id);
        });
        document.addEventListener('load',event=>{if(isCourseListPage()&&event.target?.id==='frame_content'){closeCourseListParent();mountCourseListBridge(document);}},true);
        window.addEventListener('pagehide',()=>{courseListClosed=true;closeCourseListParent();courseListBinding?.close();courseListChild?.close();courseListChild=null;},{once:true});
    }
    function initCourseListAssistant(doc=document) {
        if(isCourseListFrameURL(pageURL(doc))){mountCourseListEntry();return;}
        if(!isCourseListPage(doc)||!doc.body||!doc.getElementById('frame_content'))return;
        mountCourseListBridge(doc);
        if(!controller)controller=createAssistantController();
        createAssistantPanel(doc,controller);
    }
