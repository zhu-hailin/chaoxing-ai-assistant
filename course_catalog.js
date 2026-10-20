    // 课程目录只读取页面已有 DOM；点击委托给原章节节点，不构造提交请求。
    const COURSE_CATALOG_SELECTOR = '#content1 #coursetree';
    const COURSE_SCORE_PREFIX = 'cx_quiz_scores:';

    function pageURL(doc) {
        try {
            const href = doc.defaultView.location.href;
            return new URL(/^about:/.test(href) ? doc.baseURI : href);
        } catch { return null; }
    }

    function resolveCourseCatalog(doc = document) {
        let view = doc.defaultView;
        const seen = new Set();
        for (let depth = 0; view && depth < 12 && !seen.has(view); depth++) {
            seen.add(view);
            try {
                const sourceDoc = view.document;
                const root = sourceDoc.querySelector(COURSE_CATALOG_SELECTOR);
                if (root) return { sourceDoc, root };
            } catch { /* 跨域祖先不可读时继续检查更上层，不绕过浏览器同源规则。 */ }
            try { if (view.parent === view) break; view = view.parent; }
            catch { break; }
        }
        return null;
    }

    function readQuizScore(doc = document) {
        const status = clean(doc.querySelector('#RightCon .testTit_status')?.textContent);
        if (status !== '已完成') return null;
        const text = clean(doc.querySelector('#RightCon .ceyan_name .Finalresult i')?.textContent);
        if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
        const score = Number(text);
        if (!Number.isFinite(score)) return null;
        const params = pageURL(doc)?.searchParams;
        const chapterId = params?.get('knowledgeid') || params?.get('chapterId');
        const quizId = params?.get('workId');
        return { score, chapterId, quizId, title: clean(doc.querySelector('#RightCon .ceyan_name h3')?.textContent) };
    }

    function courseURLContext(url) {
        let conflict = false;
        const read = names => {
            const values = new Set([...(url?.searchParams || [])].filter(([key]) => names.includes(key.toLowerCase())).map(([,value]) => value.trim()).filter(Boolean));
            if (values.size > 1) conflict = true;
            return values.size === 1 ? [...values][0] : '';
        };
        const course = read(['courseid']), classroom = read(['clazzid','classid']), student = read(['cpi']);
        const chapterId = read(['chapterid','knowledgeid']);
        return {course,classroom,student,chapterId,conflict};
    }
    function courseStudyContext(sourceDoc) {
        const base = pageURL(sourceDoc), top = courseURLContext(base);
        let frame = null, declared = null, loaded = null;
        const view = sourceDoc?.defaultView;
        // Only the real top-level course frame may supply missing identity fields.
        if (view && view === view.top && isCourseStudyURL(base)) frame = sourceDoc.querySelector('#mainid #iframe');
        const cards = raw => {
            if (!raw) return null;
            try {
                const url = new URL(raw,base);
                return url.origin === base.origin && !url.username && !url.password && url.pathname === '/mooc-ans/knowledge/cards'
                    ? {...courseURLContext(url),url} : null;
            } catch { return null; }
        };
        if (frame) {
            declared = cards(frame.getAttribute('src'));
            try { loaded = cards(frame.contentDocument?.URL); } catch { /* Cross-origin content never supplies identity. */ }
        }
        const {course,classroom} = top;
        let student = top.student, reason = top.conflict ? 'parameter-conflict' : '';
        for (const candidate of [declared,loaded].filter(Boolean)) {
            if (candidate.conflict) reason = 'parameter-conflict';
            if (course && candidate.course && course !== candidate.course || classroom && candidate.classroom && classroom !== candidate.classroom
                || student && candidate.student && student !== candidate.student) reason = 'identity-conflict';
            // A cpi is usable only after both course and class agree with the top page.
            if (course && classroom && candidate.course === course && candidate.classroom === classroom && candidate.student && !student) student = candidate.student;
        }
        const complete = Boolean(!reason && course && classroom && student);
        if (!reason && !complete) reason = 'identity-incomplete';
        // The loaded cards URL proves the current chapter; clicking a link or its colour does not.
        const chapterId = complete && loaded && loaded.course === course && loaded.classroom === classroom && loaded.chapterId
            && (!declared?.chapterId || declared.chapterId === loaded.chapterId) ? loaded.chapterId : null;
        return {course,classroom,student,complete,reason,chapterId,frame,cardsURL:declared?.url || null,loadedCardsURL:loaded?.url || null};
    }
    function courseScoreKey(sourceDoc) {
        const context = courseStudyContext(sourceDoc);
        // Keep course, class and account isolation; incomplete/conflicting identities never persist.
        return context.complete ? COURSE_SCORE_PREFIX + [context.course,context.classroom,context.student].map(encodeURIComponent).join(':') : null;
    }

    function courseCatalogMarker(row, selector) {
        // 目录折叠不改变完成状态；只忽略行内部隐藏的状态模板。
        return [...row.querySelectorAll(selector)].find(node=>{
            for(let current=node;current && current!==row;current=current.parentElement) {
                if(current.hidden || current.getAttribute('aria-hidden')==='true')return false;
                const style=current.ownerDocument.defaultView.getComputedStyle(current);
                if(style.display==='none'||style.visibility==='hidden')return false;
            }
            return true;
        });
    }
    function readCourseCatalog(doc = document) {
        const context = resolveCourseCatalog(doc);
        if (!context) return null;
        const { sourceDoc, root } = context;
        const entries = [];
        const seenIds = new Set();
        let structure = 'pos-catalog';
        for (const row of root.querySelectorAll('.posCatalog_select')) {
            const target = row.querySelector(':scope > .posCatalog_name');
            const label = target || row.querySelector(':scope > .posCatalog_title');
            if (!label || !row.id || seenIds.has(row.id)) continue;
            const number = clean(label.querySelector('.posCatalog_sbar')?.textContent);
            const title = clean(label.getAttribute('title')) || clean([...label.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' '));
            if (!title) continue;
            seenIds.add(row.id);
            const parentLi = row.closest('li')?.parentElement?.closest('li');
            const parentId = parentLi?.querySelector(':scope > .posCatalog_select')?.id || null;
            const pendingText = clean(courseCatalogMarker(row,'.orangeNew')?.textContent);
            const pending = /^\d+$/.test(pendingText) ? Number(pendingText) : null;
            const completed = Boolean(courseCatalogMarker(row,'.icon_Completed'));
            entries.push({ id: row.id, chapterId: row.id.replace(/^cur/, ''), number, title, parentId,
                isGroup: !target, target, active: row.classList.contains('posCatalog_active'),
                completed, pending, scores: [] });
        }
        if (!entries.length) {
            // Confirmed legacy layout: no li ancestry or colour-to-status mapping is known.
            structure = 'legacy-h4';
            const currentChapterId = courseStudyContext(sourceDoc).chapterId;
            const switchesChapter = node => /^\s*(?:return\s+)?(?:window\.)?getTeacherAjax\s*\(/.test(node.getAttribute('onclick') || '')
                || /^\s*javascript:\s*(?:return\s+)?(?:window\.)?getTeacherAjax\s*\(/.test(node.getAttribute('href') || '');
            for (const row of root.querySelectorAll('h4[id^="cur"]')) {
                if (row.id.length <= 3 || seenIds.has(row.id)) continue;
                const links = [...row.querySelectorAll('a[title]')].filter(link => link.closest('h4[id^="cur"]') === row);
                if (links.length !== 1) continue;
                const link = links[0], title = clean(link.getAttribute('title'));
                if (!title) continue;
                const number = clean(row.querySelector('.hideChapterNumber')?.textContent);
                // Delegate to the original link/row handler; never evaluate its arguments ourselves.
                const target = switchesChapter(link) || switchesChapter(row) ? link : null;
                seenIds.add(row.id);
                entries.push({ id:row.id, chapterId:row.id.replace(/^cur/, ''), number, title,
                    parentId:null, hierarchyKnown:false, isGroup:false, target,
                    active:currentChapterId ? row.id.replace(/^cur/, '') === currentChapterId : null, completed:null, pending:null, scores:[] });
            }
        }
        const scopeKey = courseScoreKey(sourceDoc);
        const stored = scopeKey ? get(scopeKey, {}) : {};
        const scores = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
        const observed = readQuizScore(doc);
        if (scopeKey && observed?.chapterId && observed.quizId && entries.some(e => e.chapterId === observed.chapterId)) {
            const chapter = scores[observed.chapterId] || {};
            const old = chapter[observed.quizId];
            if (old?.score !== observed.score || old?.title !== observed.title) {
                const updated = { ...scores, [observed.chapterId]: { ...chapter,
                    [observed.quizId]: { score: observed.score, title: observed.title, updatedAt: Date.now() } } };
                set(scopeKey, updated);
                Object.assign(scores, updated);
            }
        }
        for (const entry of entries) {
            entry.scores = Object.values(scores[entry.chapterId] || {}).filter(item => item && Number.isFinite(item.score) && item.score >= 0);
        }
        // An existing container with unknown rows is not an empty/completed course.
        return { ...context, entries, scopeKey, structure: entries.length ? structure : 'unrecognized' };
    }

    function catalogStatus(entry) {
        if (entry.completed) return '已完成';
        if (entry.pending > 0) return `待完成 · ${entry.pending}项`;
        if (entry.pending === 0) return '无任务点';
        return '状态未提供';
    }

    function renderCourseCatalog() {
        if (!panelView?.catalog) return;
        const { shadow, catalog } = panelView;
        const list = shadow.getElementById('catalog-list');
        const doc = list.ownerDocument;
        const entries = catalog.context?.entries || [];
        const query = clean(shadow.getElementById('catalog-search').value).toLocaleLowerCase();
        const byId = new Map(entries.map(entry => [entry.id, entry]));
        const included = new Set();
        for (const entry of entries) {
            if (!query || `${entry.number} ${entry.title}`.toLocaleLowerCase().includes(query)) {
                included.add(entry.id);
                for (let parent = byId.get(entry.parentId); parent && !included.has(parent.id); parent = byId.get(parent.parentId)) included.add(parent.id);
                // 搜索到一个目录分组时保留其子目录。
                if (entry.isGroup && query) {
                    for (const child of entries) {
                        for (let p = byId.get(child.parentId); p; p = byId.get(p.parentId)) {
                            if (p.id === entry.id) { included.add(child.id); break; }
                        }
                    }
                }
            }
        }
        const children = new Map();
        for (const entry of entries.filter(entry => included.has(entry.id))) {
            const parent = byId.has(entry.parentId) ? entry.parentId : null;
            if (!children.has(parent)) children.set(parent, []);
            children.get(parent).push(entry);
        }
        const make = (tag, className, text) => {
            const element = doc.createElement(tag); element.className = className;
            if (text !== undefined) element.textContent = text;
            return element;
        };
        const appendEntries = (parentId, container) => {
            for (const entry of children.get(parentId) || []) {
                const item = make('li', 'catalog-item'); item.dataset.chapterId = entry.id;
                const row = make('div', `catalog-row${entry.active ? ' is-active' : ''}${entry.isGroup ? ' is-group' : ''}`);
                const nested = children.get(entry.id) || [];
                const expanded = Boolean(query) || !catalog.collapsed.has(entry.id);
                if (nested.length) {
                    const fold = make('button', 'catalog-fold', expanded ? '▾' : '▸'); fold.type = 'button';
                    fold.setAttribute('aria-label', `${expanded ? '收起' : '展开'} ${entry.title}`);
                    fold.setAttribute('aria-expanded', String(expanded));
                    fold.onclick = () => {
                        if (catalog.collapsed.has(entry.id)) catalog.collapsed.delete(entry.id); else catalog.collapsed.add(entry.id);
                        renderCourseCatalog();
                    };
                    row.append(fold);
                } else row.append(make('span', 'catalog-fold-space'));
                const button = make('button', 'catalog-link'); button.type = 'button';
                if (!entry.isGroup) { button.dataset.chapterButton = entry.id; button.disabled = !entry.target || controller.state.busy || courseRunActive(); }
                if (entry.active) button.setAttribute('aria-current', 'page');
                button.append(make('span', 'catalog-title', `${entry.number} ${entry.title}`.trim()));
                const meta = make('span', 'catalog-meta');
                if (entry.isGroup) {
                    const descendants = entries.filter(candidate => !candidate.isGroup && (() => {
                        for (let p = byId.get(candidate.parentId); p; p = byId.get(p.parentId)) if (p.id === entry.id) return true;
                        return false;
                    })());
                    if (descendants.length) meta.append(make('span', 'catalog-state', `${descendants.filter(e => e.completed).length}/${descendants.length} 已完成`));
                } else meta.append(make('span', `catalog-state${entry.completed ? ' is-complete' : ''}`, catalogStatus(entry)));
                for (const score of entry.scores) {
                    const badge = make('span', 'catalog-score', `测验 ${score.score} 分`);
                    badge.title = score.title || '已查看的测验成绩'; meta.append(badge);
                }
                button.append(meta);
                button.onclick = () => {
                    if (entry.isGroup) row.querySelector('.catalog-fold')?.click();
                    else navigateCourseChapter(entry.id);
                };
                row.append(button); item.append(row);
                if (nested.length) {
                    const sublist = make('ol', 'catalog-children'); sublist.hidden = !expanded;
                    appendEntries(entry.id, sublist); item.append(sublist);
                }
                container.append(item);
            }
        };
        const fragment = doc.createDocumentFragment();
        appendEntries(null, fragment);
        if (!fragment.childNodes.length) fragment.append(make('li', 'catalog-empty', entries.length ? '没有匹配的章节' : catalog.context ? '已找到目录容器，尚未识别章节；若加载后仍为空，请提供章节项 HTML 以适配。' : '未读取到课程目录，请在课程学习页面打开。'));
        list.replaceChildren(fragment);
        shadow.getElementById('catalog-status').textContent = entries.length ? catalog.context?.structure === 'legacy-h4'
            ? `共 ${entries.length} 个章节；旧版目录层级与完成状态未确认`
            : `共 ${entries.filter(e => e.isGroup).length} 个目录分组，${entries.filter(e => !e.isGroup).length} 个章节` : '';
    }

    function navigateCourseChapter(id) {
        if (controller.state.busy || courseRunActive()) return controller.report('请等待本次操作完成后切换章节');
        const entry = readCourseCatalog()?.entries.find(item => item.id === id);
        if (!entry?.target?.isConnected) return controller.report('章节入口已变化，请刷新课程目录');
        if (entry.active) return controller.report(`当前章节：${entry.title}`);
        controller.last = null; controller.clearOutput();
        controller.report(`正在切换至：${entry.title}`);
        entry.target.click();
    }

    function refreshCourseSidebar() {
        if (!panelView?.catalog) return;
        const catalog = panelView.catalog;
        catalog.context = readCourseCatalog(panelView.sourceDoc || panelView.host.ownerDocument);
        const source = catalog.context?.sourceDoc.querySelector('#content1');
        if (source !== catalog.observedRoot) {
            catalog.observer?.disconnect(); catalog.observedRoot = source;
            if (source) {
                catalog.observer = new MutationObserver(() => {
                    if (catalog.timer) return;
                    catalog.timer = setTimeout(() => { catalog.timer = null; refreshCourseSidebar(); }, 100);
                });
                catalog.observer.observe(source, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'title', 'id', 'onclick', 'href'], characterData: true });
            }
        }
        renderCourseCatalog();
    }

    function initCourseSidebar() {
        panelView.catalog = { context: null, collapsed: new Set(), observer: null, observedRoot: null, timer: null };
        const { shadow } = panelView;
        shadow.getElementById('catalog-search').oninput = renderCourseCatalog;
        shadow.getElementById('catalog-refresh').onclick = refreshCourseSidebar;
        refreshCourseSidebar();
        window.addEventListener('pagehide', () => {
            panelView?.catalog?.observer?.disconnect();
            clearTimeout(panelView?.catalog?.timer);
        }, { once: true });
    }
