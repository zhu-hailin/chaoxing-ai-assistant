    // 原始 DOM → 页面适配器 → 题型解析器 → 可序列化题目；DOM 绑定不进入 AI 请求。
    const questionPageAdapters = [];
    const questionTypeParsers = [];
    function registerPageAdapter(adapter) {
        if (!adapter?.id || typeof adapter.collect !== 'function' || typeof adapter.read !== 'function') throw new Error('无效页面适配器');
        if (questionPageAdapters.some(item => item.id === adapter.id)) throw new Error('页面适配器 ID 重复');
        questionPageAdapters.push(adapter);
    }
    function registerQuestionParser(parser) {
        if (!parser?.id || typeof parser.match !== 'function' || typeof parser.parse !== 'function') throw new Error('无效题型解析器');
        if (questionTypeParsers.some(item => item.id === parser.id)) throw new Error('题型解析器 ID 重复');
        questionTypeParsers.push(parser);
    }
    function questionNodeActive(node) {
        if (!node?.isConnected || node.closest('template,[hidden],[inert],.cx-ai-ignore')) return false;
        const view = node.ownerDocument?.defaultView;
        if (!view) return false;
        for (let element = node; element; element = element.parentElement) {
            const style = view.getComputedStyle(element);
            if (style.display === 'none' || ['hidden','collapse'].includes(style.visibility)) return false;
        }
        // Off-screen questions remain eligible; visibility never uses viewport coordinates.
        return true;
    }
    function questionCandidateAllowed(node, context = {}) {
        if (!questionNodeActive(node)) return false;
        if (context.scope === 'video-quiz') return Boolean(context.root?.contains(node));
        return !node.closest('.ans-videoquiz,[data-video-quiz-root]')
            && !node.closest('[role="dialog"],form')?.querySelector('#videoquiz-submit');
    }
    function collectRawQuestions(doc = document, parseContext = {}) {
        const records = [], seen = new Set(), claimedAncestors = new Set();
        for (const adapter of questionPageAdapters) {
            const nodes = [...adapter.collect(doc, parseContext)].filter(node => questionCandidateAllowed(node, parseContext)), candidates = new Set(nodes), containers = new Set();
            for (const node of nodes) {
                for (let parent = node.parentElement; parent; parent = parent.parentElement) {
                    if (candidates.has(parent)) containers.add(parent);
                }
            }
            for (const node of nodes.filter(node => !containers.has(node))) {
                if (seen.has(node) || claimedAncestors.has(node)) continue;
                let insideClaimed = false;
                for (let parent = node.parentElement; parent; parent = parent.parentElement) if (seen.has(parent)) { insideClaimed = true; break; }
                if (insideClaimed) continue;
                seen.add(node); records.push({ node, adapter });
                for (let parent = node.parentElement; parent; parent = parent.parentElement) claimedAncestors.add(parent);
            }
        }
        records.sort((a, b) => a.node.compareDocumentPosition(b.node) & 2 ? 1 : -1);
        return records.map((record, index) => record.adapter.read(record.node, index, parseContext));
    }
    function hasQuestionNodes(doc = document, parseContext = {}) {
        return questionPageAdapters.some(adapter => [...adapter.collect(doc, parseContext)].some(node => questionCandidateAllowed(node, parseContext)));
    }
    function textInputs(node) {
        return [...node.querySelectorAll('textarea,input[type="text"],input:not([type])')]
            .filter(input => !input.closest('.cx-ai-ignore') && input.type !== 'password');
    }
    const STEM_SELECTOR = '.Zy_TItle .fontLabel,.Zy_TItle,.question-stem,.question-title,.mark_name,.stem,[data-question-text]';
    const MEDIA_EXCLUDED = 'dl,.mark_answer,.answer-content,.correct-answer,.teacher-comment,.editor-toolbar,.attachment,.cx-ai-ignore';
    const TEXT_ANSWER_TYPE_LABEL = /^(?:计算(?:与(?:推导|证明))?|证明|解答|分析|应用|综合|推导|编程|程序(?:设计)?|代码)题?$/;
    function questionNativeMathExpression(node) {
        if (!node?.getAttribute) return '';
        const annotation = node.localName === 'math' ? node.querySelector('annotation[encoding="application/x-tex"]') : null;
        return clean(annotation?.textContent || node.getAttribute('data-latex') || node.getAttribute('data-tex')
            || (node.getAttribute('role') === 'math' ? node.getAttribute('aria-label') : '') || '');
    }
    function questionContentText(root) {
        if (!root) return '';
        if (root.nodeType === 3) return root.textContent || '';
        if(root.nodeType===1&&root.matches('.chosen-container')&&root.closest('.matching'))return '';
        if (root.nodeType !== 1 || root.matches('input,textarea,select,button,script,style,[contenteditable="true"],.mark_answer,.answer-content,.correct-answer,.teacher-comment,.editor-toolbar,.cx-ai-ignore')) return '';
        const expression = questionNativeMathExpression(root);
        if (expression) return expression;
        return [...root.childNodes].map(questionContentText).join('');
    }
    function readQuestionTypeLabel(node, stem, group) {
        const explicit = clean(node.getAttribute('data-question-type') || node.getAttribute('data-type-name'));
        if (explicit) return explicit;
        const prefix = clean(stem?.textContent).replace(/^\d+\s*[.．、](?!\d)\s*/, '');
        const match = prefix.match(/^(?:【([^】]+)】|\[([^\]]+)\]|\(([^)]+)\)|（([^）]+)）)/);
        const label = clean(match?.slice(1).find(Boolean));
        // 括号内的公式不算题型；保留教师明确声明但尚未适配的类型。
        if (label && /题$/.test(label)) return label;
        if (label && (/^(简答|问答|论述|单选|多选|判断|填空)$/.test(label) || TEXT_ANSWER_TYPE_LABEL.test(label))) return label;
        return clean(group?.querySelector(':scope > .type_tit')?.textContent.match(/(多项选择|单项选择|多选|单选|判断|是非|填空|简答|问答|论述|计算与推导|计算与证明|计算|证明|解答|分析|应用|综合|推导|编程|程序设计|程序|代码)题?/)?.[0]);
    }
    function stripQuestionPrefix(text, typeLabel) {
        let result = clean(text).replace(/^\d+\s*[.．、](?!\d)\s*/, '');
        const match = result.match(/^(?:【([^】]+)】|\[([^\]]+)\]|\(([^)]+)\)|（([^）]+)）)\s*/);
        if (match && clean(match.slice(1).find(Boolean)) === typeLabel) result = result.slice(match[0].length);
        return result.trim();
    }
    function imageSource(img) {
        const value = ['data-original','data-src'].map(key => img.getAttribute(key)).find(value => value?.trim()) || img.currentSrc || img.getAttribute('src') || '';
        if (!value) return '';
        try { return new URL(value, img.ownerDocument.baseURI).href; } catch { return ''; }
    }
    function optionContentRoot(node, target) {
        if (!target.matches('input')) return target.querySelector('a.after,.option-content,.answer-option-content') || target;
        for (const container of [target.closest('.option,.answer-option,.option-item'), target.closest('label')]) {
            if (container && node.contains(container) && container.querySelectorAll('input[type="radio"],input[type="checkbox"]').length === 1) return container;
        }
        const labels = target.id ? [...node.querySelectorAll('label[for]')].filter(label => label.htmlFor === target.id) : [];
        if (labels.length !== 1) return null;
        const control = labels[0].querySelector('input[type="radio"],input[type="checkbox"]');
        return !control || control === target ? labels[0] : null;
    }
    function readQuestionSharedMaterials(node, group, groupId, hints = {}) {
        const materials = [], doc = node.ownerDocument;
        let unreadable = false;
        const add = (target, id, evidence) => {
            if (target?.nodeType !== 1 || typeof target.closest !== 'function') { unreadable = true; return; }
            const owner = target?.closest('.singleQuesId,.TiMu,.question-item[data-question-id],[data-questionid]');
            if (!target?.isConnected || target.ownerDocument !== doc || target.contains(node)
                || target.querySelector('.singleQuesId,.TiMu,.question-item[data-question-id],[data-questionid]')
                || target.closest('template,.mark_answer,.answer-content,.correct-answer,.teacher-comment,.cx-ai-ignore')
                || owner && owner !== node && !(evidence === 'group-instructions' && owner === group)) {
                unreadable = true; return;
            }
            if (!materials.some(material => material.node === target)) materials.push({id, node:target, evidence});
        };
        // A type/display group is not a material-sharing declaration.
        const instruction = group?.querySelector(':scope > .question-instructions');
        if (instruction) add(instruction, `${groupId}:material`, 'group-instructions');
        for (const reference of new Set((node.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean))) {
            const matches = [...doc.querySelectorAll('[id]')].filter(target => target.id === reference);
            if (matches.length !== 1) { unreadable = true; continue; }
            add(matches[0], `shared-${reference}`, 'native-describedby');
        }
        for (const material of Array.isArray(hints.sharedMaterials) ? hints.sharedMaterials : []) {
            if (!material?.id || !material.node) { unreadable = true; continue; }
            add(material.node, `shared-${String(material.id)}`, 'adapter-material-reference');
        }
        return {materials, unreadable};
    }
    function collectQuestionMedia(node, stem, id, groupId, optionTargets = new Map(), sharedMaterials = [], matching = null) {
        const media = [], sharedMedia = [], imageNodes = new Map(), seen = new Set(), sequences = new Map();
        const collect = (root, location, optionKey = null, material = null) => {
            if (!root) return;
            for (const visual of root.matches('img,svg,canvas') ? [root] : root.querySelectorAll('img,svg,canvas')) {
                if (seen.has(visual) || visual.closest(MEDIA_EXCLUDED)) continue;
                if (visual.matches('svg,canvas') && !questionNodeActive(visual)) continue;
                const formula = visual.closest('math,[data-latex],[data-tex],[role="math"]');
                if (visual.parentElement?.closest('svg,canvas') || questionNativeMathExpression(visual)
                    || formula && root.contains(formula) && questionNativeMathExpression(formula)) continue;
                if (location === 'stem' && visual.closest('.Zy_ulTop,.option,.answer-option,.option-item')) continue;
                seen.add(visual);
                const sequenceKey = JSON.stringify([material?.id || id,location,optionKey]);
                const index = (sequences.get(sequenceKey) || 0) + 1;
                sequences.set(sequenceKey, index);
                const imageId = `img-${material?.id || id}-${location}-${optionKey || 'q'}-${index}`;
                const kind = visual.localName.toLowerCase();
                const descriptor = {id:imageId, groupId:material?.id || groupId, sourceQuestionId:material ? null : id,
                    location, optionKey, src:kind === 'img' ? imageSource(visual) : '', alt:clean(visual.getAttribute('alt') || visual.getAttribute('aria-label')),
                    ...(material ? {sourceMaterialId:material.id,sourceQuestionNumber:null} : {})};
                if (kind !== 'img') {
                    descriptor.kind = kind;
                    try { descriptor.contentSignature = captureVisualMediaSignature(visual, kind); }
                    catch { descriptor.unreadable = true; }
                }
                (material ? sharedMedia : media).push(descriptor);
                imageNodes.set(imageId, visual);
            }
        };
        if(matching){for(const item of matching.left)collect(item.node,'matching-left',item.key);for(const item of matching.right)collect(item.node,'option',item.key);}
        // 先绑定选项图片；即使选项被包在 .Zy_TItle 中，也不能变成组内共用题干。
        for (const [key, target] of optionTargets) {
            collect(optionContentRoot(node, target), 'option', key);
        }
        // .fontLabel 有时只是题干的一部分，图片位于同一个 .Zy_TItle 内。
        collect(stem?.closest('.Zy_TItle') || stem, 'stem');
        for (const child of node.children) if (child.matches('.question-instructions,[data-answer-instructions]')) collect(child, 'stem');
        for (const material of sharedMaterials) collect(material.node, 'shared', null, material);
        return { media, sharedMedia, imageNodes };
    }
    function isMooc2HomeworkDocument(doc) {
        try { return /^\/mooc-ans\/mooc2\/work\/dowork\/?$/.test(new URL(doc.URL).pathname); }
        catch { return false; }
    }
    function readMooc2ChoiceBindings(node,id,type) {
        // Display letters are model keys. The platform's data values stay in private bindings.
        const records=[],diagnostics=[],keys=new Set(),values=new Set(),doc=node.ownerDocument;
        const rows=[...node.querySelectorAll('.stem_answer .answerBg')].filter(row=>row.closest('.questionLi.singleQuesId')===node);
        const multiple=type==='multiple',knownType=['single','multiple','judge'].includes(type);
        const markerSelector=multiple?'.num_option_dx':'.num_option',selectedClass=multiple?'check_answer_dx':'check_answer';
        const role=multiple?'checkbox':'radio',handlerName=multiple?'addMultipleChoice':'addChoice';
        const expectedType=multiple?'1':type==='single'?'0':null;
        let contentValid=knownType&&rows.length>0;
        let qid='',qtype='';
        for (const row of rows) {
            const markers=[...row.querySelectorAll(markerSelector)],contents=[...row.querySelectorAll('.answer_p')];
            const marker=markers[0],content=contents[0],key=clean(marker?.textContent),value=marker?.getAttribute('data') || '';
            const rowId=row.getAttribute('qid') || '',rowType=row.getAttribute('qtype') || '';
            if (!qid) { qid=rowId;qtype=rowType; }
            const materialValid=knownType&&markers.length===1&&contents.length===1&&/^[A-Z]$/.test(key)&&!keys.has(key)
                &&row.querySelectorAll('.num_option,.num_option_dx').length===1
                &&marker.closest('.answerBg')===row&&content.closest('.answerBg')===row
                &&/^\d+$/.test(rowId)&&rowId===String(id)&&rowId===qid&&Boolean(rowType)&&rowType===qtype
                &&(expectedType===null||rowType===expectedType);
            if(!materialValid)contentValid=false;
            const call=/^\s*(?:return\s+)?(addChoice|addMultipleChoice)\(\s*this\s*\)\s*;?\s*$/.exec(row.getAttribute('onclick') || '');
            if (!materialValid || !value || value!==value.trim() || values.has(value)
                || row.getAttribute('role')!==role || call?.[1]!==handlerName
                || row.querySelector('input[type="radio"],input[type="checkbox"],.answerBg'))
                diagnostics.push('mooc2 选项字母、内部标识或原生点击结构无法唯一对应');
            keys.add(key);values.add(value);
            records.push({key,value,row,marker,content,qtype:rowType,role:row.getAttribute('role'),handler:row.getAttribute('onclick')});
        }
        if (!rows.length) diagnostics.push('mooc2 选项尚未加载或结构未适配');
        if (qid && [...doc.querySelectorAll('.answerBg[qid]')].some(row=>row.getAttribute('qid')===qid && !rows.includes(row))) {
            contentValid=false;
            diagnostics.push('mooc2 题目选项组跨题共享，暂不预填');
        }
        const saved=qid ? [...doc.querySelectorAll('[id],[name]')].filter(element=>element.id==='answer'+qid || element.getAttribute('name')==='answer'+qid) : [];
        const savedInput=saved[0] || null;
        if (saved.length!==1 || !savedInput?.matches('input[type="hidden"]') || savedInput.id!=='answer'+qid
            || savedInput.name&&savedInput.name!=='answer'+qid || savedInput.form!==node.closest('form')
            || savedInput.closest('.questionLi.singleQuesId')&&savedInput.closest('.questionLi.singleQuesId')!==node)
            diagnostics.push('mooc2 原生答案字段无法唯一关联');
        return {valid:diagnostics.length===0,contentValid,type,selectedClass,qid,qtype,records,savedInput,diagnostics:[...new Set(diagnostics)]};
    }
    function sameMooc2ChoiceBindings(before,after) {
        if (!before || !after) return !before && !after;
        return before.valid===after.valid && before.contentValid===after.contentValid && before.type===after.type && before.selectedClass===after.selectedClass
            && before.qid===after.qid && before.qtype===after.qtype
            && before.savedInput===after.savedInput && before.records.length===after.records.length
            && before.records.every((record,index)=>['key','value','row','marker','content','qtype','role','handler'].every(key=>record[key]===after.records[index][key]));
    }
    function readChapterRowChoiceBindings(node,id,type,rows) {
        if(!['single','multiple'].includes(type)||!rows.length||rows.some(row=>row.querySelector('input')))return null;
        try {if(!/^\/(?:mooc-ans\/)?work\/doHomeWorkNew\/?$/.test(new URL(node.ownerDocument.URL).pathname))return null;}
        catch{return null;}
        if(!rows.some(row=>row.matches('li.before-after,li.before-after-checkbox')||/add(?:Multiple)?Choice\s*\(/.test(row.getAttribute('onclick')||'')))return null;
        const expected=type==='multiple'?'addMultipleChoice':'addChoice',records=[],keys=new Set();
        const questionOwner=element=>element.closest('.singleQuesId,.question-item[data-question-id],[data-questionid]')||element.closest('.TiMu');
        let valid=/^\d+$/.test(String(id)),contentValid=true;
        for(const row of rows) {
            const labels=row.querySelectorAll(':scope > label.fl.before'),contents=row.querySelectorAll(':scope > a.fl.after');
            const clears=row.querySelectorAll(':scope > div.clear'),label=labels[0],content=contents[0];
            const key=clean(label?.textContent).match(/^([A-Z])(?:[.．、:：)）])?$/)?.[1]||'';
            const handler=row.getAttribute('onclick')||'';
            const call=/^\s*(?:return\s+)?(addChoice|addMultipleChoice)\(\s*this\s*\)\s*;?\s*$/.exec(handler);
            const owns=questionOwner(row)===node;
            if(!owns||labels.length!==1||contents.length!==1||!key||keys.has(key))contentValid=false;
            if(!owns||labels.length!==1||contents.length!==1||clears.length!==1||!key||keys.has(key)
                ||!row.matches(type==='multiple'?'li.before-after-checkbox':'li.before-after')||call?.[1]!==expected)valid=false;
            const markers=[...row.querySelectorAll('.num_option_dx,.num_option')];
            const marker=markers[0]||null,value=marker?clean(marker.getAttribute('data')):key;
            if(markers.length>1||!value||records.some(record=>record.value===value))valid=false;
            keys.add(key);records.push({key,value,marker,row,label,content,clear:clears[0],handler});
        }
        // Legacy option text/markers may share the answer field's name or ID.
        // Ignore only spans inside this question's bound option rows.
        const saved=/^\d+$/.test(String(id))?[...node.ownerDocument.querySelectorAll(`[id="answer${id}"],[name="answer${id}"]`)]
            .filter(target=>!(target.tagName==='SPAN'&&questionOwner(target)===node&&records.some(record=>record.row.contains(target)))):[];
        if(saved.length>1||saved.length===1&&(!saved[0].matches('input[type="hidden"]')
            ||saved[0].id&&saved[0].id!==`answer${id}`||saved[0].name&&saved[0].name!==`answer${id}`
            ||saved[0].form!==node.closest('form')||questionOwner(saved[0])&&questionOwner(saved[0])!==node))valid=false;
        return {id:String(id),mode:expected,valid,contentValid,records,savedInput:saved.length===1?saved[0]:null,
            diagnostics:valid?[]:['旧版选项字母、题目归属或原生处理函数尚未可靠对应，暂不预填']};
    }
    function sameChapterRowChoiceBindings(before,after) {
        if(!before||!after)return !before&&!after;
        return before.valid===after.valid&&before.contentValid===after.contentValid&&before.id===after.id&&before.mode===after.mode
            &&before.savedInput===after.savedInput&&before.records.length===after.records.length
            &&before.records.every((record,index)=>['key','value','marker','row','label','content','clear','handler'].every(key=>record[key]===after.records[index][key]));
    }
    function readQuestionUEditor(node,id) {
        // 只读取已存在的实例；不调用 UE.getEditor，不按 uid 或题号顺序猜测实例。
        try {if(!/^\/(?:mooc-ans\/)?work\/doHomeWorkNew\/?$/.test(new URL(node.ownerDocument.URL).pathname))return null;}
        catch{return null;}
        const fields=[...node.querySelectorAll('textarea[id^="answer"]')];
        if(!fields.length)return null;
        const invalid=reason=>({valid:false,diagnostics:[`UEditor：${reason}`]});
        const same=(a,b)=>Boolean(a&&b&&typeof a.isSameNode==='function'&&a.isSameNode(b));
        const owner=element=>element.closest('.singleQuesId,.question-item[data-question-id],[data-questionid]')||element.closest('.TiMu');
        const legacy=fields.some(input=>input.id.startsWith('answerEditor'));
        const hasStructure=[...node.querySelectorAll('.edui-editor')].some(container=>owner(container)===node&&container.querySelector('iframe'));
        let detected=legacy||hasStructure;
        try {
            const doc=node.ownerDocument;
            const view=typeof courseVideoPlayerWindow==='function'?courseVideoPlayerWindow(doc):doc.defaultView;
            if(!same(view?.document,doc))return legacy||hasStructure?invalid('当前题目文档已失效'):null;
            const registry=view?.UE?.instants;
            const instances=registry&&typeof registry==='object'?Object.values(registry).filter(Boolean):[];
            // answer{ID} 也可能是普通文本框：有现存实例或原生编辑器结构时才接管。
            const candidates=fields.filter(input=>input.id.startsWith('answerEditor')||/^answer\d+$/.test(input.id)
                &&(hasStructure||instances.some(editor=>editor.key===input.id)));
            if(!candidates.length)return null;
            detected=true;
            if(candidates.length!==1)return invalid('答案字段与编辑器无法唯一对应');
            const input=candidates[0],form=input.form,mode=/^answerEditor\d+$/.test(input.id)?'answerEditor':/^answer\d+$/.test(input.id)?'answer':null;
            if(!mode)return invalid('答案字段命名格式不受支持');
            if(!/^\d+$/.test(String(id)))return invalid('题目缺少可靠的原生数字 ID');
            if(!node.isConnected||!input.isConnected||owner(input)!==node)return invalid('答案字段不属于当前题目或页面已替换');
            if(doc.querySelectorAll(`[id="${input.id}"]`).length!==1)return invalid('答案字段 ID 重复，无法唯一对应');
            if(mode==='answer') {
                const nativeQuestionId=node.getAttribute('data');
                if(!node.matches('.singleQuesId')||nativeQuestionId!==String(id)||node.id!==`question${id}`
                    ||input.id!==`answer${id}`||input.name!==input.id)return invalid('答案字段与题目 ID 不一致');
                if(doc.querySelectorAll(`.singleQuesId[data="${id}"]`).length!==1||doc.querySelectorAll(`[id="question${id}"]`).length!==1)
                    return invalid('原生题目 ID 或题目根节点不唯一');
                if(doc.querySelectorAll(`[id="${input.id}"],[name="${input.id}"]`).length!==1)return invalid('答案字段名称重复或跨题共享');
            }
            if(!form?.matches('form#form1')||node.closest('form')!==form||doc.querySelectorAll('[id="form1"]').length!==1)
                return invalid('答案字段与题目表单归属不一致');
            if(!input.name.trim()||input.name!==input.name.trim()||[...form.elements].filter(element=>element.name===input.name).length!==1)
                return invalid('答案字段名称无效或表单中存在重复字段');
            if(input.disabled||input.readOnly||input.matches(':disabled'))return invalid('答案字段已禁用或只读');
            if(!registry||typeof registry!=='object')return invalid('未找到已存在的编辑器实例');
            const matches=instances.filter(editor=>editor.key===input.id);
            if(matches.length!==1)return invalid(matches.length?'编辑器与题目无法唯一对应':'未找到与答案字段对应的编辑器实例');
            const editor=matches[0],frames=[...node.querySelectorAll('iframe')];
            if(![1,true].includes(editor.isReady))return invalid('编辑器实例未就绪');
            if('textarea' in editor&&!same(editor.textarea,input))return invalid('编辑器与原生 textarea 关联不一致');
            if(!same(editor.form,form))return invalid('编辑器与答案字段的表单归属不一致');
            if(['setContent','getContent','sync'].some(key=>typeof editor[key]!=='function'))return invalid('编辑器原生内容或同步接口不可用');
            const iframe=frames.find(frame=>same(frame,editor.iframe)),container=iframe?.closest('.edui-editor');
            const inner=iframe?.contentDocument,body=inner?.body;
            if(frames.length!==1||!iframe)return invalid('编辑器 iframe 与题目无法唯一对应');
            if(!container||owner(container)!==node||!node.contains(container)||!container.contains(iframe))return invalid('编辑器容器不属于当前题目');
            if(container.closest('form')!==form)return invalid('编辑器容器与答案字段的表单归属不一致');
            if(!same(container,editor.container)||!same(inner,editor.document)||!same(body,editor.body)
                ||!same(inner?.defaultView?.frameElement,iframe)||!body?.isConnected)return invalid('编辑器文档、正文或 iframe 关联已失效');
            if(body.contentEditable!=='true'||editor.options?.readonly===true||!courseElementVisible(iframe)
                ||container.getAttribute('aria-disabled')==='true'||iframe.getAttribute('aria-disabled')==='true')return invalid('编辑器不可见、已禁用或只读');
            if(instances.filter(other=>other===editor).length!==1||instances.some(other=>other!==editor
                &&(other.key===input.id||same(other.iframe,iframe)||same(other.container,container)||same(other.body,body)||same(other.document,inner))))return invalid('编辑器实例或文档被重复注册或跨题共享');
            return {valid:true,diagnostics:[],id:String(id),mode,nativeQuestionId:mode==='answer'?node.getAttribute('data'):null,registry,editor,input,form,iframe,document:inner,body,container,
                key:input.id,name:input.name,setContent:editor.setContent,getContent:editor.getContent,sync:editor.sync};
        }catch{return detected?invalid('编辑器实例或文档关联无法安全读取'):null;}
    }
    function sameQuestionUEditor(before,after) {
        if(!before||!after)return !before&&!after;
        if(!before.valid||!after.valid)return before.valid===after.valid;
        return ['id','mode','nativeQuestionId','registry','editor','input','form','iframe','document','body','container','key','name','setContent','getContent','sync']
            .every(key=>before[key]===after[key]);
    }
    function matchingPageWindow(doc) {
        const realm=typeof courseVideoPlayerWindow==='function'?courseVideoPlayerWindow(doc):doc.defaultView;
        return realm?.document?.isSameNode(doc)?realm:null;
    }
    function matchingChosen(select) {
        try {
            const instance=matchingPageWindow(select.ownerDocument)?.jQuery?.(select)?.data('chosen');
            const container=instance?.container?.[0],field=instance?.form_field||instance?.form_field_jq?.[0];
            return field===select&&container===select.nextElementSibling&&container?.matches('.chosen-container')?{instance,container}:null;
        }catch{return null;}
    }
    function readQuestionMatching(node,id) {
        const blocks=[...node.querySelectorAll('.matching')];
        if(!blocks.length)return null;
        const block=blocks[0],owner=element=>element.closest('.singleQuesId,.question-item[data-question-id],[data-questionid]')||element.closest('.TiMu');
        const items=selector=>[...block.querySelectorAll(selector)].filter(item=>!item.classList.contains('groupTitile'));
        const read=(li)=>({node:li,key:clean(li.querySelector(':scope > i')?.textContent).replace(/[.、:：)）]$/,''),text:clean(questionContentText(li))});
        const left=items('.firstUlList > li').map(read),right=items('.secondUlList > li').map(read);
        const rows=items('.thirdUlList .lineOption').map(row=>{
            const selects=[...row.querySelectorAll('select.dept_select')],select=selects[0];
            const widget=select?matchingChosen(select):null,chosen=widget?.container||null;
            return {node:row,index:String(row.getAttribute('index')||''),num:clean(row.querySelector('.matchNum')?.textContent).replace(/[.、:：)）]$/,''),select,count:selects.length,chosen,chosenInstance:widget?.instance,
                handler:select?.getAttribute('onchange')||'',onchange:select?.onchange,
                options:select?[...select.options].map(option=>({node:option,value:option.value,text:option.textContent,disabled:option.disabled})):[]};
        });
        const saved=[...node.ownerDocument.querySelectorAll('input[type="hidden"]')].filter(input=>input.id===`answer${id}`||input.name===`answer${id}`);
        const keys=right.map(item=>item.key),valid=blocks.length===1&&owner(block)===node&&left.length>0&&right.length>0&&rows.length===left.length
            &&left.every(item=>/^\d+$/.test(item.key)&&owner(item.node)===node)&&right.every(item=>owner(item.node)===node)
            &&new Set(left.map(item=>item.key)).size===left.length&&keys.every(key=>/^[A-Z]$/.test(key))&&new Set(keys).size===keys.length
            &&saved.length===1&&!saved[0].disabled&&!saved[0].readOnly&&saved[0].form===node.closest('form')&&(!owner(saved[0])||owner(saved[0])===node)
            &&rows.every((row,index)=>row.count===1&&row.index===left[index].key&&row.num===left[index].key&&owner(row.select)===node
                &&row.select.form===saved[0].form&&!row.select.disabled&&!row.select.closest('[aria-disabled="true"],fieldset[disabled]')
                &&(courseElementVisible(row.select)||row.chosen&&courseElementVisible(row.chosen)&&!row.chosen.matches('.chosen-disabled')&&typeof matchingPageWindow(row.select.ownerDocument)?.jQuery==='function')
                &&row.options.filter(option=>option.value).length===keys.length&&keys.every(key=>row.options.filter(option=>option.value===key&&!option.disabled).length===1));
        return {block,left,right,rows,savedInput:saved[0]||null,valid};
    }
    function sameQuestionMatching(a,b) {
        if(!a||!b)return !a&&!b;
        const same=(x,y,keys)=>keys.every(key=>x[key]===y[key]);
        return a.valid===b.valid&&a.block===b.block&&a.savedInput===b.savedInput
            &&['left','right'].every(group=>a[group].length===b[group].length&&a[group].every((item,i)=>same(item,b[group][i],['node','key','text'])))
            &&a.rows.length===b.rows.length&&a.rows.every((row,i)=>same(row,b.rows[i],['node','index','num','select','chosen','chosenInstance','handler','onchange'])
                &&row.options.length===b.rows[i].options.length&&row.options.every((option,j)=>same(option,b.rows[i].options[j],['node','value','text','disabled'])));
    }
    function questionMatchingState(binding) {
        const matching=binding.matching,values=matching.rows.map(row=>row.select.value),saved=matching.savedInput?.value||'';
        let stored=[],consistent=matching.valid;
        try {stored=saved?JSON.parse(saved):[];}catch{consistent=false;}
        if(!Array.isArray(stored))consistent=false;
        else {
            if(new Set(stored.map(item=>String(item?.name))).size!==stored.length)consistent=false;
            if(stored.some(item=>!item||!matching.rows.some(row=>String(item.name)===row.index&&item.content===row.select.value)))consistent=false;
            if(matching.rows.some(row=>row.select.value&&stored.filter(item=>item&&String(item.name)===row.index&&item.content===row.select.value).length!==1))consistent=false;
        }
        if(values.some(value=>value&&!matching.right.some(item=>item.key===value)))consistent=false;
        return {keys:[],values,saved,unknownSaved:!consistent};
    }
    function questionMatchingVerified(unit) {
        const state=questionMatchingState(unit.binding);
        return !state.unknownSaved&&state.values.every((value,i)=>value===unit.answerKeys[i])&&unit.binding.matching.rows.every(row=>!row.chosen||clean(row.chosen.querySelector('.chosen-single span')?.textContent)===clean(row.select.selectedOptions[0]?.textContent));
    }

    function rawQuestion(node, index, adapter, videoContext = {}) {
        // Only verified local adapters supply context; ordinary chapter selectors stay unchanged.
        const local = ['video-quiz','chaoxing-mooc2-work'].includes(adapter) ? videoContext : {};
        const stem = local.stem || node.querySelector(adapter === 'video-quiz' ? STEM_SELECTOR + ",legend" : STEM_SELECTOR);
        const group = node.closest('.mark_item');
        const id = questionId(node, index);
        const groupId = group ? `work-group-${[...node.ownerDocument.querySelectorAll('.mark_item')].indexOf(group) + 1}` : `question-group-${id}`;
        const matching=adapter==='video-quiz'?null:readQuestionMatching(node,id);
        const typeLabel = matching?'连线题':local.typeLabel ?? readQuestionTypeLabel(node, stem, group);
        let question = stripQuestionPrefix(questionContentText(stem), typeLabel);
        const instructions = clean([TEXT_ANSWER_TYPE_LABEL.test(clean(typeLabel)) ? `题型：${typeLabel}` : '', node.getAttribute('data-answer-instructions'),
            ...[...node.children].filter(child=>child.matches('.question-instructions,[data-answer-instructions]')).map(questionContentText),
            questionContentText(group?.querySelector(':scope > .type_tit')),
            questionContentText(group?.querySelector(':scope > .question-instructions'))].filter(Boolean).join('；'));
        const legacy = [...node.querySelectorAll('.Zy_ulTop li')];
        const native = [...node.querySelectorAll('input[type="radio"],input[type="checkbox"]')].filter(input=>adapter!=='video-quiz'||courseElementVisible(input)&&!input.closest(MEDIA_EXCLUDED));
        const mooc2=!matching&&adapter==='chaoxing-mooc2-work' && node.querySelector('.stem_answer') && !['blank','essay'].includes(canonicalType({typeLabel,question})) ? readMooc2ChoiceBindings(node,id,canonicalType({typeLabel,question})) : null;
        let optionTargets, options, writer,chapterRows=null;
        if(matching){options=matching.right.map(item=>({key:item.key,text:item.text}));optionTargets=new Map();writer='matching';}
        else if (mooc2) {
            options=mooc2.records.map(record=>({key:record.key,text:clean(questionContentText(record.content))}));
            optionTargets=new Map(mooc2.records.map(record=>[record.key,record.row]));writer='mooc2-choice';
        } else if (legacy.length) {
            const type = detectType(typeLabel || question);
            if(adapter!=='video-quiz')chapterRows=readChapterRowChoiceBindings(node,id,type,legacy);
            options = legacy.map((li, i) => {
                const key = chapterRows ? chapterRows.records[i].key : optionKey(li, i, type), root = optionContentRoot(node, li);
                let text = optionText(li, key);
                if (root && (questionNativeMathExpression(root) || [...root.querySelectorAll('math,[data-latex],[data-tex],[role="math"]')].some(questionNativeMathExpression))) {
                    text = clean(questionContentText(root));
                    if (/^[A-Z]$/.test(key)) text = text.replace(new RegExp('^' + key + '\\s*[、.．:：)）]\\s*'), '');
                }
                return {key, text};
            });
            optionTargets = new Map(options.map((option, i) => [option.key, legacy[i]])); writer = 'chapter-choice';
        } else {
            options = native.map((input, i) => {
                const label = optionContentRoot(node, input);
                const text = clean(questionContentText(label) || input.getAttribute('aria-label') || '');
                const prefix = text.match(/^([A-Z])\s*[、.．:：)）]/)?.[1];
                const key = clean(input.getAttribute('data-option-key') || prefix || (input.value !== 'on' ? input.value : '') || String.fromCharCode(65 + i));
                return { key, text: /^[A-Z]$/.test(key) ? text.replace(new RegExp('^' + key + '\\s*[、.．:：)）]\\s*'), '') : text };
            });
            optionTargets = new Map(options.map((option, i) => [option.key, native[i]])); writer = native.length ? 'native-choice' : 'none';
        }
        const radios = native.filter(input => input.type === 'radio');
        const radioGroupIsolated = !radios.length || radios.every(input => input.name && input.name === radios[0].name && [...node.ownerDocument.getElementsByName(input.name)].filter(other => other.type === 'radio' && other.form === input.form).every(other => node.contains(other)));
        const inputs = textInputs(node).filter(input=>adapter!=='video-quiz'||courseElementVisible(input)&&!input.closest(MEDIA_EXCLUDED));
        const ueditor=adapter==='video-quiz'||!['blank','essay'].includes(canonicalType({typeLabel,question}))?null:readQuestionUEditor(node,id);
        const controls = { radios: native.filter(input => input.type === 'radio').length, checkboxes: native.filter(input => input.type === 'checkbox').length, textInputs: inputs.length, editableTextInputs: inputs.filter(input => !input.disabled && !input.readOnly).length, disabledChoices: native.filter(input => input.disabled).length, radioGroupIsolated, richText: node.querySelectorAll('[contenteditable="true"],iframe').length, choiceTargets: optionTargets.size };
        const shared = readQuestionSharedMaterials(node, group, groupId, local.graphHints || {});
        const { media, sharedMedia, imageNodes } = collectQuestionMedia(node, stem, id, groupId, optionTargets, shared.materials,matching);
        for (const option of options) {
            const imageIds = media.filter(item => item.location === 'option' && item.optionKey === option.key).map(item => item.id);
            if (imageIds.length) option.imageIds = imageIds;
        }
        if(matching){const describe=(item,location)=>`${item.key}. ${item.text} ${media.filter(image=>image.location===location&&image.optionKey===item.key).map(image=>`〔图片 ${image.id}〕`).join(' ')}`;question=[question,'第一组（按此顺序填写）：',...matching.left.map(item=>describe(item,'matching-left')),'第二组：',...matching.right.map(item=>describe(item,'option'))].join('\n');}
        const optionImageNodes = new Set(media.filter(item => item.location === 'option').map(item => imageNodes.get(item.id)));
        const unboundOptionImages = native.some(input => {
            const container = input.closest('.option,.answer-option,.option-item') || input.closest('label');
            return container && [...container.querySelectorAll('img,svg,canvas')].some(visual => !visual.closest(MEDIA_EXCLUDED)
                && !(visual.matches('svg,canvas') && !questionNodeActive(visual)) && !visual.parentElement?.closest('svg,canvas')
                && !questionNativeMathExpression(visual) && !optionImageNodes.has(visual)
                && !questionNativeMathExpression(visual.closest('math,[data-latex],[data-tex],[role="math"]')));
        });
        media.forEach(item => { item.sourceQuestionNumber = index + 1; });
        const chapterEvidence=writer==='chapter-choice'&&adapter!=='video-quiz'?JSON.stringify([...optionTargets].map(([key,row])=>
            [key,row.getAttribute('onclick'),[...row.querySelectorAll('input[type="radio"],input[type="checkbox"]')].map(input=>[input.type,input.name,input.value,input.id])])):null;
        return { id, number:index + 1, adapter, groupId, question, instructions, typeLabel, options, controls, media, sharedMedia, sharedMaterialUnreadable:shared.unreadable, unboundOptionImages, binding: { node, stem, group, inputs, optionTargets, imageNodes, writer, mooc2, matching, chapterRows, chapterEvidence,ueditor,sharedMaterials:shared.materials,
            choiceInputs:chapterEvidence===null?[]:native,choiceForm:chapterEvidence===null?null:node.closest('form'),adapterHints:local.graphHints || {} } };
    }
    registerPageAdapter({
        id:'chaoxing-mooc2-work',
        collect:(doc,context={})=>context.scope==='video-quiz' || !isMooc2HomeworkDocument(doc) ? [] : [...doc.querySelectorAll('.fanyaMarking_left .questionLi.singleQuesId')],
        read:(node,index)=>rawQuestion(node,index,'chaoxing-mooc2-work',{typeLabel:clean(node.getAttribute('typename')) || undefined})
    });
    registerPageAdapter({
        id: 'chaoxing-chapter',
        collect: (doc, context = {}) => context.scope === 'video-quiz' ? [] : [...doc.querySelectorAll('.singleQuesId')].filter(node => !node.closest('.fanyaMarking_left')),
        read: (node, index) => rawQuestion(node, index, 'chaoxing-chapter')
    });
    registerPageAdapter({
        id: 'chaoxing-homework',
        collect: (doc, context = {}) => context.scope === 'video-quiz' || isMooc2HomeworkDocument(doc) ? [] : [...doc.querySelectorAll('.fanyaMarking_left .questionLi.singleQuesId,.TiMu,.question-item[data-question-id],[data-questionid]')].filter(node => node.querySelector(STEM_SELECTOR)),
        read: (node, index) => rawQuestion(node, index, 'chaoxing-homework')
    });
    function canonicalType(raw) {
        const label = raw.typeLabel || raw.question.match(/【([^】]+)】/)?.[1] || '';
        if (/连线|匹配/.test(label)) return 'matching';
        if (/多选|多项选择/.test(label)) return 'multiple';
        if (/单选|单项选择/.test(label)) return 'single';
        if (/判断|是非/.test(label)) return 'judge';
        if (/填空/.test(label)) return 'blank';
        if (/简答|问答|论述/.test(label)) return 'essay';
        if (TEXT_ANSWER_TYPE_LABEL.test(clean(label))) return 'essay';
        return 'unknown';
    }
    function isSubmittedHomeworkView(node) {
        if (!node?.closest('.fanyaMarking_left')) return false;
        // 已只读确认的提交后作业查看路由；不能仅凭没有文本框就推断已提交。
        try { return /\/work\/view(?:\/|$)/.test(new URL(node.ownerDocument.URL).pathname); }
        catch { return false; }
    }

    // 提交形式仅约束原有自动填写保护，不阻止模型生成解答。
    function questionManualPrefillPolicy(question, instructions = question.instructions || '') {
        const text = clean([instructions, question.question].filter(Boolean).join('；'));
        const rules = [
            ['handwriting', /(?:请|须|需要|需|必须|要求|用|采用|以|只能|仅限|只接受)(?:先|直接|本人|亲自|在纸上|用纸笔|使用纸笔|进行|采用|用|以|纸质|方式|作答|答案|纸笔|\s){0,8}(?:手写|手绘)|(?:^|[；;。！？])\s*手写|(?:拍照|扫描)[^。！？；;]{0,15}(?:上传|提交)|(?:上传|提交)[^。！？；;]{0,15}(?:手写|照片|手稿)/, '需要手写或拍照上传'],
            ['copying', /(?:请|须|需|要求|进行|完成)(?:先|逐字|认真|用笔|在纸上|英文|英语|\s){0,5}(?:抄写|誊写|临摹)|(?:^|[；;。！？])\s*(?:抄写|誊写|临摹)/, '需要抄写或书写练习'],
            ['upload', /(?:请|必须|须|要求)(?:将|把)?(?:本题|你的|您的|作答|答案|答题结果|解答|结果|\s){0,6}(?:拍照|录音|录像|上传(?:附件|文件|照片|图片|音频|视频))|(?:以|通过)(?:附件|文件|照片|图片|音频|视频)(?:形式|方式)?(?:上传|提交)/, '需要拍照、录制或上传附件'],
            ['drawing', /(?:请|须|需要|需|要求)(?:先|根据材料|根据题意|用笔|自行|完成|制作|构建|一张|\s){0,6}(?:绘制|画出|手绘|思维导图|标注下图|标出图中)|(?:绘制|画出|制作|构建)[^。！？；;]{0,15}(?:图|曲线|示意|结构)/, '需要绘图、思维导图或标注']
        ];
        for (const [category, pattern, reason] of rules) {
            const match=text.match(pattern);
            if(match) return {status:'manual',category,reason,evidence:match[0].slice(0,200)};
        }
        return null;
    }
    function questionLocalAnswerPolicy(question) {
        if(question.type==='unknown' || question.capabilities?.analyze===false)
            return {status:'manual',category:'unsupported',reason:question.diagnostics?.join('；') || '题型或材料尚未适配',evidence:''};
        if(question.recognition?.materials === 'unreadable' || question.blocks?.some(block=>block.unreadable))
            return {status:'uncertain',category:'materials',reason:'题目包含尚未可靠读取的材料，请人工核对',evidence:''};
        return {status:'auto',category:['single','multiple','judge','matching'].includes(question.type)?'objective':'knowledge',reason:'直接生成答案与解析',evidence:''};
    }
    function questionCanAutoAnswer(question, policy) {
        const local=questionLocalAnswerPolicy(question);
        return !['manual','uncertain'].includes(local.status) && question.capabilities?.analyze!==false &&
            (policy || local).status==='auto';
    }
    function questionPrefillPolicy(question, entry) {
        const local=questionManualPrefillPolicy(question)||questionLocalAnswerPolicy(question);
        if(local.status==='manual')return local;
        if(question.capabilities?.prefill===false)
            return {status:'manual',category:'controls',reason:question.diagnostics?.join('；') || '控件暂不支持自动填写，请手动填写',evidence:''};
        if(local.status==='uncertain')return local;
        // 已分类结果只能限制本地白名单，不能解除明确的人工要求。
        if(entry?.answerPolicy && ['auto','manual','uncertain'].includes(entry.answerPolicy.status))return entry.answerPolicy;
        if(local.status==='auto')return local;
        return {status:'uncertain',category:'missing-policy',reason:'缺少作答要求判断，请重新分析',evidence:''};
    }

    function finishQuestion(raw, type, parser, inferred = false) {
        const diagnostics = [];
        const uniqueOptions = new Set(raw.options.map(option => option.key)).size === raw.options.length;
        const native = raw.binding.writer === 'native-choice';
        const choice = ['single','multiple','judge'].includes(type);
        const nativeCompatible = type === 'multiple' ? raw.controls.checkboxes === raw.options.length : raw.controls.radios === raw.options.length;
        let prefill = choice ? raw.options.length > 0 && uniqueOptions && (!native || (nativeCompatible && (type === 'multiple' || raw.controls.radioGroupIsolated))) : ['blank','essay'].includes(type) && raw.controls.textInputs === 1 && raw.controls.editableTextInputs === 1 && raw.controls.richText === 0;
        if(['blank','essay'].includes(type)&&raw.binding.ueditor)prefill=raw.binding.ueditor.valid
            &&raw.binding.inputs.length===1&&raw.binding.inputs[0]===raw.binding.ueditor.input;
        if(type==='matching'){prefill=raw.binding.matching?.valid===true;if(!prefill)diagnostics.push('连线题行号、控件、Chosen 或原生保存字段未可靠对应，暂不预填');}
        const mooc2Invalid=raw.binding.mooc2 && !raw.binding.mooc2.valid;
        if (mooc2Invalid) { diagnostics.push(...raw.binding.mooc2.diagnostics);prefill=false; }
        if(raw.binding.chapterRows&&!raw.binding.chapterRows.valid){diagnostics.push(...raw.binding.chapterRows.diagnostics);prefill=false;}
        const ownMedia = raw.media || [], sharedMedia = raw.sharedMedia || [];
        if (!raw.question && !ownMedia.length && !sharedMedia.length) { diagnostics.push('缺少可读取题干'); prefill = false; }
        if (!uniqueOptions) { diagnostics.push('选项键重复，无法可靠对应控件'); prefill = false; }
        if (raw.options.some(option => !option.text && !ownMedia.some(item => item.location === 'option' && item.optionKey === option.key))) { diagnostics.push('选项文本不完整'); prefill = false; }
        if (choice && native && !nativeCompatible) diagnostics.push('题型与选择控件不一致');
        if (native && type !== 'multiple' && !raw.controls.radioGroupIsolated) diagnostics.push('单选控件组缺失或跨题共享，暂不预填');
        const textAnswer = ['blank','essay'].includes(type);
        const submittedReview = textAnswer && raw.controls.editableTextInputs === 0 && !raw.controls.richText && isSubmittedHomeworkView(raw.binding.node);
        if (submittedReview) diagnostics.push('答案已提交，当前页面仅供查看，暂不预填');
        else {
            if (textAnswer && raw.controls.textInputs !== 1) diagnostics.push('多个或缺失文本框，暂不自动预填');
            if (textAnswer && raw.controls.editableTextInputs === 0) diagnostics.push('文本控件不可编辑');
        }
        if(raw.binding.ueditor&&!prefill)diagnostics.push(...raw.binding.ueditor.diagnostics);
        if(raw.binding.ueditor?.valid&&(raw.binding.inputs.length!==1||raw.binding.inputs[0]!==raw.binding.ueditor.input))
            diagnostics.push('UEditor：题目内文本答案控件无法唯一对应');
        if (type === 'unknown') { diagnostics.push('未识别题型，保留原始题目供核对'); prefill = false; }
        if (raw.unboundOptionImages) { diagnostics.push('选项图片无法可靠对应选项，暂不分析或预填'); prefill = false; }
        const question = {
            id: raw.id, number: raw.number, type, question: raw.question, instructions:raw.instructions || '', options: raw.options,
            groupId:raw.groupId || `question-group-${raw.id}`, imageIds:ownMedia.map(item => item.id), contextImageIds:sharedMedia.map(item => item.id),
            sharedMaterialIds:(raw.binding.sharedMaterials || []).map(material => material.id),
            recognition:{type:type === 'unknown' ? 'unknown' : inferred ? 'native-inferred' : TEXT_ANSWER_TYPE_LABEL.test(clean(raw.typeLabel)) ? 'text-alias' : 'declared',
                materials:raw.sharedMaterialUnreadable || [...ownMedia,...sharedMedia].some(item => item.unreadable) ? 'unreadable' : 'complete',
                sharing:raw.binding.sharedMaterials?.length ? 'explicit' : 'none',slots:'single'},
            source: { adapter: raw.adapter, parser, typeLabel: raw.typeLabel, inferred },
            controls: raw.controls,
            capabilities: { analyze: Boolean(raw.question || ownMedia.length || sharedMedia.length) && type !== 'unknown' && uniqueOptions
                &&(!raw.binding.chapterRows||raw.binding.chapterRows.contentValid)
                && !raw.options.some(option=>!option.text&&!ownMedia.some(item=>item.location==='option'&&item.optionKey===option.key))
                && !raw.unboundOptionImages && (!raw.binding.mooc2||raw.binding.mooc2.contentValid), prefill }, diagnostics
        };
        question.answerPolicy=questionLocalAnswerPolicy(question);
        return { question, binding: { ...raw.binding, writer:prefill&&raw.binding.ueditor?.valid?'ueditor':raw.binding.writer, type, canPrefill: prefill } };
    }
    registerQuestionParser({ id: 'declared-type', match: raw => canonicalType(raw) !== 'unknown', parse: raw => finishQuestion(raw, canonicalType(raw), 'declared-type') });
    registerQuestionParser({
        id: 'native-choice',
        match: raw => !raw.typeLabel && (raw.controls.radios > 0 || raw.controls.checkboxes > 0) && !(raw.controls.radios && raw.controls.checkboxes),
        parse: raw => finishQuestion(raw, raw.controls.checkboxes ? 'multiple' : 'single', 'native-choice', true)
    });
    registerQuestionParser({ id: 'unknown', match: () => true, parse: raw => finishQuestion(raw, 'unknown', 'unknown') });
    function parseQuestionDocument(doc = document, parseContext = {}) {
        const raw = collectRawQuestions(doc, parseContext);
        if (!raw.length) throw questionParseError('CX-PAR-001', '没有检测到题目，请先进入章节测验或作业');
        const questions = [], media = [], materials = [], bindings = new Map(), mediaNodes = new Map();
        for (const record of raw) {
            const parser = questionTypeParsers.find(item => item.id !== 'unknown' && item.match(record)) || questionTypeParsers.find(item => item.id === 'unknown');
            const parsed = parser.parse(record);
            if (bindings.has(parsed.question.id)) throw questionParseError('CX-PAR-007', '题目 ID 重复，已停止');
            questions.push(parsed.question); bindings.set(parsed.question.id, parsed.binding);
            for (const descriptor of [...(record.media || []),...(record.sharedMedia || [])]) {
                const existing = media.find(item => item.id === descriptor.id), imageNode = record.binding.imageNodes.get(descriptor.id);
                if (existing && (mediaNodes.get(descriptor.id) !== imageNode || JSON.stringify(existing) !== JSON.stringify(descriptor)))
                    throw questionParseError('CX-PAR-008','题目图片或共用材料标识无法唯一对应');
                if (!existing) { media.push(descriptor); mediaNodes.set(descriptor.id,imageNode); }
            }
            for (const material of record.binding.sharedMaterials || []) {
                const text = questionContentText(material.node);
                const existing = materials.find(item => item.id === material.id);
                if (existing && existing.node !== material.node) throw questionParseError('CX-PAR-008','共用材料引用无法唯一对应');
                if (!existing) materials.push({id:material.id,type:'shared-context',text,node:material.node});
            }
        }
        for(const question of questions)question.answerPolicy=questionLocalAnswerPolicy(question);
        return { schemaVersion: 2, questions, media, materials:materials.map(({node,...material}) => material), bindings };
    }

    // Schema 3 shares the proven adapters and bindings with Schema 2. General layers do
    // not invent platform selectors or infer a slot from the number of text boxes.
    function questionParseError(code, message) {
        if (typeof createCxError === 'function') return createCxError(code, {module:'question-parser',operation:'parse-document'});
        const error = new Error(message); error.code = code; error.cxCode = code; return error;
    }
    function createQuestionParseLookup(media) {
        const documents = new WeakMap();
        return {
            mediaById:new Map((media || []).map(item => [item.id,item])),
            documentIndex(doc) {
                if (!documents.has(doc)) {
                    const nodesById = new Map(), labelsByControl = new WeakMap();
                    for (const node of doc.querySelectorAll('[id]')) {
                        const matches = nodesById.get(node.id) || [];
                        matches.push(node); nodesById.set(node.id,matches);
                    }
                    for (const label of doc.querySelectorAll('label')) {
                        const control = label.control;
                        if (!control) continue;
                        const labels = labelsByControl.get(control) || [];
                        labels.push(label); labelsByControl.set(control,labels);
                    }
                    documents.set(doc,{nodesById,labelsByControl});
                }
                return documents.get(doc);
            }
        };
    }
    function parseQuestionContent(node, context = {}, adapterHints = {}) {
        const question = context.question || {}, binding = context.binding || {};
        const blocks = [], slots = [], subquestions = [], imageNodes = binding.imageNodes || new Map();
        let slotAmbiguous = false;
        const mediaByNode = new Map([...imageNodes].map(([id, image]) => [image, id]));
        const descriptors = context.parseLookup?.mediaById || new Map((context.media || []).map(item => [item.id,item]));
        const text = value => typeof clean === 'function' ? clean(value) : String(value || '').replace(/\s+/g, ' ').trim();
        const addText = value => { const valueText = text(value); if (valueText) blocks.push({type:'text', text:valueText}); };
        const walk = current => {
            if (current.nodeType === 3) { addText(current.textContent); return; }
            if(binding.matching&&current.nodeType===1&&current.matches('.chosen-container'))return;
            if (current.nodeType !== 1 || current.matches(MEDIA_EXCLUDED + ',script,style,button,input,textarea,select,[contenteditable="true"]')) return;
            if (context.parseContext?.scope === 'video-quiz' && typeof courseElementVisible === 'function' && !courseElementVisible(current)) return;
            if (current.matches('.Zy_ulTop,.option,.answer-option,.option-item')) return;
            if (current.matches('svg,canvas') && !questionNodeActive(current)) return;
            const expression = questionNativeMathExpression(current);
            if (expression) { blocks.push({type:'math',expression}); return; }
            if (current.matches('img,svg,canvas')) {
                const mediaId = mediaByNode.get(current);
                if (mediaId) blocks.push({type:'image', mediaId, ...(descriptors.get(mediaId)?.unreadable ? {unreadable:true} : {})});
                else blocks.push({type:'image', unreadable:true});
                return;
            }
            if (current.localName === 'math') {
                const expression = text(current.querySelector('annotation[encoding="application/x-tex"]')?.textContent || current.textContent);
                blocks.push({type:'math', ...(expression ? {expression} : {unreadable:true})}); return;
            }
            if (current.tagName === 'TABLE') {
                blocks.push({type:'table', rows:[...current.rows].map(row => [...row.cells].map(cell => text(questionContentText(cell))))}); return;
            }
            if (current.tagName === 'PRE' || current.tagName === 'CODE') { blocks.push({type:'code', text:questionContentText(current)}); return; }
            for (const child of current.childNodes) walk(child);
        };
        const stem = adapterHints.stem || binding.stem;
        if (stem) walk(stem); else addText(question.question);
        for (const material of binding.sharedMaterials || []) {
            const materialText = questionContentText(material.node);
            if (materialText) blocks.push({type:'shared-context',text:materialText});
        }
        for (const mediaId of question.contextImageIds || []) if (!blocks.some(block => block.mediaId === mediaId))
            blocks.push({type:'image',mediaId,...(descriptors.get(mediaId)?.unreadable ? {unreadable:true} : {})});
        if (question.recognition?.materials === 'unreadable') blocks.push({type:'shared-context',unreadable:true});
        // Only explicit slot/semantic references supplied by an adapter, or valid
        // native label references, can create independently addressable text units.
        if (Array.isArray(adapterHints.slots)) {
            for (const slot of adapterHints.slots) {
                if (!slot?.id || slot.control?.nodeType !== 1 || slot.control.ownerDocument !== node.ownerDocument
                    || !node.contains(slot.control) || !(binding.inputs || []).includes(slot.control)
                    || adapterHints.slots.filter(other => String(other?.id) === String(slot.id) || other?.control === slot.control).length !== 1) { slotAmbiguous = true; continue; }
                slots.push({id:String(slot.id), text:text(slot.text), control:slot.control,
                    evidence:['adapter-slot-reference'], type:slot.type || question.type});
            }
        } else if (['blank','essay'].includes(question.type)) {
            const labels = [...node.querySelectorAll('label')];
            const index = context.parseLookup?.documentIndex(node.ownerDocument);
            const allLabels = index ? null : [...node.ownerDocument.querySelectorAll('label')];
            const idCounts = index ? null : new Map();
            if (!index) for (const element of node.ownerDocument.querySelectorAll('[id]')) idCounts.set(element.id, (idCounts.get(element.id) || 0) + 1);
            const idCount = id => index ? index.nodesById.get(id)?.length : idCounts.get(id);
            const labelCount = control => index ? (index.labelsByControl.get(control)?.length || 0) : allLabels.filter(other => other.control === control).length;
            for (const label of labels) {
                const targets = (binding.inputs || []).filter(input => label.control === input && node.contains(input));
                if (targets.length !== 1 || !text(questionContentText(label))) continue;
                const control = targets[0];
                if (control.id && idCount(control.id) !== 1 || node.closest('form') && control.form !== node.closest('form') || !questionNodeActive(label)) continue;
                if (labelCount(control) !== 1 || slots.some(slot => slot.control === control)) continue;
                slots.push({id:`label-${slots.length + 1}`, text:text(questionContentText(label)), control, evidence:['native-label-reference'], type:question.type});
            }
            for (const control of binding.inputs || []) {
                if (slots.some(slot => slot.control === control) || control.id && idCount(control.id) !== 1 || node.closest('form') && control.form !== node.closest('form')) continue;
                const references = (control.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
                if (!references.length || new Set(references).size !== references.length) continue;
                const signature = [...references].sort().join(' ');
                if ((binding.inputs || []).filter(other => (other.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean).sort().join(' ') === signature).length !== 1) continue;
                const targets = references.map(id => index ? index.nodesById.get(id) || [] : [...node.ownerDocument.querySelectorAll('[id]')].filter(target => target.id === id));
                if (targets.some(matches => matches.length !== 1 || !node.contains(matches[0]) || matches[0].contains(control)
                    || matches[0].closest(MEDIA_EXCLUDED) || !questionNodeActive(matches[0]))) continue;
                const label = targets.map(matches => text(questionContentText(matches[0]))).filter(Boolean).join('；');
                if (label) slots.push({id:`aria-${slots.length + 1}`,text:label,control,evidence:['native-aria-reference'],type:question.type});
            }
        }
        for (const slot of slots) blocks.push({type:'slot', id:slot.id, text:slot.text});
        if (Array.isArray(adapterHints.subquestions)) {
            for (const child of adapterHints.subquestions) {
                if (!child?.id || !child.root || !node.contains(child.root)) continue;
                // An entire child region may include an existing written answer.
                // Only adapter-declared content text/stem is eligible material.
                const label = text(child.text || (child.stem && child.root.contains(child.stem) ? questionContentText(child.stem) : ''));
                subquestions.push({...child, text:label}); blocks.push({type:'subquestion', id:String(child.id), text:label});
            }
        }
        if (question.instructions) blocks.unshift({type:'instruction', text:question.instructions});
        return {blocks, slots, subquestions, slotAmbiguous, diagnostics:[...(blocks.some(block => block.unreadable) ? ['unreadable-content'] : []),...(slotAmbiguous ? ['ambiguous-slot-reference'] : [])]};
    }
    function parseQuestionControls(node, context = {}, adapterHints = {}) {
        const question = context.question || {}, binding = context.binding || {}, controls = [], runtime = new Map();
        let sequence = 0;
        const add = (target, kind, writable, extra = {}) => {
            if (!target || [...runtime.values()].includes(target)) return;
            const id = `${question.id}:control:${++sequence}`;
            const descriptor = {id, kind, groupId:question.id, recognized:kind !== 'unknown',
                writable:Boolean(writable && !target.disabled && !target.readOnly),
                state:{disabled:Boolean(target.disabled), readOnly:Boolean(target.readOnly)}, diagnostics:[], ...extra};
            controls.push(descriptor); runtime.set(id, target);
        };
        for (const [key, target] of binding.optionTargets || []) add(target,
            ['chapter-choice','mooc2-choice'].includes(binding.writer) ? binding.writer : target.type === 'checkbox' ? 'checkbox' : 'radio',
            binding.canPrefill, {optionKey:key, groupId:`${question.id}:options`});
        if(binding.matching)for(const row of binding.matching.rows)add(row.select,'select',binding.canPrefill,{matchingRow:row.index});
        for (const input of binding.inputs || []) add(input, input.tagName === 'TEXTAREA' ? 'textarea' : 'text',
            ['blank','essay'].includes(question.type) && (!question.controls?.richText || binding.writer==='ueditor'&&binding.ueditor?.valid&&binding.ueditor.input===input));
        for (const target of node.querySelectorAll('select,input[type="file"],[contenteditable="true"],canvas')) {
            if (target.closest(MEDIA_EXCLUDED) || typeof courseElementVisible === 'function' && !courseElementVisible(target)) continue;
            if (target.tagName === 'CANVAS' && [...(binding.imageNodes || new Map()).values()].includes(target)) continue;
            add(target, target.tagName === 'SELECT' ? 'select' : target.tagName === 'CANVAS' ? 'canvas' : target.type === 'file' ? 'upload' : 'richtext', false);
        }
        return {controls, runtime, diagnostics:controls.filter(control => !control.writable).map(control => ({targetId:control.id, code:'no-safe-writer'}))};
    }
    function matchQuestionRelations(content, controls, context = {}) {
        const question = context.question || {}, binding = context.binding || {}, relations = [], responseUnits = [];
        const all = controls.controls, textControls = all.filter(control => ['text','textarea'].includes(control.kind));
        const unit = (id, type, controlIds, status, evidence, text = '') => {
            responseUnits.push({id, questionId:question.id, type, required:true, controlIds, relationStatus:status, question:text});
            const targetId = controlIds.length === 1 ? controlIds[0] : `${question.id}:options`;
            relations.push({responseUnitId:id, targetId, targetKind:controlIds.length === 1 ? 'control' : 'group', status, evidence});
        };
        if(question.type==='matching'){const targets=all.filter(control=>control.matchingRow);const confirmed=binding.canPrefill&&targets.length===binding.matching?.rows.length&&targets.every(control=>control.writable);unit(question.id,'matching',targets.map(control=>control.id),confirmed?'confirmed':'unsupported',['matching-row-binding']);}
        else if (['single','multiple','judge'].includes(question.type)) {
            const targets = all.filter(control => control.optionKey);
            const confirmed = binding.canPrefill && targets.length === question.options.length && targets.every(control => control.writable);
            unit(question.id, question.type, targets.map(control => control.id), confirmed ? 'confirmed' : 'unsupported',
                confirmed ? ['adapter-option-key','isolated-option-group'] : ['unverified-option-group']);
        } else if (['blank','essay'].includes(question.type) && content.slotAmbiguous) {
            unit(question.id, question.type, textControls.map(control => control.id), 'ambiguous', ['invalid-slot-reference']);
        } else if (['blank','essay'].includes(question.type) && content.slots.length > 1) {
            for (const slot of content.slots) {
                const descriptor = textControls.find(control => controls.runtime.get(control.id) === slot.control);
                const valid = descriptor?.writable && content.slots.filter(other => other.id === slot.id || other.control === slot.control).length === 1;
                unit(`${question.id}::unit:${slot.id}`, slot.type, descriptor ? [descriptor.id] : [], valid ? 'confirmed' : 'ambiguous', slot.evidence, slot.text);
            }
            if (textControls.length !== content.slots.length) unit(`${question.id}::unmapped`, question.type, [], 'ambiguous', ['unmatched-response-controls']);
        } else {
            const confirmed = binding.canPrefill && textControls.length === 1 && textControls[0].writable;
            unit(question.id, question.type, textControls.map(control => control.id), confirmed ? 'confirmed' : question.type === 'unknown' ? 'unsupported' : 'ambiguous',
                confirmed ? ['adapter-question-boundary','unique-text-response'] : ['missing-unique-response']);
        }
        // A writable text/choice area does not make another explicitly present
        // unsupported response control complete. Preserve partial analysis safely.
        if (relations.some(relation => relation.status === 'confirmed')) {
            for (const control of all.filter(control => ['select','upload','richtext','canvas'].includes(control.kind)&&!control.matchingRow))
                unit(`${question.id}::unsupported:${control.id.split(':').at(-1)}`, 'unknown', [control.id], 'unsupported', ['no-safe-writer']);
        }
        return {responseUnits, relations};
    }
    function parseQuestionGraph(doc = document, parseContext = {}) {
        const legacy = parseQuestionDocument(doc, parseContext), controls = [], relations = [], materials = legacy.materials || [], bindings = new Map(legacy.bindings);
        // This lookup lives for one synchronous parse only; every snapshot check builds fresh indexes.
        const parseLookup = createQuestionParseLookup(legacy.media);
        const questions = legacy.questions.map(original => {
            const binding = legacy.bindings.get(original.id), context = {question:original, binding, doc, parseContext,media:legacy.media,parseLookup};
            const content = parseQuestionContent(binding.node, context, binding.adapterHints || {});
            const parsedControls = parseQuestionControls(binding.node, context, binding.adapterHints || {});
            const matched = matchQuestionRelations(content, parsedControls, context);
            controls.push(...parsedControls.controls); relations.push(...matched.relations);
            const composite = matched.responseUnits.length > 1;
            const question = {...original, structure:composite ? 'composite' : 'simple', blocks:content.blocks,
                responseUnits:matched.responseUnits, diagnostics:[...original.diagnostics, ...content.diagnostics],
                recognition:{...original.recognition,materials:content.blocks.some(block => block.unreadable) ? 'unreadable' : original.recognition.materials,
                    slots:matched.responseUnits.some(unit => unit.relationStatus === 'ambiguous') ? 'ambiguous'
                        : content.slots.length > 1 ? content.slots.some(slot => slot.evidence.includes('adapter-slot-reference')) ? 'adapter-declared' : 'native-label' : 'single'}};
            for (const unit of matched.responseUnits) {
                if (!composite || unit.id === original.id) continue;
                const nodes = unit.controlIds.map(id => parsedControls.runtime.get(id)).filter(Boolean);
                bindings.set(unit.id, {...binding, inputs:nodes, optionTargets:new Map(), writer:'none', type:unit.type,
                    canPrefill:unit.relationStatus === 'confirmed'});
            }
            const confirmed = matched.responseUnits.filter(unit => unit.relationStatus === 'confirmed').length;
            question.answerPolicy=questionLocalAnswerPolicy(question);
            question.supportLevel = question.recognition.materials === 'unreadable' ? 'Unreadable' : question.answerPolicy.status === 'manual' ? 'Manual Required'
                : !original.capabilities.analyze ? (original.type === 'unknown' ? 'Unsupported' : 'Unreadable')
                : confirmed === matched.responseUnits.length ? 'Fully Supported' : confirmed ? 'Partial Support' : 'Analyze Only';
            return question;
        });
        const graph = {schemaVersion:3, questions, materials, media:legacy.media, controls, relations, bindings, lifecycle:null};
        Object.defineProperty(graph, 'legacySnapshot', {value:legacy});
        return graph;
    }
    function toLegacyQuestionSnapshot(graph) {
        if (graph?.schemaVersion !== 3 || !graph.legacySnapshot) throw new Error('无效题目图');
        return graph.legacySnapshot;
    }
    function buildQuestionRequestUnits(graph) {
        const questions = [], bindings = new Map(), parentByUnit = new Map(), unitsByQuestion = new Map();
        for (const parent of graph.questions) {
            const ids = [];
            for (const unit of parent.responseUnits) {
                const composite = parent.structure === 'composite';
                const confirmed = unit.relationStatus === 'confirmed';
                let question = parent;
                if (composite) {
                    const count = unit.controlIds.length;
                    const textUnit = ['blank','essay'].includes(unit.type);
                    const material = graph.materials.filter(item => parent.sharedMaterialIds.includes(item.id)).map(item => item.text).filter(Boolean).join('\n');
                    question = {...parent, id:unit.id, parentQuestionId:parent.id, parentNumber:parent.number, type:unit.type,
                        question:[parent.question, material, unit.question].filter(Boolean).join('\n'),
                        options:unit.id===parent.id && !textUnit ? parent.options : [],
                        controls:textUnit ? {...parent.controls, textInputs:count, editableTextInputs:confirmed ? count : 0, richText:parent.controls.richText || 0} : parent.controls,
                        diagnostics:parent.diagnostics.filter(value => value !== '多个或缺失文本框，暂不自动预填'),
                        capabilities:{analyze:parent.capabilities.analyze, prefill:confirmed}, responseUnitId:unit.id};
                    question.answerPolicy = questionLocalAnswerPolicy(question);
                } else question = {...parent, capabilities:{...parent.capabilities, prefill:parent.capabilities.prefill && confirmed}};
                questions.push(question); bindings.set(unit.id, graph.bindings.get(unit.id) || graph.bindings.get(parent.id));
                parentByUnit.set(unit.id, parent.id); ids.push(unit.id);
            }
            unitsByQuestion.set(parent.id, ids);
        }
        return {questions, media:graph.media, bindings, parentByUnit, unitsByQuestion};
    }
