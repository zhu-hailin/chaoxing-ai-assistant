    // Document/Node 身份只留在本页面；公开关联证据不含地址、内容或答案。
    const questionDocumentIds = new WeakMap();
    const questionSnapshotRuntime = new WeakMap();
    let questionDocumentSequence = 0, questionSnapshotSequence = 0;
    function questionDocumentId(doc) {
        if (!questionDocumentIds.has(doc)) questionDocumentIds.set(doc, `doc-${++questionDocumentSequence}`);
        return questionDocumentIds.get(doc);
    }
    function questionContextError(code, message, legacyCode) {
        if (typeof createCxError === 'function') return createCxError(code, { module:'question-context', operation:'validate-snapshot' }, {legacyCode});
        const error = new Error(message); error.code = legacyCode || code; error.cxCode = code; return error;
    }
    function collectDocumentContexts(owner = document, policy = {}) {
        const contexts = [], documents = [], inaccessible = [], byDocument = new Map(), visited = new Set();
        const maxDepth = Math.min(12, Math.max(0, policy.maxDepth ?? 12));
        const visit = (doc, frame, parentId, depth) => {
            if (!doc?.documentElement || visited.has(doc)) return;
            visited.add(doc);
            const context = {id:questionDocumentId(doc), document:doc, frame, parentId, depth};
            contexts.push(context); documents.push(doc); byDocument.set(doc, context);
            const frames = depth === 0 && policy.root ? [policy.root] : [...doc.querySelectorAll('iframe')];
            for (const child of frames) {
                if (typeof policy.includeFrame === 'function' && !policy.includeFrame(child)) continue;
                if (typeof courseAnswerEditorFrame === 'function' && courseAnswerEditorFrame(child)) continue;
                if (depth >= maxDepth) { inaccessible.push({frame:child, reason:'depth-limit'}); continue; }
                try {
                    const inner = child.contentDocument;
                    if (!inner?.documentElement) {
                        if (!(typeof courseRemoteReaderFrame === 'function' && courseRemoteReaderFrame(child))) inaccessible.push({frame:child, reason:'unreadable'});
                        continue;
                    }
                    visit(inner, child, context.id, depth + 1);
                } catch { inaccessible.push({frame:child, reason:'unreadable'}); }
            }
        };
        visit(owner, null, null, 0);
        return {owner, contexts, documents, inaccessible, byDocument};
    }
    function describeNodeRelation(container, node, contexts) {
        if (!container || !node || typeof container.contains !== 'function') return {status:'unknown', evidence:['missing-node']};
        if (container.nodeType !== 9 && !container.isConnected || node.nodeType !== 9 && !node.isConnected) return {status:'unknown', evidence:['detached-node']};
        const targetDoc = container.nodeType === 9 ? container : container.ownerDocument;
        const visited = new Set(), evidence = [];
        let candidate = node;
        for (let depth = 0; candidate && depth <= 12; depth++) {
            try {
                const doc = candidate.nodeType === 9 ? candidate : candidate.ownerDocument;
                if (!doc || visited.has(doc)) return {status:'unknown', evidence:[...evidence,'frame-cycle']};
                visited.add(doc);
                if (candidate === container || container.contains(candidate)) return {status:'inside', evidence:[...evidence, depth ? 'ancestor-frame-container' : 'same-document-container']};
                if (doc === targetDoc) return {status:'outside', evidence:[...evidence,'same-document-outside']};
                if (candidate.nodeType !== 9 && !candidate.isConnected) return {status:'unknown', evidence:[...evidence,'detached-node']};
                const frame = doc.defaultView?.frameElement;
                if (!frame) {
                    const view = doc.defaultView;
                    if (!view || view.parent !== view) return {status:'unknown', evidence:[...evidence,'unreadable-parent']};
                    return {status:'outside', evidence:[...evidence,'independent-document']};
                }
                if (!frame.isConnected || frame.contentDocument !== doc) return {status:'unknown', evidence:[...evidence,'stale-document']};
                if (contexts?.byDocument && !contexts.byDocument.has(doc)) return {status:'unknown', evidence:[...evidence,'outside-context-policy']};
                evidence.push('frame-element'); candidate = frame;
            } catch { return {status:'unknown', evidence:[...evidence,'unreadable-parent']}; }
        }
        return {status:'unknown', evidence:[...evidence,'depth-limit']};
    }
    function questionGraphContentSignature(graph) {
        // Descriptor state/selection and runtime bindings deliberately do not form content identity.
        const questions = graph.questions.map(question => ({
            id:question.id, type:question.type, question:question.question, instructions:question.instructions,
            options:question.options, blocks:question.blocks, responseUnits:question.responseUnits,
            sharedMaterialIds:question.sharedMaterialIds, answerPolicy:question.answerPolicy,
            capabilities:question.capabilities, structure:question.structure
        }));
        return JSON.stringify({questions, materials:graph.materials, media:graph.media, relations:graph.relations});
    }
    function questionBindingNodes(binding) {
        return [...new Set([binding.node, binding.stem, ...(binding.inputs || []),
            ...[...(binding.optionTargets || new Map()).values()], ...[...(binding.imageNodes || new Map()).values()],
            binding.matching?.savedInput,...(binding.matching?[binding.matching.block,...binding.matching.left.map(item=>item.node),...binding.matching.right.map(item=>item.node),...binding.matching.rows.flatMap(row=>[row.node,row.select,row.chosen,...row.options.map(option=>option.node)])]:[]),
            binding.mooc2?.savedInput,...(binding.mooc2?.records || []).flatMap(record=>[record.marker,record.content]),
            binding.chapterRows?.savedInput,...(binding.chapterRows?.records || []).flatMap(record=>[record.label,record.content,record.clear,record.marker]),
            ...(binding.choiceInputs || []),binding.choiceForm,
            ...(binding.ueditor?.valid?[binding.ueditor.input,binding.ueditor.form,binding.ueditor.container,binding.ueditor.iframe,binding.ueditor.body]:[])].filter(Boolean))];
    }
    function createQuestionSnapshot(graph, runtime = {}) {
        if (graph?.schemaVersion !== 3) throw questionContextError('CX-PAR-008', '题目快照结构不匹配');
        const doc = runtime.doc || [...graph.bindings.values()][0]?.node?.ownerDocument || document;
        const snapshotId = `snapshot-${++questionSnapshotSequence}`;
        const signature = questionGraphContentSignature(graph);
        const lifecycle = {snapshotId, documentId:questionDocumentId(doc), taskId:runtime.taskId || null,
            contentSignature:signature, bindingGeneration:snapshotId};
        graph.lifecycle = lifecycle;
        const snapshot = {schemaVersion:3, graph, doc, parseContext:runtime.parseContext || {}, questions:graph.questions,
            media:graph.media, bindings:graph.bindings, total:graph.questions.length, signature, lifecycle, snapshotId};
        const nodes = [...graph.bindings.values()].flatMap(questionBindingNodes);
        const documents = new Map();
        for (const node of nodes) {
            const nodeDoc = node.ownerDocument;
            if (!documents.has(nodeDoc)) {
                let frame = null; try { frame = nodeDoc.defaultView?.frameElement || null; } catch {}
                documents.set(nodeDoc, {body:nodeDoc.body, root:nodeDoc.documentElement, frame});
            }
        }
        questionSnapshotRuntime.set(snapshot, {graph, doc, nodes, documents, signature,
            signal:runtime.signal, checkCurrent:runtime.checkCurrent, parseContext:snapshot.parseContext, checking:false});
        // Allow an execution/request projection to retain .graph and the public snapshot lifetime.
        Object.defineProperty(snapshot, '_contextSnapshot', {value:snapshot});
        return snapshot;
    }
    function assertQuestionSnapshot(snapshot, requirements = {}) {
        const source = snapshot?.rootSnapshot || snapshot?._contextSnapshot || snapshot;
        const state = questionSnapshotRuntime.get(source);
        if (!state) throw questionContextError('CX-PAR-008', '题目快照已失效');
        if (state.checking) return true;
        state.checking = true;
        try {
            if (state.signal?.aborted || source.signal?.aborted || requirements.signal?.aborted) {
                if (typeof cancelledError === 'function') throw cancelledError();
                throw questionContextError('CX-EXE-005', '操作已取消', 'ABORTED');
            }
            for (const check of new Set([state.checkCurrent, source.checkCurrent, requirements.checkCurrent])) if (typeof check === 'function') check();
            if (requirements.taskId !== undefined && source.lifecycle.taskId !== requirements.taskId) throw questionContextError('CX-PAR-008', '任务已变化');
            for (const [doc, identity] of state.documents) {
                if (doc.body !== identity.body || doc.documentElement !== identity.root) throw questionContextError('CX-PAR-008', '页面已变化');
                if (identity.frame && (!identity.frame.isConnected || identity.frame.contentDocument !== doc)) throw questionContextError('CX-PAR-008', '页面已导航');
            }
            for (const node of state.nodes) if (!node.isConnected || !state.documents.has(node.ownerDocument)) throw questionContextError('CX-CTL-006', '作答控件已替换');
            const current = parseQuestionGraph(state.doc, state.parseContext);
            if (questionGraphContentSignature(current) !== state.signature) throw questionContextError('CX-PAR-008', '题干、选项或关联已变化');
            for (const [id, binding] of state.graph.bindings) {
                const live = current.bindings.get(id);
                if(!sameQuestionMatching(binding.matching,live?.matching))throw questionContextError('CX-CTL-006','连线题控件或原生关联已变化');
                if((binding.ueditor||live?.ueditor)&&!sameQuestionUEditor(binding.ueditor,live?.ueditor))
                    throw questionContextError('CX-CTL-006','UEditor 实例、题目或同步表单已变化');
                if ((binding.mooc2 || live?.mooc2) && !sameMooc2ChoiceBindings(binding.mooc2,live?.mooc2))
                    throw questionContextError('CX-CTL-006', 'mooc2 选项与原生保存标识已变化');
                if((binding.chapterRows||live?.chapterRows)&&!sameChapterRowChoiceBindings(binding.chapterRows,live?.chapterRows))
                    throw questionContextError('CX-CTL-006','旧版选项与原生处理函数已变化');
                if(binding.chapterEvidence!==live?.chapterEvidence)throw questionContextError('CX-CTL-006','章节选项的处理函数或原生控件标识已变化');
                const before = questionBindingNodes(binding), after = live ? questionBindingNodes(live) : [];
                if (before.length !== after.length || before.some((node, index) => node !== after[index])) throw questionContextError('CX-CTL-006', '作答控件已替换');
            }
            return true;
        } finally { state.checking = false; }
    }
