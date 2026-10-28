    // Homepage navigation and one-shot startup only. All learning remains in createCourseRunner.
    const COURSE_HOME_ORIGIN = 'https://mooc2-ans.chaoxing.com';
    const COURSE_HOME_CHANNEL = 'cx-ai-course-home-v1';
    const COURSE_HOME_PREFIX = 'cx_course_launch:';
    const COURSE_HOME_TTL = 120000;
    const COURSE_HOME_CATALOG_STATE='cx_course_catalog_state:',COURSE_HOME_CATALOG_UPDATE='cx_course_catalog_update';
    const courseHomeCatalogStates=new Map();
    const courseHomeNavigations = new Set();
    const courseHomeFrameSnapshots = new WeakMap();
    let courseHomeParentFrame = null, courseHomeChildFrame = null;
    let courseHomeTransportReady = false, courseHomeClosed = false, courseHomeTabPromise = null;
    const courseHomeUUID = value => typeof value==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
    function isCourseHomeURL(url, chapter = false) {
        return url?.origin===COURSE_HOME_ORIGIN && url.pathname===(chapter?'/mooc2-ans/mycourse/studentcourse':'/mooc2-ans/mycourse/stu');
    }
    function courseHomeIdentity(doc = document) {
        const identity=courseURLContext(pageURL(doc));
        if(identity.conflict || ![identity.course,identity.classroom,identity.student].every(value=>/^\d+$/.test(value)))return null;
        for(const [names,value] of [[['courseid'],identity.course],[['clazzid','classid'],identity.classroom],[['cpi'],identity.student]]) {
            const fields=[...doc.querySelectorAll('input[id],input[name]')].filter(node=>names.includes((node.id||node.name).toLowerCase()));
            if(fields.some(node=>node.value.trim()!==value))return null;
        }
        return {course:identity.course,classroom:identity.classroom,student:identity.student};
    }
    function sameCourseHomeIdentity(left,right) {
        return Boolean(left&&right&&['course','classroom','student'].every(key=>left[key]===right[key]));
    }
    function courseHomeCatalogStateKey(identity) {
        return identity&&['course','classroom','student'].every(key=>/^\d+$/.test(identity[key]||''))
            ?COURSE_HOME_CATALOG_STATE+[identity.course,identity.classroom,identity.student].join(':'):null;
    }
    function courseHomeCatalogStateValid(value) {
        return Boolean(courseHomeCatalogStateKey(value?.identity)&&['empty','chapters'].includes(value.kind)
            &&Number.isFinite(value.checkedAt)&&value.checkedAt<=Date.now()+10000&&Date.now()-value.checkedAt<86400000);
    }
    function courseHomeCachedCatalogState(identity) {
        const key=courseHomeCatalogStateKey(identity);if(!key)return null;
        const saved=get(key,null),live=courseHomeCatalogStates.get(key);
        const record=courseHomeCatalogStateValid(live)&&(!courseHomeCatalogStateValid(saved)||live.checkedAt>=saved.checkedAt)?live:saved;
        return courseHomeCatalogStateValid(record)&&sameCourseHomeIdentity(record.identity,identity)?record.kind:null;
    }
    function rememberCourseHomeCatalog(context,empty,hasChapters) {
        const {sourceDoc:doc,identity}=context,key=courseHomeCatalogStateKey(identity);
        if(!key||!doc||doc.readyState!=='complete'||!isCourseHomeURL(pageURL(doc),true)||!sameCourseHomeIdentity(courseHomeIdentity(doc),identity))return;
        const previous=get(key,null),kind=empty?'empty':hasChapters?'chapters':null;
        if(!kind||kind==='chapters'&&!previous||courseHomeBlocker(doc))return;
        if(courseHomeCatalogStateValid(previous)&&previous.kind===kind&&Date.now()-previous.checkedAt<300000)return;
        const record={identity:{...identity},kind,checkedAt:Math.max(Date.now(),Number.isFinite(previous?.checkedAt)?Math.min(previous.checkedAt+1,Date.now()+1000):0)};
        courseHomeCatalogStates.set(key,record);set(key,record);
        // Carry the verified value, so a notification arriving before the other GM key still updates the list.
        set(COURSE_HOME_CATALOG_UPDATE,record);
    }
    function courseHomeBlocker(doc) {
        const commitment=doc.getElementById('showCommitmentId');
        return courseBlocker([doc]) || (commitment&&courseElementVisible(commitment)?'请先在平台处理学习承诺，再开始自动学习':null);
    }
    function courseHomeRecord(id) {
        if(!courseHomeUUID(id))return null;
        const record=get(COURSE_HOME_PREFIX+id,null);
        return record?.id===id && Number.isFinite(record.createdAt) && record.expiresAt===record.createdAt+COURSE_HOME_TTL
            && record.createdAt<=Date.now()+10000 && ['course','classroom','student'].every(key=>/^\d+$/.test(record.identity?.[key]||''))
            && (record.options?.mode===undefined||['study','unlock'].includes(record.options.mode)) ? record:null;
    }
    function courseHomeUpdate(id,patch) {
        const record=courseHomeRecord(id);
        if(!record)return null;
        const next={...record,...patch};set(COURSE_HOME_PREFIX+id,next);return next;
    }
    function courseHomeTabRead() {
        return new Promise((resolve,reject)=>{
            if(typeof GM_getTab!=='function'||typeof GM_saveTab!=='function'){reject(new Error('当前脚本管理器不支持跨页面启动，请从学习页面开始'));return;}
            const timer=setTimeout(()=>reject(new Error('读取标签页身份超时')),5000);
            GM_getTab(tab=>{clearTimeout(timer);resolve(tab||{});});
        });
    }
    function courseHomeSaveTab(tab) {
        return new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(new Error('保存标签页交接超时')),5000);
            try{GM_saveTab(tab,()=>{clearTimeout(timer);resolve();});}catch(error){clearTimeout(timer);reject(error);}
        });
    }
    function courseHomeTab() {
        if(!courseHomeTabPromise)courseHomeTabPromise=courseHomeTabRead().then(async tab=>{
            if(!courseHomeUUID(tab.cxCourseTabId)){tab.cxCourseTabId=crypto.randomUUID();await courseHomeSaveTab(tab);}
            return tab;
        });
        return courseHomeTabPromise;
    }
    async function courseHomeBindTab(id) {
        const identity=await courseHomeTab(),tab=await courseHomeTabRead();
        tab.cxCourseTabId=identity.cxCourseTabId;tab.cxCourseLaunchId=id;
        await courseHomeSaveTab(tab);
        identity.cxCourseLaunchId=id;
    }
    function courseHomeModelSignature() {
        const settings=readModelConfiguration();
        return JSON.stringify([modelConfigurationSignature(settings),endpointFingerprint(settings.key)]);
    }
    function courseHomeOptions(options) {
        if(options.mode!==undefined&&!['study','unlock'].includes(options.mode))throw new Error('启动模式无效，请重新开始');
        if(options.mode==='unlock') {
            if(options.queueContext)throw new Error('解锁仅用于当前课程，请从课程目录页开始');
            return {mode:'unlock',fromCurrent:false,submit:false,skipLearned:true,
                continueOnTimeout:options.continueOnTimeout===true,failureProtectionEnabled:options.failureProtectionEnabled===true};
        }
        const result={fromCurrent:false,...courseLearningSettings(options),videoDelay:courseVideoDelaySettings(options.videoDelay)};
        for(const key of ['submit','skipLearned','continueOnTimeout','muteVideo','skipUnanswerable','videoQuizAuto','speedEnabled','failureProtectionEnabled'])result[key]=options[key]===true;
        if(options.queueContext) {
            if(!courseQueueValidContext(options.queueContext))throw new Error('课程队列已停止或课程身份已变化');
            result.queueContext={...options.queueContext};result.queuePacing=courseQueuePacing(options.queuePacing);
        }
        return result;
    }
    function resolveCourseHomeCatalog(doc) {
        try {
            let owner=doc,sourceDoc=doc,frame=null;
            if(isCourseHomeURL(pageURL(doc))) {
                frame=doc.getElementById('frame_content-zj');
                if(!frame?.isConnected)return null;
                const declared=new URL(frame.getAttribute('src'),doc.baseURI);
                if(!isCourseHomeURL(declared,true)||!sameCourseHomeIdentity(courseURLContext(declared),courseHomeIdentity(doc)))return null;
                sourceDoc=frame.contentDocument;
                if(!sourceDoc)return courseHomeRemoteCatalog(doc,frame,declared);
            } else if(isCourseHomeURL(pageURL(doc),true)) {
                // A chapter reads its own DOM even when document.domain separates it from its parent.
                const identity=courseHomeIdentity(doc),referrer=new URL(doc.referrer);
                if(doc.defaultView===doc.defaultView.top||!doc.body||!identity||!isCourseHomeURL(referrer)||courseURLContext(referrer).conflict
                    ||!sameCourseHomeIdentity(identity,courseURLContext(referrer)))return null;
                return {sourceDoc:doc,ownerDoc:null,frame:null,root:doc.body,identity,structure:'course-home',
                    scopeKey:COURSE_SCORE_PREFIX+[identity.course,identity.classroom,identity.student].map(encodeURIComponent).join(':')};
            } else return null;
            const identity=courseHomeIdentity(sourceDoc);
            if(!sourceDoc?.body||!isCourseHomeURL(pageURL(sourceDoc),true)||!sameCourseHomeIdentity(identity,courseHomeIdentity(owner)))return null;
            const declared=new URL(frame.getAttribute('src'),owner.baseURI);declared.hash='';
            if(!isCourseHomeURL(declared,true)||!sameCourseHomeIdentity(courseURLContext(declared),identity))return null;
            const previous=courseHomeFrameSnapshots.get(frame);
            if(previous&&previous.src!==declared.href&&previous.doc===sourceDoc)return null;
            courseHomeFrameSnapshots.set(frame,{src:declared.href,doc:sourceDoc});
            return {sourceDoc,ownerDoc:owner,frame,frameSource:declared.href,root:sourceDoc.body,identity,structure:'course-home',
                scopeKey:COURSE_SCORE_PREFIX+[identity.course,identity.classroom,identity.student].map(encodeURIComponent).join(':')};
        } catch {
            if(isCourseHomeURL(pageURL(doc))) {
                const frame=doc.getElementById('frame_content-zj');
                try{return courseHomeRemoteCatalog(doc,frame,new URL(frame.getAttribute('src'),doc.baseURI));}catch{}
            }
            return null;
        }
    }
    function readCourseHomeCatalog(context) {
        const {sourceDoc:doc,root,identity}=context,entries=[];
        const rows=[...root.querySelectorAll('.chapter_item[id^="cur"]')].filter(row=>!row.querySelector('.chapter_item[id^="cur"]'));
        const leafRows=new Set(rows);
        const headings=[],seenHeadings=new Set(),walker=doc.createTreeWalker(root,doc.defaultView.NodeFilter.SHOW_TEXT);
        let hasEmptyNotice=false;
        // 分组标题来自原生 DOM；折叠或搜索不改变章节的目录顺序和完成事实。
        for(let text=walker.nextNode();text;text=walker.nextNode()) {
            if(clean(text.textContent)==='暂无章节内容'&&!text.parentElement.closest('script,style,template,textarea,[contenteditable]')&&courseElementVisible(text.parentElement))hasEmptyNotice=true;
            if(!/^第[\d一二三四五六七八九十百零〇两]+[章节篇单元]/.test(clean(text.textContent))||text.parentElement.closest('script,style')||leafRows.has(text.parentElement.closest('.chapter_item[id^="cur"]')))continue;
            let heading=text.parentElement;
            while(heading.parentElement&&heading.parentElement!==root&&!heading.parentElement.querySelector('.chapter_item[id^="cur"]'))heading=heading.parentElement;
            const containsChapters=Boolean(heading.querySelector('.chapter_item[id^="cur"]')),node=containsChapters?text:heading;
            if(seenHeadings.has(node))continue;
            seenHeadings.add(node);headings.push({node,container:containsChapters?heading:heading.parentElement,title:clean(node.textContent)});
        }
        const follows=(before,after)=>Boolean(before.compareDocumentPosition(after)&4);
        for(const [index,heading] of headings.entries()) {
            const first=rows.find(row=>heading.container?.contains(row)&&follows(heading.node,row));
            if(!first)continue;
            heading.entry={id:`home-group:${index}:${first.id}`,chapterId:null,number:String(index+1),title:heading.title,parentId:null,
                node:heading.node,isGroup:true,target:null,active:false,completed:null,pending:null,scores:[],navigation:{status:'group',target:null,evidence:'home-heading'}};
            entries.push(heading.entry);
        }
        const parentGroup=node=>headings.filter(group=>group.entry&&group.container?.contains(node)&&follows(group.node,node))
            .sort((a,b)=>a.container===b.container?(follows(a.node,b.node)?1:-1):a.container.contains(b.container)?1:-1)[0];
        for(const heading of headings.filter(item=>item.entry)) {
            const parent=headings.filter(other=>other.entry&&other!==heading&&other.container!==heading.container&&other.container?.contains(heading.node)&&follows(other.node,heading.node))
                .sort((a,b)=>a.container.contains(b.container)?1:-1)[0];
            heading.entry.parentId=parent?.entry.id||null;
        }
        const counts=new Map(),stored=get(context.scopeKey,{});let validRows=0;
        for(const row of rows) {
            const match=/^cur(\d+)$/.exec(row.id);
            if(!match||doc.querySelectorAll(`[id="${row.id}"]`).length!==1)continue;
            const title=clean(row.getAttribute('title')||row.querySelector('.chapter_name,.chapter-title,.chapterName')?.textContent||row.textContent);
            if(!title)continue;
            validRows++;
            const group=parentGroup(row),parentId=group?.entry.id||null,index=(counts.get(parentId)||0)+1;counts.set(parentId,index);
            const pendingNode=courseCatalogMarker(row,'.orangeNew')||courseCatalogMarker(row,'.catalog_task .catalog_jindu > .catalog_points_yi');
            const pendingText=clean(pendingNode?.textContent);
            // The homepage badge explicitly counts remaining tasks; a missing/zero badge alone does not prove no tasks.
            const pending=/^\d+$/.test(pendingText)&&(pendingNode.matches('.orangeNew')||Number(pendingText)>0)?Number(pendingText):null;
            const complete=Boolean(courseCatalogMarker(row,'.icon_yiwanc,.icon_Completed'));
            const noTasks=Boolean(courseCatalogMarker(row,'[title="无任务点"],[aria-label="无任务点"]'));
            const locked=Boolean(row.closest('[disabled],[aria-disabled="true"],[data-locked="true"]'))
                ||Boolean(courseCatalogMarker(row,'[title="未解锁"],[aria-label="未解锁"],[title="章节未解锁"]'));
            const native=locked?null:courseHomeRowEntry(doc,identity,row);
            const navigation={status:locked?'sequence-locked':native?'available':'unknown',target:native?.node||null,
                evidence:locked?'native-locked':native?'home-native-entry':'navigation-unconfirmed'};
            entries.push({id:row.id,chapterId:match[1],number:group?`${group.entry.number}.${index}`:String(index),title,parentId,node:row,isGroup:false,
                target:navigation.target,navigation,active:false,completed:complete&&!(pending>0)?true:pending>0?false:null,pending:noTasks&&!(pending>0)?0:pending,
                scores:Object.values(stored?.[match[1]]||{}).filter(item=>item&&Number.isFinite(item.score)&&item.score>=0)});
        }
        entries.sort((a,b)=>follows(a.node,b.node)?-1:follows(b.node,a.node)?1:0);
        const progress=/已完成任务点\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/.exec(clean(root.querySelector('.chapter_head')?.textContent));
        // An empty DOM alone may still be loading. Require the native empty notice and explicit 0/0.
        const empty=doc.readyState==='complete'&&hasEmptyNotice&&!root.querySelector('.chapter_item')&&Boolean(progress&&Number(progress[1])===0&&Number(progress[2])===0);
        rememberCourseHomeCatalog(context,empty,rows.length>0||Boolean(progress&&Number(progress[2])>0));
        return {...context,entries,empty,ready:empty||rows.length>0&&validRows===rows.length,
            progressConflict:Boolean(progress&&Number(progress[1])>Number(progress[2])),
            remaining:progress&&Number(progress[1])<=Number(progress[2])?Number(progress[2])-Number(progress[1]):null};
    }
    function courseHomeSelection(catalog,skipLearned=true) {
        if(!catalog?.ready)return {status:'unready',message:'章节目录尚未完整就绪，请稍候或刷新'};
        if(catalog.empty)return {status:'complete',empty:true,message:'暂无章节，无需刷课'};
        const chapters=catalog.entries.filter(entry=>!entry.isGroup),prefix=[];
        for(const entry of chapters) {
            if(skipLearned&&(entry.completed===true||entry.pending===0)) {prefix.push({chapterId:entry.chapterId,completed:entry.completed===true});continue;}
            return {status:'target',entry,prefix};
        }
        return catalog.remaining>0||catalog.progressConflict?{status:'unready',message:'任务统计尚未一致，请等待章节列表加载后刷新'}:{status:'complete',message:'本课程任务已完成'};
    }
    function courseHomeStartChapter(record,catalog) {
        if(record.options?.skipLearned!==true||!Array.isArray(record.startPrefix))return null;
        const entries=catalog.entries.filter(entry=>!entry.isGroup),index=entries.findIndex(entry=>entry.chapterId===record.chapterId);
        if(index<0||index!==record.startPrefix.length)return null;
        for(let before=0;before<index;before++) {
            const entry=entries[before],saved=record.startPrefix[before];
            if(!saved||typeof saved.completed!=='boolean'||entry.chapterId!==saved.chapterId||entry.pending>0||catalog.sourceDoc.querySelectorAll(`[id="${entry.id}"]`).length!==1)return null;
        }
        return entries[index].id;
    }
    // GM records carry catalog data and commands; page messages only wake the bound iframe.
    function courseHomeFrameKey(id) {return COURSE_HOME_PREFIX+'frame:'+id;}
    function courseHomeFrameURL(frame) {
        const url=new URL(frame.getAttribute('src'),frame.ownerDocument.baseURI);url.hash='';return url.href;
    }
    function courseHomeFrameCurrent(state) {
        try {return Boolean(state&&!courseHomeClosed&&state.frame.isConnected
            &&state.owner.getElementById('frame_content-zj')===state.frame
            &&courseHomeFrameURL(state.frame)===state.url
            &&sameCourseHomeIdentity(state.identity,courseHomeIdentity(state.owner)));}catch{return false;}
    }
    function resetCourseHomeFrameBridge() {
        const state=courseHomeParentFrame;courseHomeParentFrame=null;
        if(!state)return;
        clearInterval(state.timer);
        if(state.listener!==undefined)GM_removeValueChangeListener(state.listener);
        state.cancelCommand?.();
        for(const suffix of ['',':catalog',':command'])GM_deleteValue(courseHomeFrameKey(state.id)+suffix);
    }
    function courseHomeRemoteCatalog(owner,frame,url) {
        const identity=courseHomeIdentity(owner);
        if(!frame?.isConnected||!identity||!isCourseHomeURL(url,true)||!sameCourseHomeIdentity(identity,courseURLContext(url)))return null;
        url=new URL(url.href);url.hash='';
        let state=courseHomeParentFrame;
        if(!courseHomeFrameCurrent(state)) {
            resetCourseHomeFrameBridge();
            state=courseHomeParentFrame={id:crypto.randomUUID(),owner,frame,url:url.href,identity,catalog:null,startedAt:Date.now()};
            courseHomeTab().then(tab=>{
                if(courseHomeParentFrame!==state||!courseHomeFrameCurrent(state))return;
                state.tabId=tab.cxCourseTabId;
                const key=courseHomeFrameKey(state.id);
                state.listener=GM_addValueChangeListener(key+':catalog',(_key,_old,data)=>{
                    if(courseHomeParentFrame!==state||!courseHomeFrameCurrent(state))return;
                    const binding=get(key,null);
                    if(!data||binding?.status!=='connected'||binding.documentId!==data.documentId||data.id!==state.id)return;
                    if(data.closed){state.catalog=null;refreshCourseSidebar();return;}
                    const catalog=courseHomeDecodeCatalog(state,data);
                    if(!catalog)return;
                    clearInterval(state.timer);state.catalog=catalog;state.documentId=data.documentId;
                    refreshCourseSidebar();
                });
                set(key,{id:state.id,tabId:state.tabId,identity,url:state.url,status:'binding',expiresAt:state.startedAt+15000});
                const send=()=>{
                    if(courseHomeParentFrame!==state||!courseHomeFrameCurrent(state)){resetCourseHomeFrameBridge();return;}
                    if(Date.now()>state.startedAt+15000){clearInterval(state.timer);return;}
                    try{frame.contentWindow?.postMessage({channel:COURSE_HOME_CHANNEL,kind:'catalog-bind',id:state.id},COURSE_HOME_ORIGIN);}
                    catch{clearInterval(state.timer);}
                };
                state.timer=setInterval(send,500);send();
            }).catch(()=>{});
        }
        return state.catalog;
    }
    function courseHomeDecodeCatalog(state,data) {
        if(!courseHomeUUID(data.documentId)||data.url!==state.url||!sameCourseHomeIdentity(data.identity,state.identity)
            ||!Number.isSafeInteger(data.revision)||data.revision<1||data.revision<=(state.catalog?.revision||0)
            ||typeof data.ready!=='boolean'||typeof data.progressConflict!=='boolean'||data.empty!==undefined&&typeof data.empty!=='boolean'
            ||data.remaining!==null&&(!Number.isSafeInteger(data.remaining)||data.remaining<0)
            ||!Array.isArray(data.entries)||data.entries.length>2000)return null;
        if(data.empty===true&&(!data.ready||data.entries.length!==0||data.remaining!==0||data.progressConflict)
            ||data.ready&&data.entries.length===0&&data.empty!==true)return null;
        const entries=[],seen=new Set();
        for(const item of data.entries) {
            if(!item||typeof item.id!=='string'||item.id.length>160||seen.has(item.id)||typeof item.isGroup!=='boolean'
                ||typeof item.title!=='string'||!item.title||item.title.length>1000||typeof item.number!=='string'||item.number.length>80
                ||item.parentId!==null&&typeof item.parentId!=='string'||![true,false,null].includes(item.completed)
                ||item.pending!==null&&(!Number.isSafeInteger(item.pending)||item.pending<0)
                ||!['group','available','sequence-locked','unknown'].includes(item.navigation)
                ||(item.isGroup?item.navigation!=='group':!/^cur\d+$/.test(item.id)||item.id!==`cur${item.chapterId}`))return null;
            seen.add(item.id);
            entries.push({...item,node:null,target:null,active:false,scores:Array.isArray(item.scores)?item.scores.slice(0,16)
                .filter(score=>score&&Number.isFinite(score.score)&&score.score>=0)
                .map(score=>({score:score.score,title:typeof score.title==='string'?score.title.slice(0,500):''})):[],
                navigation:{status:item.navigation,target:null,evidence:'bound-home-frame'}});
        }
        const byId=new Map(entries.map(entry=>[entry.id,entry]));
        for(const entry of entries) {
            const parents=new Set([entry.id]);
            for(let id=entry.parentId;id!==null;id=byId.get(id).parentId) {
                if(!byId.get(id)?.isGroup||parents.has(id)||parents.size>32)return null;
                parents.add(id);
            }
        }
        return {ownerDoc:state.owner,sourceDoc:null,root:null,frame:state.frame,frameSource:state.url,identity:state.identity,
            structure:'course-home',remote:true,bridgeId:state.id,documentId:data.documentId,revision:data.revision,
            scopeKey:COURSE_SCORE_PREFIX+[state.identity.course,state.identity.classroom,state.identity.student].map(encodeURIComponent).join(':'),
            entries,empty:data.empty===true,ready:data.ready,remaining:data.remaining,progressConflict:data.progressConflict};
    }
    function closeCourseHomeChildFrame() {
        const state=courseHomeChildFrame;courseHomeChildFrame=null;
        if(!state)return;
        clearTimeout(state.timer);state.observer.disconnect();
        document.removeEventListener('readystatechange',state.readyListener);
        if(state.commandListener!==undefined)GM_removeValueChangeListener(state.commandListener);
        state.consumedCommands.clear();
        const key=courseHomeFrameKey(state.id),binding=get(key,null);
        if(binding?.documentId===state.documentId)set(key+':catalog',{id:state.id,documentId:state.documentId,closed:true});
    }
    async function bindCourseHomeChildFrame(id) {
        if(!courseHomeUUID(id)||courseHomeClosed)return;
        const context=resolveCourseHomeCatalog(document);
        if(!context||!isCourseHomeURL(pageURL(document),true))return;
        const key=courseHomeFrameKey(id),request=get(key,null),tab=await courseHomeTab();
        const url=pageURL(document);url.hash='';
        if(courseHomeClosed||!request||request.id!==id||request.tabId!==tab.cxCourseTabId||request.url!==url.href
            ||!sameCourseHomeIdentity(request.identity,context.identity)||!sameCourseHomeIdentity(courseHomeIdentity(),context.identity))return;
        if(courseHomeChildFrame?.id===id&&request.documentId===courseHomeChildFrame.documentId){courseHomeChildFrame.publish(true);return;}
        if(request.status!=='binding'||request.expiresAt<Date.now()||get(key,null)?.status!=='binding')return;
        closeCourseHomeChildFrame();
        const state={id,documentId:crypto.randomUUID(),identity:context.identity,revision:0,last:'',timer:null,consumedCommands:new Map()};
        const publish=(force=false)=>{
            if(courseHomeChildFrame!==state||courseHomeClosed)return;
            const binding=get(key,null),local=resolveCourseHomeCatalog(document);
            if(binding?.documentId!==state.documentId||!local||!sameCourseHomeIdentity(state.identity,local.identity)){closeCourseHomeChildFrame();return;}
            mountCourseHomeChapterEntry(document);
            const catalog=readCourseHomeCatalog(local),value={url:url.href,identity:local.identity,ready:catalog.ready,empty:catalog.empty,remaining:catalog.remaining,
                progressConflict:catalog.progressConflict,entries:catalog.entries.map(entry=>({id:entry.id,chapterId:entry.chapterId,parentId:entry.parentId,
                    number:entry.number,title:entry.title,isGroup:entry.isGroup,completed:entry.completed,pending:entry.pending,
                    scores:entry.scores,navigation:entry.navigation.status}))};
            const serialized=JSON.stringify(value);
            if(!force&&serialized===state.last)return;
            state.last=serialized;set(key+':catalog',{...value,id,documentId:state.documentId,revision:++state.revision});
        };
        state.publish=publish;
        state.readyListener=()=>publish();
        document.addEventListener('readystatechange',state.readyListener);
        state.observer=new MutationObserver(()=>{
            if(state.timer!==null)return;
            state.timer=setTimeout(()=>{state.timer=null;publish();},100);
        });
        courseHomeChildFrame=state;
        // Storage propagation and postMessage delivery have no shared ordering.
        // Install before publishing readiness; use the private change value if the message arrived first.
        state.commandListener=GM_addValueChangeListener(key+':command',(_key,_old,value)=>{
            if(courseHomeChildFrame===state&&value?.status==='pending')courseHomeChildChapterNavigation(id,value.commandId,value);
        });
        set(key,{...request,status:'connected',documentId:state.documentId});
        state.observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,
            attributeFilter:['class','title','id','onclick','href','disabled','aria-disabled','data-locked','aria-label','hidden','aria-hidden','style','inert']});
        publish();
    }
    async function navigateCourseHomeRemoteChapter(catalog,id) {
        const state=courseHomeParentFrame,entry=catalog.entries.find(item=>item.id===id&&!item.isGroup);
        if(!courseHomeFrameCurrent(state)||state.catalog!==catalog||state.cancelCommand||entry?.navigation.status!=='available')throw new Error('章节入口已变化，请刷新课程目录');
        const key=courseHomeFrameKey(state.id)+':command',commandId=crypto.randomUUID();
        return new Promise((resolve,reject)=>{
            let listener,timer,settled=false;
            const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);if(listener!==undefined)GM_removeValueChangeListener(listener);
                state.cancelCommand=null;GM_deleteValue(key);error?reject(error):resolve();};
            state.cancelCommand=()=>finish(new Error('章节页面已变化，请刷新课程目录'));
            listener=GM_addValueChangeListener(key,(_key,_old,result)=>{
                if(result?.commandId!==commandId||result.documentId!==catalog.documentId)return;
                if(result.status==='done')finish();
                else if(result.status==='failed')finish(new Error(result.message||'原生章节导航失败'));
            });
            timer=setTimeout(()=>finish(new Error('章节页面未响应，请刷新目录后重试')),5000);
            set(key,{commandId,bridgeId:state.id,documentId:catalog.documentId,tabId:state.tabId,identity:state.identity,
                chapterId:entry.chapterId,expiresAt:Date.now()+5000,status:'pending'});
            try{state.frame.contentWindow.postMessage({channel:COURSE_HOME_CHANNEL,kind:'catalog-navigate',id:state.id,commandId},COURSE_HOME_ORIGIN);}
            catch{finish(new Error('无法联系章节页面，请刷新目录后重试'));}
        });
    }
    function courseHomeChildChapterNavigation(id,commandId,changedValue) {
        if(courseHomeClosed||!courseHomeUUID(id)||!courseHomeUUID(commandId))return;
        const state=courseHomeChildFrame,key=courseHomeFrameKey(id),binding=get(key,null),request=changedValue||get(key+':command',null),at=Date.now();
        // Missing records may still be in transit. The storage listener will resume this exact command.
        if(!request||request.commandId!==commandId||request.bridgeId!==id||request.status!=='pending'
            ||!Number.isFinite(request.expiresAt)||request.expiresAt<at)return;
        const fail=(reason,message)=>set(key+':command',{...request,status:'failed',reason,message});
        if(!state||state.id!==id||binding?.status!=='connected'||binding.documentId!==state.documentId||request.documentId!==state.documentId)
            return fail('FRAME_DOCUMENT_CHANGED','章节文档关联已变化，请刷新目录后重试');
        if(request.tabId!==binding.tabId)return fail('FRAME_TAB_CHANGED','章节标签页关联已变化，请重新打开助手');
        if(!sameCourseHomeIdentity(request.identity,courseHomeIdentity()))return fail('FRAME_IDENTITY_CHANGED','课程或账号已变化，请重新打开助手');
        for(const [previous,expiresAt] of state.consumedCommands)if(expiresAt<at)state.consumedCommands.delete(previous);
        if(state.consumedCommands.has(commandId))return;
        state.consumedCommands.set(commandId,request.expiresAt);
        try {
            const context=resolveCourseHomeCatalog(document),url=pageURL(document);url.hash='';
            if(!context||url.href!==binding.url)return fail('FRAME_CONTEXT_CHANGED','章节页面已变化，请刷新目录后重试');
            const catalog=readCourseHomeCatalog(context),entry=catalog.entries.find(item=>!item.isGroup&&item.chapterId===request.chapterId);
            const native=entry?.navigation.status==='available'&&courseHomeRowEntry(document,state.identity,entry.node);
            if(!native)return fail(entry?.navigation.status==='sequence-locked'?'FRAME_CHAPTER_LOCKED':'FRAME_ENTRY_CHANGED',
                entry?.navigation.status==='sequence-locked'?'该章节尚未解锁，请先完成前置任务':'章节原生入口已变化，请刷新目录');
            set(key+':command',{...request,status:'consumed'});
            native.node.click();set(key+':command',{...request,status:'done'});
        } catch {fail('FRAME_NAVIGATION_ERROR','原生章节导航执行异常，请刷新目录后重试');}
    }
    // The chapter can mount its own UI without reading the parent document.
    function courseHomeChapterEntryContext(owner) {
        try {
            if(owner.defaultView!==owner.defaultView.top||!isCourseHomeURL(pageURL(owner)))return null;
            const identity=courseURLContext(pageURL(owner)),frame=owner.getElementById('frame_content-zj');
            if(identity.conflict||!['course','classroom','student'].every(key=>/^\d+$/.test(identity[key]))||!frame?.isConnected)return null;
            const declared=new URL(frame.getAttribute('src'),owner.baseURI),sourceDoc=frame.contentDocument,loaded=pageURL(sourceDoc);
            const declaredIdentity=courseURLContext(declared),loadedIdentity=courseURLContext(loaded);
            if(!sourceDoc?.body||!isCourseHomeURL(declared,true)||!isCourseHomeURL(loaded,true)
                ||declaredIdentity.conflict||loadedIdentity.conflict||!sameCourseHomeIdentity(identity,declaredIdentity)
                ||!sameCourseHomeIdentity(identity,loadedIdentity))return null;
            return {frame,sourceDoc,identity};
        } catch {return null;}
    }
    function mountCourseHomeChapterEntry(owner) {
        const local=isCourseHomeURL(pageURL(owner),true),context=local?resolveCourseHomeCatalog(owner):courseHomeChapterEntryContext(owner);
        if(!context)return;
        const {sourceDoc:doc,frame,identity}=context;
        const search=doc.getElementById('searchChapterListByName')?.closest('.dataSearch');
        const header=search?.closest('.chapter_head');
        if(!header)return;
        let host=doc.getElementById('cx-ai-course-home-toolbar');
        if(!host) {
            host=doc.createElement('div');host.id='cx-ai-course-home-toolbar';
            // Native search floats right. The following float sits immediately to its left.
            host.style.cssText='float:right;display:inline-flex;align-items:center;height:36px;max-width:100%;box-sizing:border-box';
            const shadow=host.attachShadow({mode:'open'});
            shadow.innerHTML='<style>button{font:13px/1.5 "Microsoft YaHei",sans-serif;border:0;border-radius:7px;height:36px;padding:6px 14px;background:#edf2ff;color:#355dcc;cursor:pointer;white-space:nowrap}button:focus-visible{outline:2px solid #3268df;outline-offset:2px}</style><button type="button" aria-haspopup="dialog">学习通AI助手</button>';
            registerAssistantUiHost(host);
        }
        const button=host.shadowRoot.querySelector('button');
        button.onclick=event=>{
            if(!trustedAssistantActivation(event,button))return;
            if(local) {
                const current=resolveCourseHomeCatalog(owner);
                if(current&&host.isConnected&&sameCourseHomeIdentity(identity,current.identity))
                    owner.defaultView.parent.postMessage({channel:COURSE_HOME_CHANNEL,kind:'open-panel',identity},COURSE_HOME_ORIGIN);
                return;
            }
            const current=courseHomeChapterEntryContext(owner);
            if(!current||current.frame!==frame||current.sourceDoc!==doc||!sameCourseHomeIdentity(identity,current.identity)
                ||!host.isConnected||doc.getElementById(host.id)!==host)return;
            controller?.togglePanel();
        };
        if(search.nextElementSibling!==host)search.after(host);
    }
    function courseHomeFail(id,message,status='failed') {
        const record=courseHomeRecord(id);
        if(record && ['preparing','navigating','waiting'].includes(record.status))courseHomeUpdate(id,{status,message,options:{...record.options,submit:false}});
    }
    function courseHomeBoundary(id,entry) {
        const record=courseHomeRecord(id),locked=entry.navigation.status==='sequence-locked';
        if(!record)return;
        courseHomeUpdate(id,{status:'blocked',message:locked?`章节“${entry.title}”尚未解锁，请先完成平台前置任务后重试`:`章节“${entry.title}”的原生入口尚未确认，请刷新目录后重试`,
            navigationBoundary:{chapterId:entry.chapterId,status:locked?'sequence-locked':'unknown'},options:{...record.options,submit:false}});
    }
    function courseHomeRowEntry(doc,identity,row) {
            if(!identity||!row?.isConnected||row.closest('[inert],[disabled],[aria-disabled="true"],[data-locked="true"]'))return null;
            const call=/^\s*(?:return\s+)?(?:window\.)?toOld\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]\s*(?:,\s*\d+\s*)?\)\s*;?\s*$/.exec(row.getAttribute('onclick')||'');
            if(call && call[1]===identity.course && call[3]===identity.classroom && row.id===`cur${call[2]}`
                && doc.querySelectorAll(`[id="${row.id}"]`).length===1) {
                // Read the native handler's declared server only to validate support; the platform builds its own URL.
                let server;try{
                    let page=doc===document&&typeof unsafeWindow!=='undefined'?unsafeWindow:doc.defaultView;
                    if(doc!==document&&typeof unsafeWindow!=='undefined'&&isCourseHomeURL(pageURL(document))) {
                        const nativeFrame=unsafeWindow.document.getElementById('frame_content-zj');
                        if(nativeFrame?.contentDocument===doc)page=nativeFrame.contentWindow;
                    }
                    server=new URL(page.ServerHost?.mooc1Domain,doc.baseURI);
                }catch{return null;}
                if(!['https:','http:'].includes(server.protocol)||!isCourseStudyHost(server.hostname)||!['','/','/mooc-ans','/mooc-ans/'].includes(server.pathname))return null;
                return {node:row,chapterId:call[2],origin:server.origin};
            }
            if(row.hasAttribute('onclick'))return null;
            for(const link of row.querySelectorAll('a[href]')) {
                if(link.hasAttribute('onclick'))continue;
                let url;try{url=new URL(link.getAttribute('href'),doc.baseURI);}catch{continue;}
                let destination=url;
                if(isCourseStudyHost(url.hostname) && url.pathname==='/mycourse/transfer') {
                    try{destination=new URL(url.searchParams.get('refer'));}catch{continue;}
                    if(destination.origin!==url.origin)continue;
                }
                const context=courseURLContext(destination);
                if(!isCourseStudyURL(destination)||!sameCourseHomeIdentity(context,identity)||context.conflict||!/^\d+$/.test(context.chapterId||'')
                    ||row.id!==`cur${context.chapterId}`||doc.querySelectorAll(`[id="${row.id}"]`).length!==1)continue;
                return {node:link,chapterId:context.chapterId,url,origin:url.origin};
            }
        return null;
    }
    async function courseHomeNavigate(id) {
        if(courseHomeNavigations.has(id)||courseHomeClosed||!isCourseHomeURL(pageURL(document),true))return;
        const tab=await courseHomeTab(),tabState=await courseHomeTabRead(),record=courseHomeRecord(id),identity=courseHomeIdentity();
        if(!record||record.status!=='preparing'||record.sourceTab!==tab.cxCourseTabId||record.expiresAt<Date.now()
            ||tabState.cxCourseLaunchId!==id||!sameCourseHomeIdentity(record.identity,identity))return;
        let parentOK=false;try{parentOK=isCourseHomeURL(new URL(document.referrer));}catch{}
        if(window===window.top||!parentOK)return;
        const blocker=courseHomeBlocker(document);if(blocker){courseHomeFail(id,blocker);return;}
        const catalog=readCourseCatalog(document),selection=courseHomeSelection(catalog,record.options.skipLearned);
        if(selection.status==='unready'){if(record.message!==selection.message)courseHomeUpdate(id,{message:selection.message});return;}
        if(selection.status==='complete'){courseHomeUpdate(id,{status:'complete',emptyCourse:selection.empty===true,message:record.options.mode==='unlock'?'当前课程没有待解锁任务':selection.message,options:{...record.options,submit:false}});return;}
        if(selection.entry.navigation.status!=='available') {
            courseHomeBoundary(id,selection.entry);return;
        }
        if(courseHomeNavigations.has(id))return;
        courseHomeNavigations.add(id);
        await courseHomeBindTab(id);
        const current=courseHomeRecord(id);
        if(courseHomeClosed||current?.status!=='preparing'||current.expiresAt<Date.now()||!sameCourseHomeIdentity(courseHomeIdentity(),identity))return;
        const fresh=courseHomeSelection(readCourseCatalog(document),current.options.skipLearned);
        if(fresh.status!=='target'){courseHomeNavigations.delete(id);return;}
        const entry=fresh.entry.navigation.status==='available'&&courseHomeRowEntry(document,identity,fresh.entry.node);
        if(!entry){courseHomeBoundary(id,fresh.entry);return;}
        const queueLaunch=Boolean(current.queueContext),originalTarget=entry.node.getAttribute('target');
        if(queueLaunch&&entry.url)entry.node.setAttribute('target','_top');
        const newTab=!queueLaunch&&entry.url && !['','_self','_top','_parent'].includes((entry.node.getAttribute('target')||'').toLowerCase());
        const original=entry.node.getAttribute('href');
        if(newTab) {
            if(entry.url.hash){courseHomeFail(id,'该新窗口入口无法安全关联，请手动进入学习页面');return;}
            entry.url.hash=`cx-ai-launch=${id}`;entry.node.setAttribute('href',entry.url.href);
        }
        courseHomeUpdate(id,{status:'navigating',chapterId:entry.chapterId,startPrefix:current.options.skipLearned?fresh.prefix:null,
            expectedOrigin:entry.origin,allowNewTab:Boolean(newTab),message:`正在进入：${fresh.entry.title}`});
        try {entry.node.click();}
        catch {courseHomeFail(id,'原生章节导航失败，请重新开始');}
        finally {
            if(newTab)setTimeout(()=>{if(entry.node.isConnected && entry.node.getAttribute('href')===entry.url.href)entry.node.setAttribute('href',original);},0);
            if(queueLaunch&&entry.url)setTimeout(()=>{if(entry.node.isConnected){if(originalTarget===null)entry.node.removeAttribute('target');else entry.node.setAttribute('target',originalTarget);}},0);
        }
    }
    // Cross-window messages only identify a private GM record; no page message can create a launch or supply settings.
    function initCourseHomeLaunchTransport() {
        if(courseHomeTransportReady)return;courseHomeTransportReady=true;
        const url=pageURL(document),top=window===window.top;
        if(!isCourseHomeURL(url)&&!isCourseHomeURL(url,true)&&!isCourseStudyURL(url)
            &&!(top&&isCourseStudyHost(url?.hostname)&&url?.pathname==='/mycourse/transfer'))return;
        const frameLoaded=event=>{
            if(top&&isCourseHomeURL(url)&&event.target?.id==='frame_content-zj')resetCourseHomeFrameBridge();
        };
        const captureCatalog=()=>{
            if(!top&&isCourseHomeURL(url,true)&&!courseHomeClosed){const context=resolveCourseHomeCatalog(document);if(context)readCourseHomeCatalog(context);}
        };
        if(!top&&isCourseHomeURL(url,true))document.addEventListener('readystatechange',captureCatalog);
        document.addEventListener('load',frameLoaded,true);
        window.addEventListener('pagehide',()=>{
            courseHomeClosed=true;document.removeEventListener('load',frameLoaded,true);
            document.removeEventListener('readystatechange',captureCatalog);
            resetCourseHomeFrameBridge();closeCourseHomeChildFrame();
        },{once:true});
        window.addEventListener('message',event=>{
            const data=event.data;
            if(courseHomeClosed||data?.channel!==COURSE_HOME_CHANNEL)return;
            if(!top&&isCourseHomeURL(url,true)&&event.origin===COURSE_HOME_ORIGIN&&(event.source===window.parent||event.source===null)) {
                if(data.kind==='catalog-bind'){bindCourseHomeChildFrame(data.id).catch(()=>{});return;}
                if(data.kind==='catalog-navigate'){courseHomeChildChapterNavigation(data.id,data.commandId);return;}
            }
            if(data.kind==='open-panel'&&top&&isCourseHomeURL(url)&&event.origin===COURSE_HOME_ORIGIN) {
                const frame=document.getElementById('frame_content-zj');
                let frameURL;try{frameURL=new URL(frame?.getAttribute('src'),document.baseURI);}catch{return;}
                if(!frame?.isConnected||event.source!==frame.contentWindow&&event.source!==null||!isCourseHomeURL(frameURL,true)
                    ||!sameCourseHomeIdentity(data.identity,courseHomeIdentity(document))||!sameCourseHomeIdentity(data.identity,courseURLContext(frameURL)))return;
                controller?.togglePanel();return;
            }
            if(data.kind==='navigate'&&event.origin===COURSE_HOME_ORIGIN&&(event.source===window.parent||event.source===null)) {
                courseHomeNavigate(data.id).catch(()=>courseHomeFail(data.id,'无法关联章节页面，请重新开始'));return;
            }
            if(data.kind==='opener-probe'&&event.source&&isCourseHomeURL(url,window!==window.top)) {
                let origin;try{origin=new URL(event.origin);}catch{return;}
                if(!isCourseStudyURL(new URL('/mycourse/studentstudy',origin))||!courseHomeUUID(data.hello))return;
                (async()=>{
                    const tab=await courseHomeTab(),record=courseHomeRecord(tab.cxCourseLaunchId),hello=get(COURSE_HOME_PREFIX+'hello:'+data.hello,null);
                    if(!record||record.status!=='navigating'||record.expiresAt<Date.now()||record.sourceTab!==tab.cxCourseTabId
                        ||!hello||hello.origin!==event.origin||Date.now()-hello.at>10000||!courseHomeUUID(hello.tabId)
                        ||!sameCourseHomeIdentity(record.identity,hello.identity)||hello.chapterId!==record.chapterId
                        ||record.boundNewTab&&record.boundNewTab!==hello.tabId||record.expectedOrigin&&record.expectedOrigin!==event.origin)return;
                    // The originating realm serializes binding; a second target cannot replace the selected tab.
                    courseHomeUpdate(record.id,{boundNewTab:hello.tabId,targetTab:hello.tabId,expectedOrigin:event.origin});
                    event.source.postMessage({channel:COURSE_HOME_CHANNEL,kind:'opener-bound',id:record.id,hello:data.hello},event.origin);
                })().catch(()=>{});
            }
        });
        if(top)courseHomeCaptureMarker().catch(()=>{});
    }
    async function courseHomeCaptureMarker() {
        const url=pageURL(document),params=new URLSearchParams(url.hash.slice(1)),id=params.get('cx-ai-launch');
        if(!courseHomeUUID(id))return;
        const record=courseHomeRecord(id),tab=await courseHomeTab();
        if(!record||!record.allowNewTab||record.status!=='navigating'||record.expiresAt<Date.now()||record.expectedOrigin!==url.origin
            ||record.boundNewTab&&record.boundNewTab!==tab.cxCourseTabId)return;
        await navigator.locks.request(`cx-ai-course-launch-bind:${id}`,async()=>{
            const latest=courseHomeRecord(id);
            if(!latest||latest.status!=='navigating'||latest.boundNewTab&&latest.boundNewTab!==tab.cxCourseTabId)return;
            courseHomeUpdate(id,{targetTab:tab.cxCourseTabId,boundNewTab:tab.cxCourseTabId});await courseHomeBindTab(id);
            params.delete('cx-ai-launch');history.replaceState(history.state,'',url.pathname+url.search+(params.size?'#'+params:''));
        });
    }
    async function courseHomeOpenerRequest() {
        if(!window.opener)return;
        let fromHome=false;try{fromHome=new URL(document.referrer).origin===COURSE_HOME_ORIGIN;}catch{}
        if(!fromHome)return;
        const tab=await courseHomeTab(),hello=crypto.randomUUID(),until=Date.now()+30000;
        let identity=courseStudyContext(document);
        while(!courseHomeClosed&&(!identity.complete||!identity.chapterId)&&Date.now()<until){await new Promise(resolve=>setTimeout(resolve,500));identity=courseStudyContext(document);}
        if(courseHomeClosed||!identity.complete||!identity.chapterId)return;
        const key=COURSE_HOME_PREFIX+'hello:'+hello;
        set(key,{tabId:tab.cxCourseTabId,identity:{course:identity.course,classroom:identity.classroom,student:identity.student},chapterId:identity.chapterId,origin:location.origin,at:Date.now()});
        await new Promise(resolve=>{
            const receive=event=>{
                if(event.source!==window.opener||event.origin!==COURSE_HOME_ORIGIN||event.data?.channel!==COURSE_HOME_CHANNEL
                    ||event.data.kind!=='opener-bound'||event.data.hello!==hello)return;
                const record=courseHomeRecord(event.data.id);
                if(record?.targetTab===tab.cxCourseTabId&&record.expectedOrigin===location.origin)courseHomeBindTab(record.id).then(finish,finish);
            };
            const finish=()=>{clearInterval(timer);clearTimeout(deadline);window.removeEventListener('message',receive);GM_deleteValue(key);resolve();};
            const probe=()=>{if(!courseHomeClosed)window.opener?.postMessage({channel:COURSE_HOME_CHANNEL,kind:'opener-probe',hello},COURSE_HOME_ORIGIN);};
            window.addEventListener('message',receive);const timer=setInterval(probe,500),deadline=setTimeout(finish,2500);probe();
        });
    }
    function createCourseHomeLauncher(doc,ctl) {
        if(window!==window.top||!isCourseHomeURL(pageURL(doc)))return null;
        let pending=null,timer=null,starting=false,generation=0;
        const active=()=>{const identity=courseHomeIdentity(doc);if(!identity)return false;const scope=COURSE_SCORE_PREFIX+[identity.course,identity.classroom,identity.student].map(encodeURIComponent).join(':');return ['cx_course_run:','cx_course_unlock:'].some(prefix=>{const run=get(prefix+scope,null);return run?.status==='running'&&Date.now()-run.heartbeat<15000;});};
        const finish=(message,phase='error')=>{clearInterval(timer);timer=null;pending=null;starting=false;ctl.report(message,phase,false);};
        const poll=()=>{
            if(courseHomeClosed){clearInterval(timer);return;}
            const record=courseHomeRecord(pending);
            if(!record){finish('启动记录已失效，请重新开始');return;}
            if(!sameCourseHomeIdentity(record.identity,courseHomeIdentity(doc))){courseHomeFail(record.id,'课程或账号已变化');finish('课程或账号已变化，已取消启动');return;}
            const currentFrame=doc.getElementById('frame_content-zj');
            let declared;try{declared=new URL(currentFrame?.getAttribute('src'),doc.baseURI);}catch{}
            if(isCourseHomeURL(declared,true)&&!sameCourseHomeIdentity(courseURLContext(declared),record.identity)) {
                courseHomeFail(record.id,'章节页面的课程或账号已变化');finish('章节页面的课程或账号已变化，已取消启动');return;
            }
            const chapterDoc=resolveCourseHomeCatalog(doc)?.sourceDoc;
            const blocker=courseHomeBlocker(doc)||(chapterDoc&&courseHomeBlocker(chapterDoc));
            if(blocker){courseHomeFail(record.id,blocker,/未解锁/.test(blocker)?'blocked':'failed');finish(blocker,/未解锁/.test(blocker)?'idle':'error');return;}
            if(record.status==='started'){finish('已在课程学习页面启动','done');return;}
            if(record.status==='complete'){finish(record.message,'done');return;}
            if(record.status==='blocked'){finish(record.message,'idle');return;}
            if(['failed','cancelled'].includes(record.status)){finish(record.message,record.status==='cancelled'?'idle':'error');return;}
            if(Date.now()>record.expiresAt){courseHomeFail(record.id,'进入学习页面超时，请检查原生入口后重试');finish('进入学习页面超时，请检查原生入口后重试');return;}
            if(record.message&&ctl.state.message!==record.message)ctl.report(record.message,'course-navigating',true);
            if(record.status==='preparing') {
                const frame=doc.getElementById('frame_content-zj');
                if(frame) {
                    let url;try{url=new URL(frame.getAttribute('src'),doc.baseURI);}catch{return;}
                    if(isCourseHomeURL(url,true)&&sameCourseHomeIdentity(courseURLContext(url),record.identity))frame.contentWindow?.postMessage({channel:COURSE_HOME_CHANNEL,kind:'navigate',id:record.id},url.origin);
                }
            }
        };
        const api={get pending(){return Boolean(pending||starting);},get available(){return Boolean(courseHomeIdentity(doc)&&typeof GM_getTab==='function'&&typeof GM_saveTab==='function'&&doc.defaultView.navigator.locks);},get active(){return active();},
            async start(options) {
                if(api.pending||api.active||ctl.state.busy)return;
                const turn=++generation;
                starting=true;ctl.report('正在准备课程入口…','course-navigating',true);
                try {
                    if(!api.available)throw new Error('课程身份或标签页交接能力尚未就绪，请刷新后重试');
                    const optionsSnapshot=courseHomeOptions(options.mode==='unlock'?options:{...options,videoDelay:options.queueContext?options.videoDelay:readCourseVideoDelaySettings()}),model=optionsSnapshot.mode==='unlock'?null:courseHomeModelSignature();
                    const createdAt=Date.now(),identity=courseHomeIdentity(doc),tab=await courseHomeTab(),id=crypto.randomUUID();
                    if(turn!==generation)return;
                    if(courseHomeClosed||!sameCourseHomeIdentity(identity,courseHomeIdentity(doc)))throw new Error('课程或账号已变化');
                    if(optionsSnapshot.mode!=='unlock'&&model!==courseHomeModelSignature())throw new Error('模型设置已变化，请重新开始');
                    if(api.active)throw new Error('本课程已有运行任务，请在学习页面查看');
                    const blocker=courseHomeBlocker(doc);if(blocker)throw new Error(blocker);
                    const frame=doc.getElementById('frame_content-zj');
                    const navigation=doc.querySelector('li[dataname="zj"] a[data-url="/mooc2-ans/mycourse/studentcourse"]');
                    if(!frame&&!navigation)throw new Error('未找到原生章节入口，请先打开课程章节栏目');
                    if(tab.cxCourseLaunchId)courseHomeFail(tab.cxCourseLaunchId,'已由新的启动操作替代','cancelled');
                    const record={id,identity,sourceTab:tab.cxCourseTabId,targetTab:tab.cxCourseTabId,createdAt,expiresAt:createdAt+COURSE_HOME_TTL,status:'preparing',model,options:optionsSnapshot,message:optionsSnapshot.mode==='unlock'?'正在进入学习页面，准备解锁课程':'正在准备课程入口'};
                    if(options.queueContext) {
                        if(!courseQueueValidContext(options.queueContext,doc))throw new Error('课程队列已停止或身份已变化');
                        record.queueContext={...options.queueContext};courseQueueAttachLaunch(record.queueContext,id);
                    }
                    set(COURSE_HOME_PREFIX+id,record);pending=id;await courseHomeBindTab(id);
                    if(courseHomeClosed||turn!==generation||courseHomeRecord(id)?.status!=='preparing')return;
                    if(!frame||!doc.querySelector('li[dataname="zj"].curNav')) {
                        if(navigation)navigation.click();
                    }
                    starting=false;timer=setInterval(poll,500);poll();
                    return id;
                } catch(error){if(turn!==generation)return;if(pending)courseHomeFail(pending,error.message);finish(error.message);}
            },
            cancel(){generation++;const record=courseHomeRecord(pending);if(record?.status==='consumed'||record?.status==='started'){finish('启动已交接，请在学习页面停止','done');return;}if(pending)courseHomeFail(pending,'已取消启动','cancelled');finish('已取消启动','idle');}
        };
        const generationAtMount=generation;
        if(api.available)courseHomeTab().then(tab=>{
            if(courseHomeClosed||generation!==generationAtMount||api.pending)return;
            const record=courseHomeRecord(tab.cxCourseLaunchId);
            if(!record||record.sourceTab!==tab.cxCourseTabId||!['preparing','navigating','waiting'].includes(record.status))return;
            if(!sameCourseHomeIdentity(record.identity,courseHomeIdentity(doc))){courseHomeFail(record.id,'课程或账号已变化');return;}
            pending=record.id;ctl.report('正在继续课程启动交接…','course-navigating',true);timer=setInterval(poll,500);poll();
        }).catch(()=>{});
        const identityAtMount=courseHomeIdentity(doc);
        const scope=identityAtMount?COURSE_SCORE_PREFIX+[identityAtMount.course,identityAtMount.classroom,identityAtMount.student].map(encodeURIComponent).join(':'):null;
        const runListeners=scope&&typeof GM_addValueChangeListener==='function'?['cx_course_run:','cx_course_unlock:'].map(prefix=>GM_addValueChangeListener(prefix+scope,()=>{
            if(!courseHomeClosed&&!api.pending)renderRunState(ctl.state);
        })):[];
        doc.defaultView.addEventListener('pagehide',()=>{clearInterval(timer);if(typeof GM_removeValueChangeListener==='function')for(const listener of runListeners)GM_removeValueChangeListener(listener);},{once:true});return api;
    }
    async function resumeCourseHomeLaunch(runner,ctl) {
        if(!isCourseStudyURL(pageURL(document))||window!==window.top||typeof GM_getTab!=='function')return false;
        let tab;try{await courseHomeCaptureMarker();tab=await courseHomeTab();if(!tab.cxCourseLaunchId){await courseHomeOpenerRequest();tab=await courseHomeTab();}}catch{return false;}
        const id=tab.cxCourseLaunchId,initial=courseHomeRecord(id);
        if(!initial)return false;
        if(initial.targetTab!==tab.cxCourseTabId)return false;
        if(initial.queueContext&&!courseQueueValidContext(initial.queueContext)){courseHomeFail(id,'课程队列已取消或身份已变化');await courseHomeBindTab(null);return true;}
        if(!['preparing','navigating','waiting'].includes(initial.status)){await courseHomeBindTab(null);return !initial.queueContext;}
        ctl.openPanel('chapters');ctl.report('正在等待课程学习页面就绪…','course-navigating',true);
        while(!courseHomeClosed) {
            const record=courseHomeRecord(id),identity=courseStudyContext(document);
            if(!record||!['preparing','navigating','waiting'].includes(record.status)||record.targetTab!==tab.cxCourseTabId)break;
            if(record.expiresAt<Date.now()){courseHomeFail(id,'启动等待超时，请重新开始');break;}
            if(record.queueContext&&!courseQueueValidContext(record.queueContext)){courseHomeFail(id,'课程队列已取消或身份已变化');break;}
            if(identity.reason==='identity-conflict'||identity.reason==='parameter-conflict'||identity.complete&&!sameCourseHomeIdentity(identity,record.identity)) {courseHomeFail(id,'学习页面的课程或账号与启动记录不一致');break;}
            if(identity.complete && identity.chapterId && record.chapterId!==identity.chapterId){courseHomeFail(id,'到达的章节与原生入口不一致');break;}
            if(record.expectedOrigin && record.expectedOrigin!==location.origin){courseHomeFail(id,'学习页面来源与原生入口不一致');break;}
            const blocker=courseBlocker(courseFrameTree(document).documents);if(blocker){courseHomeFail(id,blocker);break;}
            if(record.options.mode!=='unlock'&&courseHomeModelSignature()!==record.model){courseHomeFail(id,'模型设置已变化，请重新开始');break;}
            const catalog=identity.complete&&readCourseCatalog(document),tree=courseFrameTree(document);
            const legacyReady=catalog?.structure!=='legacy-h4'||catalog.entries.filter(item=>!item.isGroup&&item.active).length===1
                &&!tree.inaccessible.length&&coursePageTasks(tree).some(task=>['video','document','quiz','knowledge-graph'].includes(task.type));
            if(identity.chapterId && catalog?.entries.some(item=>!item.isGroup) && courseContentReady(document)&&legacyReady) {
                if(!navigator.locks){courseHomeFail(id,'当前浏览器不支持安全交接，请手动开始');break;}
                await navigator.locks.request(`cx-ai-course-launch:${id}`,async()=>{
                    const latest=courseHomeRecord(id);
                    if(courseHomeClosed||!latest||!['preparing','navigating','waiting'].includes(latest.status)||latest.expiresAt<Date.now()
                        ||latest.targetTab!==tab.cxCourseTabId||!sameCourseHomeIdentity(courseStudyContext(document),latest.identity))return;
                    if(latest.queueContext&&!courseQueueValidContext(latest.queueContext)){courseHomeFail(id,'课程队列已取消');return;}
                    if(runner.busy||courseRunActive(document)){courseHomeFail(id,'本课程已有运行任务，未重复启动');return;}
                    const options=courseHomeOptions(latest.options),startedAt=Date.now();
                    courseHomeUpdate(id,{status:'consumed',message:options.mode==='unlock'?'正在启动解锁课程':'正在启动自动学习',options:{...latest.options,submit:false}});await courseHomeBindTab(null);
                    if(courseHomeClosed)return;
                    if(latest.expiresAt<Date.now()||!sameCourseHomeIdentity(courseStudyContext(document),latest.identity)||(options.mode!=='unlock'&&courseHomeModelSignature()!==latest.model)
                        ||latest.queueContext&&!courseQueueValidContext(latest.queueContext)||courseBlocker(courseFrameTree(document).documents)) {
                        courseHomeUpdate(id,{status:'failed',message:'启动前课程或模型状态已变化，请重新开始'});
                        ctl.report('启动前课程或模型状态已变化，请重新开始','error',false);return;
                    }
                    const freshIdentity=courseStudyContext(document),freshCatalog=readCourseCatalog(document);
                    if(!freshCatalog||freshIdentity.chapterId!==latest.chapterId) {
                        courseHomeUpdate(id,{status:'failed',message:'启动前章节已变化，请重新开始'});ctl.report('启动前章节已变化，请重新开始','error',false);return;
                    }
                    if(options.mode!=='unlock')options.startChapterId=courseHomeStartChapter(latest,freshCatalog);
                    ctl.state.busy=false;let settled=false;
                    Promise.resolve(runner.start(options)).catch(()=>{}).finally(()=>{settled=true;});
                    for(let attempts=0;!courseHomeClosed&&attempts<10;attempts++) {
                        if(runner.busy||runner.report?.startedAt>=startedAt){courseHomeUpdate(id,{status:'started',message:'已在课程学习页面启动'});return;}
                        if(settled)break;
                        await new Promise(resolve=>setTimeout(resolve,500));
                    }
                    courseHomeUpdate(id,{status:'failed',message:'自动学习未启动，请查看学习页面状态'});
                });
                if(!courseHomeClosed&&!runner.busy&&ctl.state.busy)ctl.report(courseHomeRecord(id)?.message||'启动已取消，请重新开始','error',false);
                return true;
            }
            await new Promise(resolve=>setTimeout(resolve,500));
        }
        if(!courseHomeClosed){ctl.report(courseHomeRecord(id)?.message||'启动交接已取消','error',false);await courseHomeBindTab(null);}
        return true;
    }
