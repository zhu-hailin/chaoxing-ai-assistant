    // 题目结果、原图、逐题操作与复制展示。
    const QUESTION_TYPE_LABELS = { single: '单选题', multiple: '多选题', judge: '判断题', blank: '填空题', essay: '简答题', unknown: '未识别题型' };

    function readableAnswer(question, entry) {
        if (!entry?.answer?.length) return '暂无有效答案，请人工核对';
        return entry.answer.map(key => {
            if (['blank','essay'].includes(question.type)) return key;
            const option = question.options.find(item => item.key === key);
            if (question.type === 'judge') return option?.text || ({ true: '正确', false: '错误' }[key] || key);
            return option ? `${key}. ${option.text || (option.imageIds?.length ? '图片选项' : '')}` : key;
        }).join('；');
    }

    function validResultSources(data, question) {
        return (data.evidence?.[question.id] || []).filter(item => /^https?:\/\//i.test(item.url || ''));
    }

    function questionResultStatuses(data,question,entry) {
        const policy=entry?.answerPolicy || data.answerPolicies?.[question.id] || question.answerPolicy || questionLocalAnswerPolicy(question);
        const skipped=data.skippedQuestions?.find(item=>item.id===question.id);
        const unitIds=question.responseUnits?.length?question.responseUnits.map(unit=>unit.id):[question.id];
        const states=unitIds.map(id=>data.analysisStates?.[id]).filter(Boolean);
        const state=['running','preparing','retry-wait','pending','ready','failed','cancelled','skipped','success'].map(status=>states.find(item=>item.status===status)).find(Boolean);
        const stateLabel=state && ({pending:'等待中',preparing:'准备材料',ready:'等待分析',running:'分析中','retry-wait':'重试等待中',success:'分析成功',failed:'分析失败',skipped:'已跳过',cancelled:'已取消'}[state.status]
            +(['failed','cancelled'].includes(state.status)&&state.error?`：${state.error}${state.code?`（${state.code}）`:''}`:''));
        const analysis=stateLabel || (entry?.answer?.length ? '已生成答案与解析'
            : skipped ? skipped.reason : ['manual','uncertain'].includes(policy.status) ? policy.reason
            : data.analysisProgress && !['complete','stopped','failed','stale'].includes(data.analysisProgress.status) ? '等待或正在分析'
            : '');
        const written=data.prefill?.perQuestion?.find(item=>item.questionId===question.id);
        const prefillPolicy=questionPrefillPolicy(question,entry || {answerPolicy:policy});
        const ueditorIssue=question.diagnostics?.find(reason=>reason.startsWith('UEditor：'));
        const restriction=questionManualPrefillPolicy(question)||(['manual','uncertain'].includes(policy.status)?policy:null);
        const ueditorReason=ueditorIssue?[...new Set([restriction?.reason,ueditorIssue].filter(Boolean))].join('；'):'';
        const prefill=written ? ({filled:'已填写',already:'已有相同答案',unverified:'写入状态待核对',skipped:written.reason || prefillPolicy.reason || '已跳过，请手动填写'}[written.status] || '请核对写入状态')
            : !entry?.answer?.length&&!['manual','uncertain'].includes(policy.status) ? ''
            : question.capabilities?.prefill===false ? ueditorReason
            : ['manual','uncertain'].includes(prefillPolicy.status) ? prefillPolicy.reason
            : question.supportLevel==='Partial Support' ? '仅支持已确认的作答区域' : entry?.answer?.length ? '可预填，等待操作' : '等待分析结果';
        return {analysis,prefill};
    }
    function resultImageCaption(image, question) {
        if (image.location === 'shared' || question?.contextImageIds?.includes(image.id) || image.sourceMaterialId && image.sourceQuestionNumber == null) return '共用材料';
        const number = image.sourceQuestionNumber ?? question?.number;
        return `${number == null ? '题目' : `来自第 ${number} 题`}${image.optionKey ? ' · 选项 ' + image.optionKey : ' · 题干图片'}`;
    }
    function resultImageSource(data, descriptor) {
        const preview = data.mediaPreviews?.[descriptor.id];
        if (['svg','canvas'].includes(descriptor.kind) && typeof preview === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(preview)) return preview;
        return mediaAddressAllowed(descriptor.src, panelView.sourceDoc) ? descriptor.src : null;
    }
    function resultQuestionIncomplete(data, question, entry) {
        const ids = question.responseUnits?.length ? question.responseUnits.map(unit => unit.id) : [question.id];
        return !entry?.answer?.length || ids.some(id => data.analysisStates?.[id] && data.analysisStates[id].status !== 'success');
    }
    function closeResultImage() {
        const dialog = panelView?.shadow.getElementById('result-image-dialog');
        if (dialog?.open) dialog.close();
    }
    function initResultControls(ctl) {
        if (!panelView || panelView.resultControlsInitialized) return;
        panelView.resultControlsInitialized = true;
        const { shadow } = panelView, output = shadow.getElementById('output');
        const rerender = () => { if (panelView.resultView?.data) renderResultList(panelView.resultView.data); };
        shadow.getElementById('result-filter').onchange = event => {
            if (!panelView.resultView) return;
            panelView.resultView.filter = event.target.value === 'incomplete' ? 'incomplete' : 'all';
            panelView.resultView.seekTop = true; rerender();
        };
        const jump = () => {
            const view = panelView.resultView, value = shadow.getElementById('result-jump-number').value.trim();
            if (!view?.data || !/^\d+$/.test(value)) return;
            const question = view.data.questions.find(item => String(item.number) === String(Number(value)));
            if (!question) { ctl.report('没有找到该题号'); return; }
            view.filter = 'all'; rerender();
            const card = view.cards.get(question.id)?.card;
            if (card) {
                output.scrollTop += card.getBoundingClientRect().top - output.getBoundingClientRect().top - 10;
                card.focus({ preventScroll: true });
            }
        };
        shadow.getElementById('result-jump').onclick = jump;
        shadow.getElementById('result-jump-number').onkeydown = event => {
            if (event.key === 'Enter') { event.preventDefault(); jump(); }
        };
        panelView.resultControlClick = async event => {
            const button = event.currentTarget;
            if (!button || button.disabled || !trustedAssistantActivation(event, button)) return;
            const data = panelView.resultView?.data;
            const question = data?.questions.find(item => String(item.id) === button.dataset.questionId);
            if (!question) return;
            if (button.dataset.resultAction === 'copy') {
                const text = formatResultText({ ...data, questions: [question], analysisProgress: null, prefill: null });
                try { await navigator.clipboard.writeText(text); ctl.report(`第 ${question.number} 题已复制`); }
                catch {
                    const card = button.closest('.question-card'), doc = output.ownerDocument, range = doc.createRange();
                    range.selectNodeContents(card);
                    const selection = typeof shadow.getSelection === 'function' ? shadow.getSelection() : doc.getSelection();
                    selection?.removeAllRanges(); selection?.addRange(range); ctl.report('请按 Ctrl+C 复制本题');
                }
            } else if (button.dataset.resultAction === 'image') {
                const descriptor = data.media?.find(item => item.id === button.dataset.imageId);
                if (!descriptor || !questionImageIds(question).includes(descriptor.id)) return;
                const src = resultImageSource(data, descriptor); if (!src) return;
                const dialog = shadow.getElementById('result-image-dialog'), image = shadow.getElementById('result-image-original');
                shadow.getElementById('result-image-caption').textContent = resultImageCaption(descriptor, question);
                image.src = src; image.alt = descriptor.alt || resultImageCaption(descriptor, question);
                panelView.resultImageReturn = button;
                if (!dialog.open) dialog.showModal();
                shadow.getElementById('result-image-close').focus();
            } else if (['retry', 'retry-current'].includes(button.dataset.resultAction)) {
                if (ctl.state.busy || courseRunActive() || !ctl.task?.snapshot?.questions.includes(question)) return;
                const ids = (question.responseUnits?.length ? question.responseUnits.map(unit => unit.id) : [question.id])
                    .filter(id => ['failed', 'cancelled'].includes(data.analysisStates?.[id]?.status));
                if (ids.length) resumeAnalysisTask(new Set(ids), { useCurrentSettings: button.dataset.resultAction === 'retry-current' });
            }
        };
        for (const button of output.querySelectorAll('button[data-result-action]')) button.onclick = panelView.resultControlClick;
        const dialog = shadow.getElementById('result-image-dialog');
        shadow.getElementById('result-image-close').onclick = closeResultImage;
        dialog.addEventListener('keydown', event => { if (event.key === 'Escape') event.stopPropagation(); });
        dialog.addEventListener('click', event => { if (event.target === dialog) closeResultImage(); });
        dialog.addEventListener('close', () => {
            shadow.getElementById('result-image-original').removeAttribute('src');
            const target = panelView.resultImageReturn; panelView.resultImageReturn = null;
            if (panelView.windowMode === 'open') (target?.isConnected && target.getClientRects().length ? target : output).focus({ preventScroll: true });
        });
    }
    function formatResultText(data) {
        if (!data?.questions?.length) return '';
        const answers = new Map((data.questionAnswers || data.answers || []).map(entry => [entry.id, entry]));
        const lines = [`题目列表（共 ${data.questions.length} 题）`];
        const appendImages = (ids, question) => {
            for (const id of ids) {
                const image = data.media?.find(item => item.id === id);
                if (!image) continue;
                lines.push(`图片：${resultImageCaption(image, question)}`);
                const analysis = data.mediaAnalysis?.find(item => item.imageIds.includes(id));
                if (analysis) {
                    if (analysis.summary) lines.push(analysis.summary);
                    if (analysis.columns.length) lines.push(analysis.columns.join(' | '));
                    for (const row of analysis.rows) lines.push(row.join(' | '));
                    for (const item of analysis.items) lines.push(`- ${item}`);
                }
            }
        };
        if (data.analysisProgress) lines.push(analysisProgressText(data.analysisProgress));
        if (data.prefill) lines.push(summaryText(data.prefill));
        for (const question of data.questions) {
            const entry = answers.get(question.id);
            lines.push('', `${question.number}. 【${(question.type === 'unknown' ? question.source?.typeLabel || '未识别题型' : QUESTION_TYPE_LABELS[question.type]) || '题目'}】${question.question.replace(/^【[^】]+】\s*/, '')}`);
            const optionImages = new Set();
            for (const option of question.options) {
                lines.push(`${option.key}. ${option.text}`);
                const ids = questionImageIds(question).filter(id => data.media?.some(image => image.id === id && image.location === 'option' && image.optionKey === option.key && image.sourceQuestionId === question.id));
                ids.forEach(id => optionImages.add(id));appendImages(ids, question);
            }
            appendImages(questionImageIds(question).filter(id => !optionImages.has(id)), question);
            const states=questionResultStatuses(data,question,entry);
            if(states.analysis)lines.push(`AI 分析：${states.analysis}`);
            if(states.prefill)lines.push(`自动预填：${states.prefill}`);
            if (entry?.answer?.length) {
                lines.push(`答案：${readableAnswer(question, entry)}`);
                if (entry.reason) lines.push(`解析：${entry.reason}`);
            }
            for (const source of validResultSources(data, question)) lines.push(`参考来源：${source.title || source.url} ${source.url}`);
        }
        return lines.join('\n');
    }

    function renderResultList(data) {
        const { shadow } = panelView, output = shadow.getElementById('output');
        const doc = output.ownerDocument;
        const hasAnswers = Array.isArray(data?.answers) && (data.analyzedCount ?? data.answers.length) > 0;
        const hasAnalysis = hasAnswers || Boolean(data?.analysisProgress && ['complete','failed','stopped'].includes(data.analysisProgress.status));
        output.setAttribute('aria-label', hasAnswers ? '题目与答案列表' : '题目列表');
        const node = (tag, className, text) => {
            const element = doc.createElement(tag);
            element.className = className;
            if (text !== undefined) element.textContent = text;
            return element;
        };
        const setText = (element, text) => { if (element.textContent !== text) element.textContent = text; };
        shadow.getElementById('solve').textContent = hasAnalysis ? '重新分析全部' : 'AI 分析';
        shadow.getElementById('solve').classList.toggle('secondary', hasAnalysis);
        shadow.getElementById('result-tools').hidden = !data?.questions?.length;
        if (!data?.questions?.length) {
            closeResultImage(); panelView.resultView = null;
            shadow.getElementById('result-filter').value = 'all';
            shadow.getElementById('result-jump-number').value = '';
            output.replaceChildren(node('p', 'result-empty', '提取后将在这里显示题目列表')); output.scrollTop = 0;
            return;
        }
        let view = panelView.resultView;
        if (!view) {
            view = { cards: new Map(), filter: 'all', summary: node('p', 'result-summary'), progress: node('p', 'note'), list: node('ol', 'question-list') };
            panelView.resultView = view; output.replaceChildren(view.summary, view.progress, view.list);
        }
        const previousTop = output.scrollTop, viewport = output.getBoundingClientRect();
        const anchor = output.clientHeight > 0 && [...view.cards.values()].find(item => !item.card.hidden && item.card.getBoundingClientRect().bottom > viewport.top);
        const anchorOffset = anchor ? anchor.card.getBoundingClientRect().top - viewport.top : null;
        view.data = data;
        const renderImages = (question, ids, mediaNodes) => {
            const images = node('ul', 'media-list');
            for (const id of ids) {
                const descriptor = data.media?.find(item => item.id === id);
                if (!descriptor) continue;
                const item = node('li', 'media-item');
                item.dataset.imageId = id;
                item.append(node('p', 'media-caption', resultImageCaption(descriptor, question)));
                const src = resultImageSource(data, descriptor);
                if (src) {
                    const image = node('img', 'question-image');
                    image.alt = descriptor.alt || resultImageCaption(descriptor, question);
                    image.loading = 'lazy'; image.src = src;
                    const open = node('button', 'question-image-open'); open.type = 'button';
                    Object.assign(open.dataset, { resultAction: 'image', questionId: question.id, imageId: id });
                    open.onclick = panelView.resultControlClick;
                    open.title = '查看原图'; open.setAttribute('aria-label', `${image.alt}，查看原图`); open.append(image);
                    image.addEventListener('error', () => open.replaceWith(node('p','note','图片预览加载失败，分析时将重新读取并校验')), { once:true });
                    item.append(open);
                } else item.append(node('p','note','图片地址缺失或暂不支持'));
                const details = node('div', 'image-analysis'); item.append(details); mediaNodes.push({ id, details, key: null });
                images.append(item);
            }
            return images.childElementCount ? images : null;
        };
        const answers = new Map((data.questionAnswers || data.answers || []).map(entry => [entry.id, entry]));
        setText(view.summary, `共 ${data.questions.length} 题${data.responseUnitCount && data.responseUnitCount!==data.questions.length ? ` · ${data.responseUnitCount} 个作答区域` : ''}`);
        setText(view.progress, data.analysisProgress ? analysisProgressText(data.analysisProgress) : ''); view.progress.hidden = !data.analysisProgress;
        const currentIds = new Set(data.questions.map(question => question.id));
        for (const [id, item] of view.cards) if (!currentIds.has(id)) { item.card.remove(); view.cards.delete(id); }
        let visible = 0;
        data.questions.forEach((question, index) => {
            const entry = answers.get(question.id);
            let item = view.cards.get(question.id);
            if (!item) {
                const card = node('li', 'question-card'); card.dataset.questionId = question.id; card.tabIndex = -1;
                item = { card, body: node('div','question-body'), statuses: node('div','question-statuses'), actions: node('div','question-card-actions'), materials: node('div','question-materials'), answer: node('div','question-result'), usage: node('details','request-usage'), mediaNodes: [] };
                item.usage.append(node('summary','', '请求详情'), node('p','request-usage-text'));
                card.append(item.body, item.statuses, item.actions, item.materials, item.answer, item.usage); view.cards.set(question.id, item);
            }
            const images = questionImageIds(question).map(id => {
                const image = data.media?.find(media => media.id === id);
                return image ? [image.id,image.src,image.alt,image.location,image.optionKey,image.sourceQuestionNumber,image.sourceMaterialId,data.mediaPreviews?.[id]] : [id];
            });
            const bodyKey = JSON.stringify([question.number,question.type,question.source?.typeLabel,question.question,question.options,question.contextImageIds,images]);
            if (item.bodyKey !== bodyKey) {
                item.bodyKey = bodyKey; item.mediaNodes = [];
                const heading = node('div', 'question-heading');
                heading.append(node('span', 'question-number', `第 ${question.number} 题`), node('span', 'question-type', (question.type === 'unknown' ? question.source?.typeLabel || '未识别题型' : QUESTION_TYPE_LABELS[question.type]) || '题目'));
                item.body.replaceChildren(heading, node('p', 'question-text', question.question.replace(/^【[^】]+】\s*/, '')));
                item.materials.replaceChildren();
                const optionImages = new Set();
                if (question.options.length) {
                    const options = node('ul', 'option-list');
                    for (const option of question.options) {
                        const optionNode = node('li','option-item'); optionNode.dataset.optionKey = option.key;
                        const content = node('div','option-content'); content.append(node('span','option-text',option.text));
                        const ids = questionImageIds(question).filter(id => data.media?.some(image => image.id === id && image.location === 'option' && image.optionKey === option.key && image.sourceQuestionId === question.id));
                        ids.forEach(id => optionImages.add(id));
                        const rendered = renderImages(question, ids, item.mediaNodes); if (rendered) content.append(rendered);
                        optionNode.append(node('span','option-key',question.type === 'judge' ? '·' : option.key),content); options.append(optionNode);
                    }
                    item.materials.append(options);
                }
                const rendered = renderImages(question, questionImageIds(question).filter(id => !optionImages.has(id)), item.mediaNodes);
                if (rendered) item.materials.append(rendered);
            }
            for (const media of item.mediaNodes) {
                const analysis = data.mediaAnalysis?.find(record => record.imageIds.includes(media.id));
                const key = JSON.stringify(analysis || null); if (media.key === key) continue;
                media.key = key; const fragment = doc.createDocumentFragment();
                if (analysis) {
                    if (analysis.summary) fragment.append(node('p','image-summary',analysis.summary));
                    if (analysis.columns.length && analysis.rows.length) {
                        const wrap = node('div','image-table-wrap'), table = node('table','image-table'), heading = node('tr','');
                        for (const text of analysis.columns) heading.append(node('th','',text));
                        const thead = node('thead',''); thead.append(heading); table.append(thead);
                        const tbody = node('tbody','');
                        for (const values of analysis.rows) { const tr = node('tr',''); for (const text of values) tr.append(node('td','',text)); tbody.append(tr); }
                        table.append(tbody); wrap.append(table); fragment.append(wrap);
                    }
                    if (analysis.items.length) { const list = node('ul','image-details'); for (const text of analysis.items) list.append(node('li','',text)); fragment.append(list); }
                }
                media.details.replaceChildren(fragment);
            }
            const states = questionResultStatuses(data,question,entry), skipped = data.skippedQuestions?.find(record => record.id === question.id);
            const statusText = [states.analysis && `AI 分析：${states.analysis}`,states.prefill && `自动预填：${states.prefill}`,
                question.capabilities?.analyze===false && question.diagnostics?.length ? question.diagnostics.join('；') : '',skipped?.reason].filter(Boolean);
            const statusKey = JSON.stringify(statusText);
            if (item.statusKey !== statusKey) { item.statusKey = statusKey; item.statuses.replaceChildren(...statusText.map(text => node('p','note',text))); }
            const canRetry = Boolean((question.responseUnits?.length ? question.responseUnits.map(unit => unit.id) : [question.id])
                .some(id => ['failed','cancelled'].includes(data.analysisStates?.[id]?.status)) && controller?.task?.snapshot?.questions.includes(question));
            const retryCurrent=Boolean(controller?.task?.configurationChanged);
            if (item.canRetry !== canRetry || item.retryCurrent!==retryCurrent) {
                item.canRetry = canRetry;item.retryCurrent=retryCurrent;
                const actions = [['copy','复制本题'],...(canRetry ? [controller?.task?.configurationChanged?['retry-current','用当前设置重试']:['retry','重试本题']] : [])];
                item.actions.replaceChildren(...actions.map(([action,label]) => {
                    const button = node('button','secondary',label); button.type = 'button';
                    Object.assign(button.dataset,{resultAction:action,questionId:question.id});
                    button.onclick = panelView.resultControlClick;
                    if (action.startsWith('retry')) button.dataset.analysisRetry = 'true'; return button;
                }));
            }
            for (const button of item.actions.querySelectorAll('[data-analysis-retry]')) setAssistantControlDisabled(button,controller?.state.busy || courseRunActive(),'当前任务运行中，请结束后重试本题');
            for (const option of item.materials.querySelectorAll('.option-item')) option.classList.toggle('is-answer', Boolean(entry?.answer?.includes(option.dataset.optionKey)));
            const answerKey = JSON.stringify([entry || null,validResultSources(data,question)]);
            if (item.answerKey !== answerKey) {
                item.answerKey = answerKey; const fragment = doc.createDocumentFragment();
                if (entry?.answer?.length) { fragment.append(node('p','ai-answer',readableAnswer(question,entry))); if (entry.reason) fragment.append(node('p','answer-reason',`解析：${entry.reason}`)); }
                const sources = node('div', 'answer-sources');
                for (const source of validResultSources(data, question)) {
                    const link = node('a', '', source.title || '参考来源');
                    link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
                    sources.append(link);
                }
                if (sources.childElementCount) fragment.append(sources); item.answer.replaceChildren(fragment);
            }
            const ids = question.responseUnits?.length ? question.responseUnits.map(unit => unit.id) : [question.id];
            const usage = ids.map(id => data.requestUsageByQuestion?.[id]).filter(Boolean);
            const usageText = usage.map((record,unit) => [usage.length > 1 ? `作答区域 ${unit+1}` : '',record.model && `模型 ${record.model}`,
                record.attempts > 0 ? `请求 ${record.attempts} 次` : '',
                ...[['promptTokens','返回输入'],['completionTokens','返回输出'],['reasoningTokens','返回推理'],['totalTokens','返回合计']].map(([key,label]) => Number.isFinite(record[key]) ? `${label} ${record[key]} tokens` : '')].filter(Boolean).join(' · ')).filter(Boolean).join('\n');
            item.usage.hidden = !usageText; setText(item.usage.lastElementChild, usageText);
            item.card.hidden = view.filter === 'incomplete' && !resultQuestionIncomplete(data,question,entry);
            if (!item.card.hidden) visible++;
            if (view.list.children[index] !== item.card) view.list.insertBefore(item.card,view.list.children[index] || null);
        });
        shadow.getElementById('result-filter').value = view.filter;
        setText(shadow.getElementById('result-visible-count'), `显示 ${visible}/${data.questions.length} 题`);
        shadow.getElementById('result-jump-number').max = Math.max(...data.questions.map(question => Number(question.number) || 0));
        if (view.seekTop) { output.scrollTop = 0; view.seekTop = false; }
        else if (anchor && !anchor.card.hidden && anchor.card.isConnected) output.scrollTop += anchor.card.getBoundingClientRect().top - output.getBoundingClientRect().top - anchorOffset;
        else output.scrollTop = previousTop;
    }

