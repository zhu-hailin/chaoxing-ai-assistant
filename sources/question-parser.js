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
    function collectRawQuestions(doc = document, parseContext = {}) {
        const records = [], seen = new Set(), claimedAncestors = new Set();
        for (const adapter of questionPageAdapters) {
            const nodes = [...adapter.collect(doc, parseContext)].filter(node => parseContext.scope === 'video-quiz' ? parseContext.root?.contains(node) : !node.closest('.ans-videoquiz,[data-video-quiz-root]') && !node.closest('[role="dialog"],form')?.querySelector('#videoquiz-submit')), candidates = new Set(nodes), containers = new Set();
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
    function hasQuestionNodes(doc = document) { return collectRawQuestions(doc).length > 0; }
    function textInputs(node) {
        return [...node.querySelectorAll('textarea,input[type="text"],input:not([type])')]
            .filter(input => !input.closest('.cx-ai-ignore') && input.type !== 'password');
    }
    const STEM_SELECTOR = '.Zy_TItle .fontLabel,.Zy_TItle,.question-stem,.question-title,.mark_name,.stem,[data-question-text]';
    const MEDIA_EXCLUDED = 'dl,.mark_answer,.answer-content,.correct-answer,.teacher-comment,.editor-toolbar,.attachment,.cx-ai-ignore';
    function questionContentText(root) {
        if (!root) return '';
        if (root.nodeType === 3) return root.textContent || '';
        if (root.nodeType !== 1 || root.matches('input,textarea,select,button,script,style,[contenteditable="true"],.mark_answer,.answer-content,.correct-answer,.teacher-comment,.editor-toolbar,.cx-ai-ignore')) return '';
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
        if (label && /^(简答|问答|论述|单选|多选|判断|填空)$/.test(label)) return label;
        return clean(group?.querySelector(':scope > .type_tit')?.textContent.match(/(多项选择|单项选择|多选|单选|判断|是非|填空|简答|问答|论述)题?/)?.[0]);
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
    function collectQuestionMedia(node, stem, id, groupId, optionTargets = new Map()) {
        const media = [], imageNodes = new Map(), seen = new Set();
        const collect = (root, location, optionKey = null) => {
            if (!root) return;
            let index = 0;
            for (const img of root.matches('img') ? [root] : root.querySelectorAll('img')) {
                if (seen.has(img) || img.closest(MEDIA_EXCLUDED)) continue;
                if (location === 'stem' && img.closest('.Zy_ulTop,.option,.answer-option,.option-item')) continue;
                seen.add(img);
                const imageId = `img-${id}-${location}-${optionKey || 'q'}-${++index}`;
                media.push({ id:imageId, groupId, sourceQuestionId:id, location, optionKey, src:imageSource(img), alt:clean(img.alt) });
                imageNodes.set(imageId, img);
            }
        };
        // 先绑定选项图片；即使选项被包在 .Zy_TItle 中，也不能变成组内共用题干。
        for (const [key, target] of optionTargets) {
            collect(optionContentRoot(node, target), 'option', key);
        }
        // .fontLabel 有时只是题干的一部分，图片位于同一个 .Zy_TItle 内。
        collect(stem?.closest('.Zy_TItle') || stem, 'stem');
        return { media, imageNodes };
    }
    function rawQuestion(node, index, adapter, videoContext = {}) {
        // 仅视频适配器可传入已验证的局部题干/题型；普通章节选择器保持原样。
        const local = adapter === 'video-quiz' ? videoContext : {};
        const stem = local.stem || node.querySelector(adapter === 'video-quiz' ? STEM_SELECTOR + ",legend" : STEM_SELECTOR);
        const group = node.closest('.mark_item');
        const id = questionId(node, index);
        const groupId = group ? `work-group-${[...node.ownerDocument.querySelectorAll('.mark_item')].indexOf(group) + 1}` : `question-group-${id}`;
        const typeLabel = local.typeLabel ?? readQuestionTypeLabel(node, stem, group);
        const question = stripQuestionPrefix(questionContentText(stem), typeLabel);
        const instructions = clean([node.getAttribute('data-answer-instructions'),
            ...[...node.children].filter(child=>child.matches('.question-instructions,[data-answer-instructions]')).map(questionContentText),
            questionContentText(group?.querySelector(':scope > .type_tit')),
            questionContentText(group?.querySelector(':scope > .question-instructions'))].filter(Boolean).join('；'));
        const legacy = [...node.querySelectorAll('.Zy_ulTop li')];
        const native = [...node.querySelectorAll('input[type="radio"],input[type="checkbox"]')].filter(input=>adapter!=='video-quiz'||courseElementVisible(input)&&!input.closest(MEDIA_EXCLUDED));
        let optionTargets, options, writer;
        if (legacy.length) {
            const type = detectType(typeLabel || question);
            options = legacy.map((li, i) => { const key = optionKey(li, i, type); return { key, text: optionText(li, key) }; });
            optionTargets = new Map(options.map((option, i) => [option.key, legacy[i]])); writer = 'chapter-choice';
        } else {
            options = native.map((input, i) => {
                const label = optionContentRoot(node, input);
                const text = clean(label?.textContent || input.getAttribute('aria-label') || '');
                const prefix = text.match(/^([A-Z])\s*[、.．:：)）]/)?.[1];
                const key = clean(input.getAttribute('data-option-key') || prefix || (input.value !== 'on' ? input.value : '') || String.fromCharCode(65 + i));
                return { key, text: /^[A-Z]$/.test(key) ? text.replace(new RegExp('^' + key + '\\s*[、.．:：)）]\\s*'), '') : text };
            });
            optionTargets = new Map(options.map((option, i) => [option.key, native[i]])); writer = native.length ? 'native-choice' : 'none';
        }
        const radios = native.filter(input => input.type === 'radio');
        const radioGroupIsolated = !radios.length || radios.every(input => input.name && input.name === radios[0].name && [...node.ownerDocument.getElementsByName(input.name)].filter(other => other.type === 'radio' && other.form === input.form).every(other => node.contains(other)));
        const inputs = textInputs(node).filter(input=>adapter!=='video-quiz'||courseElementVisible(input)&&!input.closest(MEDIA_EXCLUDED));
        const controls = { radios: native.filter(input => input.type === 'radio').length, checkboxes: native.filter(input => input.type === 'checkbox').length, textInputs: inputs.length, editableTextInputs: inputs.filter(input => !input.disabled && !input.readOnly).length, disabledChoices: native.filter(input => input.disabled).length, radioGroupIsolated, richText: node.querySelectorAll('[contenteditable="true"],iframe').length, choiceTargets: optionTargets.size };
        const { media, imageNodes } = collectQuestionMedia(node, stem, id, groupId, optionTargets);
        for (const option of options) {
            const imageIds = media.filter(item => item.location === 'option' && item.optionKey === option.key).map(item => item.id);
            if (imageIds.length) option.imageIds = imageIds;
        }
        const optionImageNodes = new Set(media.filter(item => item.location === 'option').map(item => imageNodes.get(item.id)));
        const unboundOptionImages = native.some(input => {
            const container = input.closest('.option,.answer-option,.option-item') || input.closest('label');
            return container && [...container.querySelectorAll('img')].some(img => !img.closest(MEDIA_EXCLUDED) && !optionImageNodes.has(img));
        });
        media.forEach(item => { item.sourceQuestionNumber = index + 1; });
        return { id, number:index + 1, adapter, groupId, question, instructions, typeLabel, options, controls, media, unboundOptionImages, binding: { node, stem, group, inputs, optionTargets, imageNodes, writer, adapterHints:local.graphHints || {} } };
    }
    registerPageAdapter({
        id: 'chaoxing-chapter',
        collect: (doc, context = {}) => context.scope === 'video-quiz' ? [] : [...doc.querySelectorAll('.singleQuesId')].filter(node => !node.closest('.fanyaMarking_left')),
        read: (node, index) => rawQuestion(node, index, 'chaoxing-chapter')
    });
    registerPageAdapter({
        id: 'chaoxing-homework',
        collect: (doc, context = {}) => context.scope === 'video-quiz' ? [] : [...doc.querySelectorAll('.fanyaMarking_left .questionLi.singleQuesId,.TiMu,.question-item[data-question-id],[data-questionid]')].filter(node => node.querySelector(STEM_SELECTOR)),
        read: (node, index) => rawQuestion(node, index, 'chaoxing-homework')
    });
    function canonicalType(raw) {
        const label = raw.typeLabel || raw.question.match(/【([^】]+)】/)?.[1] || '';
        if (/多选|多项选择/.test(label)) return 'multiple';
        if (/单选|单项选择/.test(label)) return 'single';
        if (/判断|是非/.test(label)) return 'judge';
        if (/填空/.test(label)) return 'blank';
        if (/简答|问答|论述/.test(label)) return 'essay';
        return 'unknown';
    }
    function isSubmittedHomeworkView(node) {
        if (!node?.closest('.fanyaMarking_left')) return false;
        // 已只读确认的提交后作业查看路由；不能仅凭没有文本框就推断已提交。
        try { return /\/work\/view(?:\/|$)/.test(new URL(node.ownerDocument.URL).pathname); }
        catch { return false; }
    }

    // 作答内容要求与 DOM 可写入能力分开判断；仅使用当前题及其所属题组说明。
    function questionLocalAnswerPolicy(question, instructions = question.instructions || '') {
        const text = clean([instructions, question.question].filter(Boolean).join('；'));
        const rules = [
            ['handwriting', /(?:请|须|需要|需|必须|要求|用|采用|以|只能|仅限|只接受)(?:先|直接|本人|亲自|在纸上|用纸笔|使用纸笔|进行|采用|用|以|纸质|方式|作答|答案|纸笔|\s){0,8}(?:手写|手绘)|(?:^|[；;。！？])\s*手写|(?:拍照|扫描)[^。！？；;]{0,15}(?:上传|提交)|(?:上传|提交)[^。！？；;]{0,15}(?:手写|照片|手稿)/, '需要手写或拍照上传'],
            ['copying', /(?:请|须|需|要求|进行|完成)(?:先|逐字|认真|用笔|在纸上|英文|英语|\s){0,5}(?:抄写|誊写|临摹)|(?:^|[；;。！？])\s*(?:抄写|誊写|临摹)/, '需要抄写或书写练习'],
            ['drawing', /(?:请|须|需要|需|要求)(?:先|根据材料|根据题意|用笔|自行|完成|制作|构建|一张|\s){0,6}(?:绘制|画出|手绘|思维导图|标注下图|标出图中)|(?:绘制|画出|制作|构建)[^。！？；;]{0,15}(?:图|曲线|示意|结构)/, '需要绘图、思维导图或标注']
        ];
        for (const [category, pattern, reason] of rules) {
            const match=text.match(pattern);
            if(match) return {status:'manual',category,reason,evidence:match[0].slice(0,200)};
        }
        if(question.type==='unknown' || question.capabilities?.analyze===false)
            return {status:'manual',category:'unsupported',reason:question.diagnostics?.join('；') || '题型或材料尚未适配',evidence:''};
        if(question.capabilities?.prefill===false)
            return {status:'manual',category:'controls',reason:question.diagnostics?.join('；') || '控件暂不支持自动填写',evidence:''};
        if(['single','multiple','judge'].includes(question.type) && question.question && !questionImageIds(question).length)
            return {status:'auto',category:'objective',reason:'明确的选择或判断题',evidence:question.source?.typeLabel || question.type};
        return {status:'needs-classification',category:'pending',reason:'需要判断作答要求',evidence:''};
    }
    function questionCanAutoAnswer(question, policy) {
        const local=questionLocalAnswerPolicy(question);
        return local.status!=='manual' && question.capabilities?.analyze!==false &&
            (policy || local).status==='auto';
    }
    function questionPrefillPolicy(question, entry) {
        const local=questionLocalAnswerPolicy(question);
        if(local.status==='manual')return local;
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
        const ownMedia = raw.media || [];
        if (!raw.question && !ownMedia.length) { diagnostics.push('缺少可读取题干'); prefill = false; }
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
        if (raw.controls.richText) diagnostics.push('富文本或嵌入控件暂不自动预填');
        if (type === 'unknown') { diagnostics.push('未识别题型，保留原始题目供核对'); prefill = false; }
        if (raw.unboundOptionImages) { diagnostics.push('选项图片无法可靠对应选项，暂不分析或预填'); prefill = false; }
        const question = {
            id: raw.id, number: raw.number, type, question: raw.question, instructions:raw.instructions || '', options: raw.options,
            groupId:raw.groupId || `question-group-${raw.id}`, imageIds:ownMedia.map(item => item.id), contextImageIds:[],
            source: { adapter: raw.adapter, parser, typeLabel: raw.typeLabel, inferred },
            controls: raw.controls,
            capabilities: { analyze: Boolean(raw.question || ownMedia.length) && type !== 'unknown' && !raw.unboundOptionImages, prefill }, diagnostics
        };
        question.answerPolicy=questionLocalAnswerPolicy(question);
        return { question, binding: { ...raw.binding, type, canPrefill: prefill } };
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
        const questions = [], media = [], bindings = new Map();
        for (const record of raw) {
            const parser = questionTypeParsers.find(item => item.id !== 'unknown' && item.match(record)) || questionTypeParsers.find(item => item.id === 'unknown');
            const parsed = parser.parse(record);
            if (bindings.has(parsed.question.id)) throw questionParseError('CX-PAR-007', '题目 ID 重复，已停止');
            questions.push(parsed.question); bindings.set(parsed.question.id, parsed.binding);
            media.push(...(record.media || []));
        }
        for (const question of questions) {
            question.contextImageIds = media.filter(item => item.groupId === question.groupId && item.location === 'stem' && item.sourceQuestionId !== question.id).map(item => item.id);
            if (question.type !== 'unknown' && question.contextImageIds.length && !question.question && !question.diagnostics.includes('选项图片无法可靠对应选项，暂不分析或预填')) {
                question.capabilities.analyze = true;
                question.diagnostics = question.diagnostics.filter(text => text !== '缺少可读取题干');
            }
        }
        for(const question of questions)question.answerPolicy=questionLocalAnswerPolicy(question);
        return { schemaVersion: 2, questions, media, bindings };
    }

    // Schema 3 shares the proven adapters and bindings with Schema 2. General layers do
    // not invent platform selectors or infer a slot from the number of text boxes.
    function questionParseError(code, message) {
        if (typeof createCxError === 'function') return createCxError(code, {module:'question-parser',operation:'parse-document'});
        const error = new Error(message); error.code = code; error.cxCode = code; return error;
    }
    function parseQuestionContent(node, context = {}, adapterHints = {}) {
        const question = context.question || {}, binding = context.binding || {};
        const blocks = [], slots = [], subquestions = [], imageNodes = binding.imageNodes || new Map();
        const mediaByNode = new Map([...imageNodes].map(([id, image]) => [image, id]));
        const text = value => typeof clean === 'function' ? clean(value) : String(value || '').replace(/\s+/g, ' ').trim();
        const addText = value => { const valueText = text(value); if (valueText) blocks.push({type:'text', text:valueText}); };
        const walk = current => {
            if (current.nodeType === 3) { addText(current.textContent); return; }
            if (current.nodeType !== 1 || current.matches(MEDIA_EXCLUDED + ',script,style,button,input,textarea,select,[contenteditable="true"]')) return;
            if (context.parseContext?.scope === 'video-quiz' && typeof courseElementVisible === 'function' && !courseElementVisible(current)) return;
            if (current.matches('.Zy_ulTop,.option,.answer-option,.option-item')) return;
            if (current.tagName === 'IMG') {
                const mediaId = mediaByNode.get(current);
                if (mediaId) blocks.push({type:'image', mediaId});
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
        // Only explicit slot/semantic references supplied by an adapter, or valid
        // native label references, can create independently addressable text units.
        if (Array.isArray(adapterHints.slots)) {
            for (const slot of adapterHints.slots) {
                if (!slot?.id || !slot.control || !node.contains(slot.control)) continue;
                slots.push({id:String(slot.id), text:text(slot.text), control:slot.control,
                    evidence:['adapter-slot-reference'], type:slot.type || question.type});
            }
        } else if (['blank','essay'].includes(question.type)) {
            const labels = [...node.querySelectorAll('label[for]')];
            const idCounts = new Map();
            for (const element of node.ownerDocument.querySelectorAll('[id]')) idCounts.set(element.id, (idCounts.get(element.id) || 0) + 1);
            for (const label of labels) {
                const targets = (binding.inputs || []).filter(input => input.id && input.id === label.htmlFor);
                if (targets.length !== 1 || !text(label.textContent)) continue;
                const control = targets[0];
                if (label.control !== control || idCounts.get(control.id) !== 1 || typeof courseElementVisible === 'function' && !courseElementVisible(label)) continue;
                if (labels.filter(other => other.htmlFor === control.id).length !== 1 || slots.some(slot => slot.control === control)) continue;
                slots.push({id:`label-${slots.length + 1}`, text:text(label.textContent), control, evidence:['native-label-reference'], type:question.type});
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
        return {blocks, slots, subquestions, diagnostics:blocks.some(block => block.unreadable) ? ['unreadable-content'] : []};
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
            binding.writer === 'chapter-choice' ? 'chapter-choice' : target.type === 'checkbox' ? 'checkbox' : 'radio',
            binding.canPrefill, {optionKey:key, groupId:`${question.id}:options`});
        for (const input of binding.inputs || []) add(input, input.tagName === 'TEXTAREA' ? 'textarea' : 'text',
            ['blank','essay'].includes(question.type) && !question.controls?.richText);
        for (const target of node.querySelectorAll('select,input[type="file"],[contenteditable="true"],canvas')) {
            if (target.closest(MEDIA_EXCLUDED) || typeof courseElementVisible === 'function' && !courseElementVisible(target)) continue;
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
        if (['single','multiple','judge'].includes(question.type)) {
            const targets = all.filter(control => control.optionKey);
            const confirmed = binding.canPrefill && targets.length === question.options.length && targets.every(control => control.writable);
            unit(question.id, question.type, targets.map(control => control.id), confirmed ? 'confirmed' : 'unsupported',
                confirmed ? ['adapter-option-key','isolated-option-group'] : ['unverified-option-group']);
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
            for (const control of all.filter(control => ['select','upload','richtext','canvas'].includes(control.kind)))
                unit(`${question.id}::unsupported:${control.id.split(':').at(-1)}`, 'unknown', [control.id], 'unsupported', ['no-safe-writer']);
        }
        return {responseUnits, relations};
    }
    function parseQuestionGraph(doc = document, parseContext = {}) {
        const legacy = parseQuestionDocument(doc, parseContext), controls = [], relations = [], materials = [], bindings = new Map(legacy.bindings);
        const questions = legacy.questions.map(original => {
            const binding = legacy.bindings.get(original.id), context = {question:original, binding, doc, parseContext};
            const content = parseQuestionContent(binding.node, context, binding.adapterHints || {});
            const parsedControls = parseQuestionControls(binding.node, context, binding.adapterHints || {});
            const matched = matchQuestionRelations(content, parsedControls, context);
            controls.push(...parsedControls.controls); relations.push(...matched.relations);
            const composite = matched.responseUnits.length > 1;
            const question = {...original, structure:composite ? 'composite' : 'simple', blocks:content.blocks,
                responseUnits:matched.responseUnits, sharedMaterialIds:[], diagnostics:[...original.diagnostics, ...content.diagnostics]};
            const instruction = binding.group?.querySelector(':scope > .question-instructions');
            if (instruction && questionContentText(instruction)) {
                const id = `${original.groupId}:material`;
                if (!materials.some(material => material.id === id)) materials.push({id, type:'shared-context', text:questionContentText(instruction)});
                question.sharedMaterialIds.push(id);
            }
            for (const unit of matched.responseUnits) {
                if (!composite || unit.id === original.id) continue;
                const nodes = unit.controlIds.map(id => parsedControls.runtime.get(id)).filter(Boolean);
                bindings.set(unit.id, {...binding, inputs:nodes, optionTargets:new Map(), writer:'none', type:unit.type,
                    canPrefill:unit.relationStatus === 'confirmed'});
            }
            const confirmed = matched.responseUnits.filter(unit => unit.relationStatus === 'confirmed').length;
            question.supportLevel = original.answerPolicy.status === 'manual' && original.answerPolicy.category !== 'controls' ? 'Manual Required'
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
