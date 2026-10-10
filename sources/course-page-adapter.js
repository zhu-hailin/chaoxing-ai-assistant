    // 只读页面状态与原生控件适配。完成状态不写回，不构造任务上报请求。
    function courseElementVisible(node) {
        if (!node?.isConnected || node.closest('[hidden],[aria-hidden="true"]')) return false;
        for (let parent = node; parent; parent = parent.parentElement) {
            const style = parent.ownerDocument.defaultView.getComputedStyle(parent);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return true;
    }
    function courseFrameTree(owner) {
        const documents = [owner], inaccessible = [], seen = new Set([owner]);
        const root = owner.querySelector('#mainid #iframe');
        const visit = (frame, depth) => {
            if (depth > 12 || !courseElementVisible(frame)) return;
            try {
                const doc = frame.contentDocument;
                if (!doc?.documentElement) { if(!courseRemoteReaderFrame(frame))inaccessible.push(frame); return; }
                if (seen.has(doc)) return;
                seen.add(doc); documents.push(doc);
                for (const child of doc.querySelectorAll('iframe')) visit(child, depth + 1);
            } catch { if(!courseRemoteReaderFrame(frame))inaccessible.push(frame); }
        };
        if (root) visit(root, 0);
        return { documents, inaccessible, root };
    }
    function courseBlocker(documents) {
        for (const doc of documents) {
            for (const node of doc.querySelectorAll('.chapterVideoFaceMaskDiv,#fcqrimg[src],.face-recognition,[data-face-verification]')) {
                if (node.id === 'fcqrimg' && !node.getAttribute('src')) continue;
                if (courseElementVisible(node)) return '需要人脸识别，请自行处理；自动流程已停止';
            }
            for (const node of doc.querySelectorAll('.geetest_panel,.yidun_popup,[data-captcha],iframe[src*="captcha"],.captcha-container')) {
                if (courseElementVisible(node)) return '出现验证码，自动流程已停止';
            }
            for (const node of doc.querySelectorAll('#videoquiz-submit,.ans-videoquiz:not([hidden])')) {
                if (courseElementVisible(node)) return '视频中弹出交互题，需要人工处理';
            }
            for (const node of doc.querySelectorAll('form[action*="login"],.loginForm,[data-login-required]')) {
                if (courseElementVisible(node)) return '登录状态已失效，请重新登录';
            }
            for (const node of doc.querySelectorAll('[role="alert"],.layui-layer-content,.vjs-modal-dialog-content')) {
                if (!courseElementVisible(node)) continue;
                const text = clean(node.textContent);
                if (/人脸|身份核验/.test(text)) return '需要人脸识别，请自行处理；自动流程已停止';
                if (/验证码|人机验证/.test(text)) return '出现验证码，自动流程已停止';
                if (/尚未解锁|未解锁|无权访问|访问受限/.test(text)) return '章节未解锁或访问受限';
                if (/登录已过期|重新登录/.test(text)) return '登录状态已失效，请重新登录';
            }
        }
        return null;
    }
    function courseTabs(owner) {
        const nodes = [...owner.querySelectorAll('#prev_tab li[id^="dct"],#prev_tab [data-course-tab]')];
        const ids = new Set();
        return nodes.filter(node => node.id && !ids.has(node.id) && ids.add(node.id) && courseElementVisible(node))
            .map(node => ({ id:node.id, title:clean(node.textContent), node,
                active:node.classList.contains('active') || node.getAttribute('aria-selected') === 'true',
                disabled:node.getAttribute('aria-disabled') === 'true' || node.classList.contains('disabled') }));
    }
    function courseTaskContainer(node) {
        // 播放器本身和外层附件 iframe 都可能提供任务状态。
        let candidate = node, container = null;
        for (let depth = 0; candidate && depth < 12; depth++) {
            container = candidate.closest('.ans-attach-ct,[data-course-task]');
            if (container) return container;
            try { candidate = candidate.ownerDocument.defaultView.frameElement; } catch { break; }
        }
        return null;
    }
    function courseTaskLabel(container) {
        if(!container)return null;
        // 只读短标签，不能把题干里的“任务点”或整页文本当作任务状态。
        for(const label of container.querySelectorAll('span,em,p,div')) {
            if(label.children.length || !courseElementVisible(label))continue;
            const text=clean(label.textContent).replace(/\s/g,'');
            if(text==='任务点已完成')return 'complete';
            if(text==='任务点')return 'required';
        }
        return null;
    }
    function courseVisibleMarker(container, selector) {
        return Boolean(container && (container.matches(selector)&&courseElementVisible(container)
            || [...container.querySelectorAll(selector)].some(courseElementVisible)));
    }
    function courseTaskComplete(node) {
        const container = courseTaskContainer(node);
        if (!container) return null;
        const label=courseTaskLabel(container);
        if(label==='complete')return true;
        if (courseVisibleMarker(container,'.ans-job-finished,.icon_Completed,[data-completed="true"],[data-task-completed="true"]')) return true;
        if (container.matches('[data-completed="false"]') || courseVisibleMarker(container,'.ans-job-icon,.orangeNew')) return false;
        if(label==='required')return false;
        return null;
    }
    function courseQuizComplete(doc) {
        return [...doc.querySelectorAll('.testTit_status,[data-quiz-status],[data-quiz-completed="true"]')]
            .some(node => courseElementVisible(node) && (node.getAttribute('data-quiz-completed')==='true' || /^(已完成|已提交|提交成功)(?:[·|：:、,，]?(?:最终成绩|成绩|得分)?[（(]?\d+(?:\.\d+)?分[）)]?)?$/.test(clean(node.textContent).replace(/\s/g,''))));
    }
    function courseContentFingerprint(owner) {
        const root = owner.querySelector('#mainid #iframe');
        let doc;
        try { doc = root?.contentDocument; } catch {}
        return { root, doc, body:doc?.body, src:root?.getAttribute('src') || '', chapter:owner.querySelector('#curChapterId')?.value || '' };
    }
    function courseContentChanged(before, after) {
        return before.root !== after.root || before.doc !== after.doc || before.body !== after.body || before.src !== after.src;
    }
    function courseContentReady(owner) {
        const tree=courseFrameTree(owner);
        return !tree.inaccessible.length && tree.documents.length>1 && tree.documents.slice(1).every(doc=>doc.body && (doc.body.children.length || clean(doc.body.textContent)));
    }
    function courseDocumentScrollTo(target, top) {
        const value=target.style.getPropertyValue('scroll-behavior'),priority=target.style.getPropertyPriority('scroll-behavior');
        try {
            target.style.setProperty('scroll-behavior','auto','important');
            target.scrollTop=top;
        } finally {
            if(value)target.style.setProperty('scroll-behavior',value,priority);
            else target.style.removeProperty('scroll-behavior');
        }
        return {top:target.scrollTop,height:target.clientHeight,total:target.scrollHeight};
    }
    function courseScrollToBottom(target) {
        // 使用浏览器钳制后的实际位置；接近底部仍写一次，消除小数残余。
        return courseDocumentScrollTo(target,target.scrollHeight);
    }
    function courseDocumentScrollState(target, contentRoot) {
        const images=(contentRoot.matches('img')?[contentRoot]:[...contentRoot.querySelectorAll('img')]).filter(courseElementVisible);
        return {top:target.scrollTop,height:target.clientHeight,total:target.scrollHeight,
            loaded:target.clientHeight>0 && (!images.length || images.some(image=>image.complete&&image.naturalWidth>0)),
            imageCount:images.length,pendingImages:images.filter(image=>!image.complete||image.naturalWidth<=0).length};
    }
    function courseDocumentScrollTargets(node) {
        // 只沿资料节点的祖先及所属 iframe 向外查找，不能滚动目录或助手面板。
        const targets=[],seen=new Set();
        const add=(element,root=false)=>{
            if(!element || seen.has(element) || !courseElementVisible(element)) return;
            seen.add(element);
            if(element.clientHeight>0 && (element.scrollHeight>element.clientHeight || root&&element.scrollHeight>=element.clientHeight)) targets.push(element);
        };
        let anchor=node;
        for(let depth=0;anchor && depth<12;depth++) {
            const doc=anchor.ownerDocument,root=doc.scrollingElement||doc.documentElement;
            for(let parent=anchor.parentElement;parent;parent=parent.parentElement) {
                if(parent===root) {add(parent,true);continue;}
                const overflow=doc.defaultView.getComputedStyle(parent).overflowY;
                if(/^(auto|scroll)$/.test(overflow)) add(parent);
            }
            add(root,true);
            try {anchor=doc.defaultView.frameElement;} catch {break;}
        }
        return targets;
    }
    function courseDocumentReader(doc, scope = doc) {
        // 原生 PDF.js、有明确页码的文档导航和 Swiper 幻灯片。
        const swiper = scope.querySelector('.swiper-container,.swiper');
        const slides = swiper ? [...swiper.querySelectorAll('.swiper-slide:not(.swiper-slide-duplicate)')] : [];
        const bullets = swiper ? [...scope.querySelectorAll('.swiper-pagination-bullet')] : [];
        if (slides.length && bullets.length === slides.length && courseElementVisible(swiper)) {
            return { doc, node:swiper, total:slides.length,
                current:() => slides.findIndex(node => node.classList.contains('swiper-slide-active')) + 1,
                last:() => bullets.at(-1), next:() => scope.querySelector('.swiper-button-next'), kind:'slides' };
        }
        const counter = scope.querySelector('#pageNumber,[data-slide-current],input[aria-label="页码"],input[aria-label="Page"]');
        const count = scope.querySelector('#numPages,[data-slide-total],.total-pages');
        const total = Number(clean(count?.getAttribute('data-slide-total') || count?.textContent).match(/\d+/)?.[0]);
        const read = () => Number(counter?.value || counter?.getAttribute('data-slide-current') || clean(counter?.textContent));
        if (counter && courseElementVisible(counter) && Number.isInteger(total) && total > 0 && total < 100000) {
            const node = scope.querySelector('#viewerContainer,.document-reader,[data-document-reader]') || counter.parentElement;
            return { doc, node, total, current:read,
                last:() => scope.querySelector('#lastPage,[data-slide-last],button[aria-label="末页"],button[title="最后一页"]'),
                next:() => scope.querySelector('#next,[data-slide-next],button[aria-label="下一页"]'), kind:'document' };
        }
        // 超星连续图片 PPT 和 PDF.js 的纵向阅读方式；有实际资料节点才适配。
        // 现场确认：新版 #img 是 div，内部 #panView 跳转到 pan-yz 的连续图片文档。
        const remote=scope.querySelector('[id="img"].imglook iframe[id="panView"]');
        if(remote && courseRemoteReaderFrame(remote) && courseElementVisible(remote))return {doc,node:remote,kind:'remote-scroll',request:(op,signal,timeout)=>courseDocumentBridgeRequest(remote,op,signal,timeout)};
        const image=scope.querySelector('[id="img"].imglook[src],[id="img"].imglook[data-original],[id="img"].imglook[data-src]');
        const continuous=scope.querySelector('.pdfViewer .page,[data-document-reader] img[src]');
        const node=image||continuous;
        if(node && courseElementVisible(node)) return {doc,node,kind:'scroll',contentRoot:node.closest('.pdfViewer,[data-document-reader],.continuous-reader')||node,targets:()=>courseDocumentScrollTargets(node)};
        return null;
    }
    function courseDocumentReaders(doc) {
        const scopes=[...doc.querySelectorAll('.ans-attach-ct,[data-course-task]')].filter(courseElementVisible);
        const readers=[];
        // 同一资料容器可以有多个 PPT；逐个枚举，不按全页固定 ID 找第一份。
        for(const scope of scopes.length?scopes:[doc]) {
            const reader=courseDocumentReader(doc,scope);if(reader)readers.push(reader);
            for(const remote of scope.querySelectorAll('[id="img"].imglook iframe[id="panView"]')) {
                if(courseRemoteReaderFrame(remote)&&courseElementVisible(remote))readers.push({doc,node:remote,kind:'remote-scroll',request:(op,signal,timeout)=>courseDocumentBridgeRequest(remote,op,signal,timeout)});
            }
        }
        const seen=new Set();
        return readers.filter(reader=>!seen.has(reader.node) && seen.add(reader.node));
    }
    function courseVideoStartButton(video) {
        const player=video.closest('.video-js,.prism-player,[data-video-player]')||video.parentElement;
        if(!player)return null;
        for(const selector of ['.vjs-big-play-button','.prism-big-play-btn','[data-video-play]','.vjs-play-control']) {
            const buttons=[...player.querySelectorAll(selector)].filter(node=>courseElementVisible(node)&&!node.disabled&&node.getAttribute('aria-disabled')!=='true');
            if(buttons.length===1)return buttons[0];
        }
        return null;
    }
    function courseTaskRequired(node) {
        const container=courseTaskContainer(node);
        if(!container)return null;
        if(container.matches('[data-required="false"],[data-isjob="false"]'))return false;
        if(courseTaskLabel(container))return true;
        if(courseVisibleMarker(container,'[data-course-task],.ans-job,.ans-job-finished,[data-isjob="true"],.ans-job-icon,.orangeNew'))return true;
        return false;
    }
    function coursePageWithoutTasks(tree,tasks) {
        if(tasks.some(task=>courseTaskRequired(task.node)===true))return false;
        if(tree.documents.slice(1).some(doc=>courseTaskLabel(doc.body)))return false;
        if(tree.documents.slice(1).some(doc=>courseVisibleMarker(doc.body,'.ans-job-icon,.ans-job,.ans-job-finished,[data-isjob="true"],[data-course-task]:not([data-required="false"]):not([data-isjob="false"])')))return false;
        // 空附件壳不能证明内容已加载；任务标记和 iframe 控件可能随后才出现。
        const loadedAttachment=tasks.some(task=>courseTaskContainer(task.node)&&courseTaskRequired(task.node)===false);
        return loadedAttachment || tree.documents.slice(1).some(doc=>courseVisibleMarker(doc.body,
            '#img.imglook[src],.pdfViewer .page,[data-required="false"],[data-isjob="false"]'));
    }
    function coursePageTasks(tree) {
        const tasks=[];
        for(const doc of tree.documents.slice(1)) {
            for(const video of [...doc.querySelectorAll('video')].filter(courseElementVisible)) tasks.push({type:'video',node:video});
            for(const reader of courseDocumentReaders(doc)) tasks.push({type:'document',node:reader.node,reader});
            if(!doc.querySelector('.fanyaMarking_left') && (hasQuestionNodes(doc)||courseQuizComplete(doc))) tasks.push({type:'quiz',doc,node:doc.querySelector('.singleQuesId,.TiMu,.CeYan,.testTit_status,[data-quiz-status]')||doc.body});
        }
        const path=node=>{
            const nodes=[node];
            for(let depth=0;node?.ownerDocument!==tree.documents[0]&&depth<12;depth++) {
                try{node=node.ownerDocument.defaultView.frameElement;}catch{break;}
                if(!node)break;nodes.unshift(node);
            }
            return nodes;
        };
        // iframe 内部任务按所属 iframe 在父页的位置排序，再比较内部 DOM 顺序。
        return tasks.sort((left,right)=>{
            const a=path(left.node),b=path(right.node);
            for(let i=0;i<Math.min(a.length,b.length);i++) {
                if(a[i]===b[i])continue;
                const position=a[i].compareDocumentPosition(b[i]);
                return position&1?0:position&4?-1:position&2?1:0;
            }
            return a.length-b.length;
        });
    }
    function courseSubmitButton(doc) {
        // 不调用页面的私有提交函数，只点击明确标注的原按钮。
        const nodes = [...doc.querySelectorAll('#submitWork,#submitTest,#submit,#workSubmit,[data-quiz-submit],button,input[type="submit"],a[role="button"],a[onclick]')];
        return nodes.filter(node => !node.closest('.singleQuesId,.TiMu') && courseElementVisible(node)
            && !node.disabled && node.getAttribute('aria-disabled') !== 'true'
            && /^(提交|提交答案|提交测验|交卷)$/.test(clean(node.value || node.textContent)));
    }
    function courseSubmitConfirmation(doc, owner = doc) {
        // 现场确认：内层测验调用主页面 #workpop，不能只在题目 iframe 找二次确认。
        // 只沿当前题目文档的父链读取，不扫描其他任务/测验的兄弟 iframe。
        const documents = [], seen = new Set();
        for (let current = doc, depth = 0; current && depth < 12 && !seen.has(current); depth++) {
            documents.push(current); seen.add(current);
            if (current === owner) break;
            try { current = current.defaultView?.frameElement?.ownerDocument; }
            catch { break; }
        }
        const dialogs = documents.flatMap(current => [...current.querySelectorAll('[role="dialog"],.layui-layer,.popDiv,.alertDialog')]).filter(courseElementVisible);
        const buttons = dialogs.filter(dialog => /提交|交卷/.test(clean(dialog.textContent)) && !/人脸|验证码/.test(clean(dialog.textContent)))
            .flatMap(dialog => [...dialog.querySelectorAll('button,a[role="button"],.layui-layer-btn0')])
            .filter(node => courseElementVisible(node) && !node.disabled && node.getAttribute('aria-disabled') !== 'true'
                && /^(确定|确认|确认提交|提交|交卷)$/.test(clean(node.value || node.textContent)));
        return [...new Set(buttons)];
    }
