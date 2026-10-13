    // Key 输入就地显示；闭合 Shadow DOM 不向课程页面暴露输入节点。
    // 已保存 Key 不回填；凭据仅从真实控件操作写入脚本存储。
    const credentialConfirm = window.confirm.bind(window);
    const credentialAlert = window.alert.bind(window);
    const credentialValueListeners = [];
    let credentialView = null;

    function credentialSettingsBusy() {
        return Boolean(controller?.state.busy || courseRunActive());
    }
    function reportCredentialSettings(message) {
        if (controller) controller.report(message);
        else credentialAlert(message);
    }
    function clearCredentialInput() {
        if (credentialView) credentialView.input.value = '';
    }
    function refreshCredentialEditor(configuration, busy = credentialSettingsBusy()) {
        if (!credentialView) return;
        const cfg = configuration || readModelConfiguration();
        if (cfg.provider !== credentialView.provider || cfg.baseURL !== credentialView.baseURL || busy) clearCredentialInput();
        credentialView.provider = cfg.provider; credentialView.baseURL = cfg.baseURL;
        credentialView.input.disabled = busy; credentialView.save.disabled = busy;
        credentialView.clear.disabled = busy || !readProviderSetting(cfg.provider, 'key', '');
        credentialView.input.placeholder = cfg.key ? '输入新 Key 替换，留空保留已保存值' : '输入当前平台 API Key';
        credentialView.input.setAttribute('aria-label', `${getModelProvider(cfg.provider).name} API Key`);
    }
    function refreshCredentialStatus(provider, cleared = false) {
        if (!controller || readModelConfiguration().provider !== provider) return;
        clearCredentialInput();
        if (cleared) controller.last = null;
        if (!controller.state.busy && !courseRunActive()) renderModelSettings(controller);
        renderRunState(controller.state);
    }
    function initCredentialEditor(host) {
        if (credentialView) return;
        const shadow = host.attachShadow({mode:'closed'});
        shadow.innerHTML = `<style>*{box-sizing:border-box}label,input,button{font:inherit}div{display:flex;align-items:center;gap:8px;margin:8px 0;flex-wrap:wrap}label{min-width:65px;font-size:13px;color:var(--muted,#6c7b90)}input{flex:1;min-width:120px;width:180px;padding:8px;border:1px solid #cbd5e3;border-radius:6px;background:#fff;color:var(--ink,#26354a)}button{padding:7px 11px;border:1px solid transparent;border-radius:6px;background:var(--accent,#315fbd);color:#fff;cursor:pointer}button.secondary{background:#f0f3f7;color:var(--ink,#26354a)}button:disabled,input:disabled{opacity:.5;cursor:not-allowed}button:focus-visible,input:focus-visible{outline:2px solid #729adc;outline-offset:2px}</style><div><label for="credential-key">API Key</label><input id="credential-key" type="password" maxlength="4096" autocomplete="new-password" spellcheck="false"><button type="button" id="credential-save">保存</button><button type="button" id="credential-clear" class="secondary">清除</button></div>`;
        const input = shadow.getElementById('credential-key'), save = shadow.getElementById('credential-save'), clear = shadow.getElementById('credential-clear');
        credentialView = {host,shadow,input,save,clear,provider:null,baseURL:''};
        const current = () => {
            if (credentialSettingsBusy()) { reportCredentialSettings('正在运行，请停止任务后再修改 API Key'); return null; }
            const cfg = readModelConfiguration();
            if (cfg.provider !== credentialView.provider || cfg.baseURL !== credentialView.baseURL) {
                clearCredentialInput(); refreshCredentialEditor(); reportCredentialSettings('平台或接口地址已变化，请重新输入 API Key'); return null;
            }
            return cfg;
        };
        const saveInput = () => {
            const cfg = current(); if (!cfg) return;
            const key = input.value.trim();
            if (!key || key.length > 4096 || /[\s\x00-\x1f\x7f]/.test(key)) return reportCredentialSettings('API Key 为空或包含空白字符，原配置已保留');
            if (!cfg.baseURL) return reportCredentialSettings('请先保存有效的自定义接口地址，再保存 API Key');
            saveProviderKey(key, cfg.provider); clearCredentialInput();
            refreshCredentialStatus(cfg.provider); reportCredentialSettings(`${getModelProvider(cfg.provider).name} Key 已保存`);
        };
        save.addEventListener('click', event => { if (trustedAssistantActivation(event, save)) saveInput(); });
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter' && trustedAssistantActivation(event, input, 'keydown')) { event.preventDefault(); saveInput(); }
        });
        clear.addEventListener('click', event => {
            if (!trustedAssistantActivation(event, clear)) return;
            const cfg = current(); if (!cfg || !credentialConfirm(`清除 ${getModelProvider(cfg.provider).name} 已保存的 API Key？`)) return;
            const after = current(); if (!after || after.provider !== cfg.provider || after.baseURL !== cfg.baseURL) return;
            saveProviderKey('', cfg.provider); clearCredentialInput();
            refreshCredentialStatus(cfg.provider, true); reportCredentialSettings(`${getModelProvider(cfg.provider).name} Key 已清除`);
        });
        refreshCredentialEditor();
    }
    function initCredentialSettings() {
        if (credentialValueListeners.length || typeof GM_addValueChangeListener !== 'function') return;
        for (const provider of MODEL_PROVIDERS) {
            credentialValueListeners.push(GM_addValueChangeListener(providerSettingKey(provider.id, 'key'), (_name, _old, value) => {
                refreshCredentialStatus(provider.id, !value);
            }));
        }
    }
    window.addEventListener('pagehide', () => {
        clearCredentialInput();
        if (typeof GM_removeValueChangeListener !== 'function') return;
        for (const listener of credentialValueListeners) GM_removeValueChangeListener(listener);
        credentialValueListeners.length = 0;
    });
    window.addEventListener('pageshow', initCredentialSettings);
