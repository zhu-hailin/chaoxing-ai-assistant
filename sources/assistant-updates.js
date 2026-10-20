    const ASSISTANT_UPDATE_KEY = 'cx_assistant_update';
    const ASSISTANT_UPDATE_SOURCE = 'https://api.github.com/repos/zhu-hailin/chaoxing-ai-assistant/releases/latest';
    const ASSISTANT_UPDATE_CACHE_SOURCE = 'github-release-v1';
    const assistantUpdateOpen = window.open.bind(window);
    let assistantUpdatePending = null, assistantUpdateAbort = null;
    let assistantUpdateStartup = null, assistantUpdateStarted = false;
    let assistantUpdateListener = null, assistantUpdateGeneration = 0, assistantUpdateMessage = '';

    function assistantVersionParts(value) {
        const match = /^v?(\d{1,4})\.(\d{2})$/.exec(String(value ?? ''));
        return match ? [Number(match[1]), Number(match[2])] : null;
    }
    function assistantVersionIsNewer(value) {
        const a = assistantVersionParts(value), b = assistantVersionParts(ASSISTANT_VERSION);
        return Boolean(a && b && (a[0] > b[0] || a[0] === b[0] && a[1] > b[1]));
    }
    function assistantUpdateCache() {
        const value = get(ASSISTANT_UPDATE_KEY, {}), now = Date.now();
        const timestamp = raw => Number.isFinite(raw) && raw >= 0 && raw <= now + 60000 ? raw : 0;
        const releaseSource = value?.source === ASSISTANT_UPDATE_CACHE_SOURCE;
        return {source:releaseSource ? ASSISTANT_UPDATE_CACHE_SOURCE : '',
            checkedAt:releaseSource ? timestamp(value?.checkedAt) : 0,
            attemptedAt:releaseSource ? timestamp(value?.attemptedAt) : 0,
            latestVersion:releaseSource && assistantVersionParts(value?.latestVersion) ? String(value.latestVersion).replace(/^v/,'') : '',
            version:value?.status === 'verified' && assistantVersionParts(value.version) ? String(value.version).replace(/^v/,'') : '',
            status:['verified','none'].includes(value?.status) ? value.status : ''};
    }
    function assistantReleaseVersion(text) {
        let release;
        try { release = JSON.parse(text); } catch { throw new Error('正式发行版信息无效，请稍后重试'); }
        const version = release && assistantVersionParts(release.tag_name);
        if (!version || release.draft !== false || release.prerelease !== false
            || release.tag_name !== `v${version[0]}.${String(version[1]).padStart(2,'0')}`)
            throw new Error('正式发行版信息无效，请稍后重试');
        return release.tag_name.slice(1);
    }
    function assistantUpdateDownloadURL(version) {
        if (!assistantVersionParts(version)) return '';
        return `https://raw.githubusercontent.com/zhu-hailin/chaoxing-ai-assistant/v${String(version).replace(/^v/,'')}/%E5%AD%A6%E4%B9%A0%E9%80%9AAI%E5%8A%A9%E6%89%8B.user.js`;
    }
    function assistantUpdateScriptVersion(script) {
        const header = typeof script === 'string' && /^\/\/ ==UserScript==\r?\n([\s\S]{1,16000}?)^\/\/ ==\/UserScript==/m.exec(script);
        const version = header && /^\/\/ @version\s+([^\s]+)\s*$/m.exec(header[1]);
        if (!header || header.index !== 0 || !version || !assistantVersionParts(version[1]) || !/^\/\/ @namespace\s+local\.chaoxing\.quiz\s*$/m.test(header[1]) || !script.trimEnd().endsWith('})();'))
            throw new Error('更新脚本信息无效，请稍后重试');
        return version[1].replace(/^v/,'');
    }
    function renderAssistantUpdates() {
        if (!panelView) return;
        const s = panelView.shadow, cache = assistantUpdateCache(), newer = assistantVersionIsNewer(cache.version);
        const download = s.getElementById('download-update'), install = s.getElementById('install-update');
        download.hidden = !newer; install.hidden = !newer;
        download.title = newer ? `下载更新 v${cache.version}` : '下载更新';
        download.setAttribute('aria-label', download.title);
        install.textContent = newer ? `下载更新 v${cache.version}` : '下载更新';
        s.getElementById('check-update').disabled = Boolean(assistantUpdatePending);
        s.getElementById('check-update').textContent = assistantUpdatePending ? '正在检查…' : '检查更新';
        let status = newer ? `此前已核验 v${cache.version}，尚未核对最新发行版` : '尚未核对正式发行版';
        if (cache.source === ASSISTANT_UPDATE_CACHE_SOURCE) {
            if (cache.status === 'none') status = '暂无公开发行版';
            else if (cache.latestVersion) {
                status = `最新发行版 v${cache.latestVersion}，`;
                if (assistantVersionIsNewer(cache.latestVersion)) status += cache.version === cache.latestVersion ? '可下载更新' : '等待核验下载';
                else status += cache.latestVersion === ASSISTANT_VERSION ? '已是最新发行版' : '本地版本较新';
            }
        }
        const checked = cache.checkedAt ? `；上次检查 ${new Date(cache.checkedAt).toLocaleString()}` : '';
        s.getElementById('update-status').textContent = `当前版本 v${ASSISTANT_VERSION}；${assistantUpdateMessage || status}${checked}`;
    }
    function requestPublicUpdateText(url, signal) {
        // force bypasses storage TTL; a unique URL also bypasses browser/CDN caches.
        // Keep the original logical URL for source/404 policy and validate the exact request target.
        const requestURL = new URL(url);
        requestURL.searchParams.set('_cx_update', `${Date.now()}-${assistantUpdateGeneration}`);
        const targetURL = requestURL.href;
        return new Promise((resolve, reject) => {
            let handle, settled = false;
            const finish = (callback, value) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); callback(value); };
            const abort = () => { finish(reject, cancelledError()); handle?.abort?.(); };
            if (signal.aborted) { abort(); return; }
            signal.addEventListener('abort', abort, {once:true});
            try {
                handle = GM_xmlhttpRequest({method:'GET',url:targetURL,anonymous:true,timeout:20000,
                    headers:{Accept:url === ASSISTANT_UPDATE_SOURCE ? 'application/vnd.github+json' : 'text/plain','Cache-Control':'no-cache','Pragma':'no-cache'},
                    onload(response) {
                        if (response.finalUrl && response.finalUrl !== targetURL) return finish(reject, new Error('更新地址发生变化，请前往 GitHub 核对'));
                        if (response.status === 404 && url === ASSISTANT_UPDATE_SOURCE) return finish(resolve, null);
                        if ([403,429].includes(response.status)) return finish(reject, new Error(`检查暂时受限（HTTP ${response.status}），请稍后重试`));
                        if (response.status !== 200 || typeof response.responseText !== 'string' || response.responseText.length > 8 * 1024 * 1024)
                            return finish(reject, new Error('无法获取有效更新信息，请重试'));
                        finish(resolve, response.responseText);
                    },
                    onerror:() => finish(reject, new Error('更新检查失败，请检查网络后重试')),
                    ontimeout:() => finish(reject, new Error('更新检查超时，请重试')),
                    onabort:() => finish(reject, cancelledError())});
            } catch { finish(reject, new Error('更新检查失败，请检查脚本的 GitHub 域名授权')); }
            if (signal.aborted) handle?.abort?.();
        });
    }
    function checkAssistantUpdates(force = false) {
        if (assistantUpdatePending) return assistantUpdatePending;
        const cache = assistantUpdateCache(), now = Date.now();
        if (!force && now - Math.max(cache.checkedAt, cache.attemptedAt) < 24 * 60 * 60 * 1000) return Promise.resolve(cache);
        const generation = ++assistantUpdateGeneration, abort = new AbortController(); assistantUpdateAbort = abort;
        set(ASSISTANT_UPDATE_KEY, {...cache,source:ASSISTANT_UPDATE_CACHE_SOURCE,
            status:cache.version ? 'verified' : cache.source === ASSISTANT_UPDATE_CACHE_SOURCE ? cache.status : '',attemptedAt:now});
        assistantUpdateMessage = '正在检查正式发行版…';
        const current = () => generation === assistantUpdateGeneration && !abort.signal.aborted;
        const run = async () => {
            let latestVersion = '', checkingDownload = false;
            try {
                const text = await requestPublicUpdateText(ASSISTANT_UPDATE_SOURCE, abort.signal);
                if (!current()) return null;
                let version = '', status = 'none';
                if (text !== null) {
                    latestVersion = assistantReleaseVersion(text); status = 'verified';
                    if (assistantVersionIsNewer(latestVersion)) {
                        checkingDownload = true;
                        assistantUpdateMessage = `发现正式发行版 v${latestVersion}，正在核对下载…`; renderAssistantUpdates();
                        const script = await requestPublicUpdateText(assistantUpdateDownloadURL(latestVersion), abort.signal);
                        if (!current()) return null;
                        let installedVersion;
                        try { installedVersion = assistantUpdateScriptVersion(script); } catch {}
                        if (installedVersion !== latestVersion) throw new Error('标签脚本版本不一致或脚本信息无效');
                        version = latestVersion;
                    } else if (cache.version === latestVersion) version = cache.version;
                }
                if (!current()) return null;
                const result = {source:ASSISTANT_UPDATE_CACHE_SOURCE,status,version,latestVersion,checkedAt:Date.now(),attemptedAt:now};
                set(ASSISTANT_UPDATE_KEY, result); assistantUpdateMessage = ''; return result;
            } catch (error) {
                if (current()) assistantUpdateMessage = checkingDownload
                    ? `已发现发行版 v${latestVersion}，下载核验失败：${error.message}` : error.message;
                return null;
            } finally {
                if (generation === assistantUpdateGeneration) { assistantUpdatePending = null; assistantUpdateAbort = null; renderAssistantUpdates(); }
            }
        };
        assistantUpdatePending = run(); renderAssistantUpdates(); return assistantUpdatePending;
    }
    function openAssistantUpdate() {
        const cache = assistantUpdateCache();
        if (!assistantVersionIsNewer(cache.version)) return;
        assistantUpdateOpen(assistantUpdateDownloadURL(cache.version), '_blank', 'noopener,noreferrer');
    }
    function startAssistantUpdateCheck() {
        // 每个顶层 Document 一次；面板、iframe 和 BFCache 恢复不另建自动请求。
        if (window !== window.top || assistantUpdateStarted) return assistantUpdateStartup;
        assistantUpdateStarted = true;
        const generation = assistantUpdateGeneration;
        assistantUpdateStartup = Promise.resolve().then(() => {
            if (generation === assistantUpdateGeneration) return checkAssistantUpdates(true);
        }).catch(() => null);
        return assistantUpdateStartup;
    }
    function initAssistantUpdates(shadow) {
        if (assistantUpdateListener === null && typeof GM_addValueChangeListener === 'function') {
            assistantUpdateListener = GM_addValueChangeListener(ASSISTANT_UPDATE_KEY, () => renderAssistantUpdates());
        }
        const check = shadow.getElementById('check-update');
        check.onclick = event => { if (trustedAssistantActivation(event, check)) checkAssistantUpdates(true); };
        for (const id of ['download-update','install-update']) {
            const button = shadow.getElementById(id);
            button.onclick = event => { if (trustedAssistantActivation(event, button)) openAssistantUpdate(); };
        }
        renderAssistantUpdates();
    }
    window.addEventListener('pagehide', () => {
        assistantUpdateGeneration++;
        assistantUpdateAbort?.abort(); assistantUpdateAbort = null; assistantUpdatePending = null;
        if (assistantUpdateListener !== null && typeof GM_removeValueChangeListener === 'function') GM_removeValueChangeListener(assistantUpdateListener);
        assistantUpdateListener = null;
    });
    window.addEventListener('pageshow', () => {
        if (panelView && assistantUpdateListener === null && typeof GM_addValueChangeListener === 'function') assistantUpdateListener = GM_addValueChangeListener(ASSISTANT_UPDATE_KEY, () => renderAssistantUpdates());
        renderAssistantUpdates();
    });
