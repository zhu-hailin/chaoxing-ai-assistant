    // 仅控制已确认的超星 PPT 阅读器；不交换账户、资源地址、Key 或任务上报。
    const COURSE_DOCUMENT_CHANNEL = 'cx-ai-document-v1';
    const COURSE_DOCUMENT_ORIGINS = ['https://pan-yz.chaoxing.com','https://mooc1.chaoxing.com'];
    const COURSE_DOCUMENT_MAILBOX = 'cx-ai-ppt-request:';
    function courseDocumentStorageAvailable() {
        return typeof GM_addValueChangeListener==='function' && typeof GM_removeValueChangeListener==='function'
            && typeof GM_setValue==='function' && typeof GM_getValue==='function' && typeof GM_deleteValue==='function';
    }
    function courseRemoteReaderFrame(frame) {
        if (!frame?.matches('iframe[id="panView"]') || !frame.closest('[id="img"].imglook')) return false;
        try {
            const url = new URL(frame.getAttribute('src'),frame.ownerDocument.baseURI);
            return COURSE_DOCUMENT_ORIGINS.includes(url.origin) && /^\/(?:mooc-ans\/screen\/file|screen\/v2\/file_)/.test(url.pathname);
        } catch { return false; }
    }
    function courseDocumentBridgeRequest(frame, op, signal, timeout = 30000) {
        if(!['read','step','bottom','top','scan'].includes(op))return Promise.reject(new Error('未知的资料阅读操作'));
        if(!courseRemoteReaderFrame(frame))return Promise.reject(new Error('未知的跨域资料阅读器'));
        // postMessage 的发送者是执行脚本的 window，并非目标 iframe 所属文档。
        const view=window,child=frame.contentWindow,id=crypto.randomUUID();
        const originalSrc=frame.getAttribute('src'),key=COURSE_DOCUMENT_MAILBOX+id;
        return new Promise((resolve,reject)=>{
            let timer,retry,listener,settled=false,attempt=0;
            const current=()=>frame.isConnected && frame.getAttribute('src')===originalSrc;
            const finish=(error,value)=>{
                if(settled)return;settled=true;clearTimeout(timer);clearInterval(retry);
                view.removeEventListener('message',receive);signal?.removeEventListener('abort',abort);
                if(listener!==undefined){GM_removeValueChangeListener(listener);GM_deleteValue(key);}
                error?reject(error):resolve(value);
            };
            const abort=()=>finish(new Error('资料阅读已取消'));
            const accept=data=>{
                if(data?.channel!==COURSE_DOCUMENT_CHANNEL || data.id!==id || data.kind!=='result')return;
                if(!current()){finish(new Error('资料页面已切换，已停止'));return;}
                if(data.error){finish(new Error(data.error));return;}
                const state=data.state;
                if(!state || typeof state.loaded!=='boolean' || !['top','height','total'].every(k=>Number.isFinite(state[k])&&state[k]>=0))return;
                if(state.canBottom!==undefined && (state.canBottom!==true || !['imageCount','pendingImages'].every(k=>Number.isInteger(state[k])&&state[k]>=0) || state.pendingImages>state.imageCount))return;
                finish(null,state);
            };
            const receive=event=>{
                if(event.source===child && COURSE_DOCUMENT_ORIGINS.includes(event.origin))accept(event.data);
            };
            view.addEventListener('message',receive);signal?.addEventListener('abort',abort,{once:true});
            if(signal?.aborted){abort();return;}
            if(courseDocumentStorageAvailable())listener=GM_addValueChangeListener(key,(_key,_old,data)=>accept(data));
            timer=setTimeout(()=>finish(courseTimeoutError('PPT 滚动阅读器未响应，请检查子脚本是否加载并重新打开本节')),timeout);
            const send=()=>{
                if(settled)return;
                if(!current()){finish(new Error('资料页面已切换，已停止'));return;}
                try {
                    const request={channel:COURSE_DOCUMENT_CHANNEL,kind:'request',id,op,attempt:++attempt};
                    if(listener!==undefined)GM_setValue(key,request);
                    for(const origin of COURSE_DOCUMENT_ORIGINS){
                        if(settled)break;
                        // bind 本身不执行滚动；随机信箱只发送给此 iframe，不使用文件名匹配。
                        if(listener!==undefined)child.postMessage({channel:COURSE_DOCUMENT_CHANNEL,kind:'bind',id},origin);
                        if(!settled)child.postMessage(request,origin);
                    }
                } catch {finish(new Error('PPT 阅读器通信失败'));}
            };
            retry=setInterval(send,250);send();
        });
    }
    function courseDocumentAncestorSource(view, source) {
        if(!source)return false;
        // 只接受本阅读器自己的祖先窗口，排除同源兄弟 iframe 和无关窗口。
        try {
            let ancestor=view.parent;
            for(let depth=0;ancestor && ancestor!==view && depth<12;depth++) {
                if(source===ancestor)return true;
                const next=ancestor.parent;if(next===ancestor)break;ancestor=next;
            }
        } catch { return false; }
        return false;
    }
    function initCourseDocumentBridge(doc = document) {
        const view=doc.defaultView;
        let url;try{url=new URL(doc.URL);}catch{return;}
        if(view===view.parent || !COURSE_DOCUMENT_ORIGINS.includes(url.origin) || !/^\/(?:screen\/v2\/file_|mooc-ans\/screen\/file)/.test(url.pathname))return;
        const responses=new Map(),mailboxes=new Map(),targetIds=new WeakMap();let targetSequence=0;
        const valid=data=>data?.channel===COURSE_DOCUMENT_CHANNEL && typeof data.id==='string' && /^[\w-]{1,100}$/.test(data.id);
        const operate=(data,respond)=>{
            if(!valid(data)||data.kind!=='request'||!['read','step','bottom','top','scan'].includes(data.op))return;
            const cached=responses.get(data.id);
            if(cached){if(cached.op===data.op)respond(cached.response);return;}
            const reply=result=>{
                const response={channel:COURSE_DOCUMENT_CHANNEL,kind:'result',id:data.id,...result};
                responses.set(data.id,{op:data.op,response});
                if(responses.size>64)responses.delete(responses.keys().next().value);
                respond(response);
            };
            const blocker=courseBlocker([doc]);if(blocker){reply({error:blocker});return;}
            const content=doc.querySelector('.fileBox ul li img'),root=doc.scrollingElement||doc.documentElement;
            if(!content || !courseElementVisible(content)){reply({state:{loaded:false,top:0,height:0,total:0,canBottom:true,imageCount:0,pendingImages:0}});return;}
            const contentRoot=content.closest('ul'),target=courseDocumentScrollTargets(content).filter(n=>n.ownerDocument===doc)[0]||root;
            if(!targetIds.has(target))targetIds.set(target,String(++targetSequence));
            // step 保留旧步长；top/scan 仅用于到底后发现懒加载时的快速遍历。
            if(target.clientHeight>0 && courseDocumentScrollState(target,contentRoot).loaded) {
                if(data.op==='bottom')courseScrollToBottom(target);
                else if(data.op==='top')courseDocumentScrollTo(target,0);
                else if(data.op==='step'||data.op==='scan')courseDocumentScrollTo(target,
                    Math.min(Math.max(0,target.scrollHeight-target.clientHeight),target.scrollTop+Math.max(1,Math.floor(target.clientHeight*(data.op==='scan'?0.9:0.8)))));
            }
            reply({state:{...courseDocumentScrollState(target,contentRoot),canBottom:true,targetId:targetIds.get(target)}});
        };
        const removeMailbox=id=>{
            const item=mailboxes.get(id);if(!item)return;
            clearTimeout(item.timer);GM_removeValueChangeListener(item.listener);mailboxes.delete(id);
        };
        const bind=id=>{
            const key=COURSE_DOCUMENT_MAILBOX+id;
            const read=data=>{
                if(data==null){removeMailbox(id);return;}
                if(data.id!==id)return;
                operate(data,response=>GM_setValue(key,response));
            };
            if(!mailboxes.has(id)){
                if(mailboxes.size>=32)removeMailbox(mailboxes.keys().next().value);
                const listener=GM_addValueChangeListener(key,(_key,_old,data)=>read(data));
                mailboxes.set(id,{listener,timer:setTimeout(()=>removeMailbox(id),60000)});
            }
            read(GM_getValue(key,null));
        };
        const receive=event=>{
            const data=event.data;
            if(event.origin!=='https://mooc1.chaoxing.com' || !valid(data))return;
            if(data.kind==='bind' && courseDocumentStorageAvailable()){
                // 扩展沙箱消息的 source 可能为 null。仅允许建立信箱，不接受其直接滚动命令。
                // 此例外还须有真实父页的超星 referrer；网页无法写油猴私有信箱。
                let referrerOK=false;try{referrerOK=new URL(doc.referrer).origin===event.origin;}catch{}
                if(courseDocumentAncestorSource(view,event.source) || event.source===null && referrerOK)bind(data.id);
                return;
            }
            if(!courseDocumentAncestorSource(view,event.source))return;
            // 按实际发送者回复，顶层请求不能回到中间 PDF 窗口。
            operate(data,response=>event.source.postMessage(response,event.origin));
        };
        const mark=()=>{doc.documentElement?.setAttribute('data-cx-document-bridge','v1.08');doc.documentElement?.setAttribute('data-cx-document-bridge-route','ancestor-v2');};
        mark();if(!doc.documentElement)doc.addEventListener('DOMContentLoaded',mark,{once:true});
        view.addEventListener('message',receive);
        view.addEventListener('pagehide',()=>{
            view.removeEventListener('message',receive);
            for(const id of [...mailboxes.keys()])removeMailbox(id);
            responses.clear();
        },{once:true});
    }
