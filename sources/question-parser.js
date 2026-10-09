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
    function collectRawQuestions(doc = document) {
        const records = [], seen = new Set(), claimedAncestors = new Set();
        for (const adapter of questionPageAdapters) {
            const nodes = [...adapter.collect(doc)], candidates = new Set(nodes), containers = new Set();
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
        return records.map((record, index) => record.adapter.read(record.node, index));
    }
    function hasQuestionNodes(doc = document) { return collectRawQuestions(doc).length > 0; }
    function textInputs(node) {
        return [...node.querySelectorAll('textarea,input[type="text"],input:not([type])')]
            .filter(input => !input.closest('.cx-ai-ignore') && input.type !== 'password');
    }
    const STEM_SELECTOR = '.Zy_TItle .fontLabel,.Zy_TItle,.question-stem,.question-title,.mark_name,.stem,[data-question-text]';
    const MEDIA_EXCLUDED = 'dl,.mark_answer,.answer-content,.correct-answer,.teacher-comment,.editor-toolbar,.attachment,.cx-ai-ignore';
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
    function rawQuestion(node, index, adapter) {
        const stem = node.querySelector(STEM_SELECTOR);
        const group = node.closest('.mark_item');
        const id = questionId(node, index);
        const groupId = group ? `work-group-${[...node.ownerDocument.querySelectorAll('.mark_item')].indexOf(group) + 1}` : `question-group-${id}`;
        const typeLabel = readQuestionTypeLabel(node, stem, group);
        const question = stripQuestionPrefix(stem?.textContent, typeLabel);
        const legacy = [...node.querySelectorAll('.Zy_ulTop li')];
        const native = [...node.querySelectorAll('input[type="radio"],input[type="checkbox"]')];
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
        const inputs = textInputs(node);
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
        return { id, number:index + 1, adapter, groupId, question, typeLabel, options, controls, media, unboundOptionImages, binding: { node, inputs, optionTargets, imageNodes, writer } };
    }
    registerPageAdapter({
        id: 'chaoxing-chapter',
        collect: doc => [...doc.querySelectorAll('.singleQuesId')].filter(node => !node.closest('.fanyaMarking_left')),
        read: (node, index) => rawQuestion(node, index, 'chaoxing-chapter')
    });
    registerPageAdapter({
        id: 'chaoxing-homework',
        collect: doc => [...doc.querySelectorAll('.fanyaMarking_left .questionLi.singleQuesId,.TiMu,.question-item[data-question-id],[data-questionid]')].filter(node => node.querySelector(STEM_SELECTOR)),
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
            id: raw.id, number: raw.number, type, question: raw.question, options: raw.options,
            groupId:raw.groupId || `question-group-${raw.id}`, imageIds:ownMedia.map(item => item.id), contextImageIds:[],
            source: { adapter: raw.adapter, parser, typeLabel: raw.typeLabel, inferred },
            controls: raw.controls,
            capabilities: { analyze: Boolean(raw.question || ownMedia.length) && type !== 'unknown' && !raw.unboundOptionImages, prefill }, diagnostics
        };
        return { question, binding: { ...raw.binding, type, canPrefill: prefill } };
    }
    registerQuestionParser({ id: 'declared-type', match: raw => canonicalType(raw) !== 'unknown', parse: raw => finishQuestion(raw, canonicalType(raw), 'declared-type') });
    registerQuestionParser({
        id: 'native-choice',
        match: raw => !raw.typeLabel && (raw.controls.radios > 0 || raw.controls.checkboxes > 0) && !(raw.controls.radios && raw.controls.checkboxes),
        parse: raw => finishQuestion(raw, raw.controls.checkboxes ? 'multiple' : 'single', 'native-choice', true)
    });
    registerQuestionParser({ id: 'unknown', match: () => true, parse: raw => finishQuestion(raw, 'unknown', 'unknown') });
    function parseQuestionDocument(doc = document) {
        const raw = collectRawQuestions(doc);
        if (!raw.length) throw new Error('没有检测到题目，请先进入章节测验或作业');
        const questions = [], media = [], bindings = new Map();
        for (const record of raw) {
            const parser = questionTypeParsers.find(item => item.id !== 'unknown' && item.match(record)) || questionTypeParsers.find(item => item.id === 'unknown');
            const parsed = parser.parse(record);
            if (bindings.has(parsed.question.id)) throw new Error('题目 ID 重复，已停止');
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
        return { schemaVersion: 2, questions, media, bindings };
    }
