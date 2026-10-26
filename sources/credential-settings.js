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
        const busyReason = '任务运行中，请结束后再修改 API Key';
        setAssistantControlDisabled(credentialView.input,busy,busyReason); setAssistantControlDisabled(credentialView.save,busy,busyReason);
        setAssistantControlDisabled(credentialView.clear,busy || !readProviderSetting(cfg.provider, 'key', ''),busy ? busyReason : '当前服务商尚未保存 API Key');
        credentialView.input.placeholder = cfg.key ? '输入新 Key，留空保留当前值' : '输入当前平台 API Key';
        credentialView.input.setAttribute('aria-label', `${getModelProvider(cfg.provider).name} API Key`);
    }
    function refreshCredentialStatus(provider) {
        if (!controller || readModelConfiguration().provider !== provider) return;
        clearCredentialInput();
        if (!controller.state.busy && !courseRunActive()) renderModelSettings(controller);
        renderRunState(controller.state);
    }
    function initCredentialEditor(host) {
        if (credentialView) return;
        const shadow = host.attachShadow({mode:'closed'});
        shadow.innerHTML = `<style>:host{display:block;container-type:inline-size}*{box-sizing:border-box}label,input,button{font:inherit;font-size:12px}div{display:grid;grid-template-columns:64px minmax(90px,1fr) auto auto;align-items:center;gap:6px;margin:4px 0}label{color:var(--muted,#6f787d)}input{min-width:0;width:100%;height:30px;padding:5px 8px;border:1px solid #dfe4eb;border-radius:5px;background:#fff;color:#272d30}button{min-height:30px;line-height:1.4;padding:4px 9px;border:1px solid transparent;border-radius:5px;background:var(--accent,#3569d4);color:#fff;cursor:pointer;white-space:nowrap}button.secondary{background:#f5f6f8;color:var(--ink,#272d30)}button:disabled,input:disabled{opacity:.5;cursor:not-allowed}button:focus-visible{outline:2px solid #3569d4;outline-offset:2px}input:focus-visible{outline:2px solid var(--accent,#3569d4);outline-offset:-1px;border-color:transparent}@container(max-width:320px){div{grid-template-columns:minmax(0,1fr) auto auto}label{grid-column:1/-1;margin-bottom:1px}}</style><div><label for="credential-key">API Key</label><input id="credential-key" type="password" maxlength="4096" autocomplete="new-password" spellcheck="false"><button type="button" id="credential-save">保存</button><button type="button" id="credential-clear" class="secondary">清除</button></div>`;
        const input = shadow.getElementById('credential-key'), save = shadow.getElementById('credential-save'), clear = shadow.getElementById('credential-clear');
        credentialView = {host,shadow,input,save,clear,provider:null,baseURL:''};
        initAssistantControlFeedback(shadow);
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
            refreshCredentialStatus(cfg.provider); reportCredentialSettings(`${getModelProvider(cfg.provider).name} Key 已清除`);
        });
        refreshCredentialEditor();
    }
    function initCredentialSettings() {
        if (credentialValueListeners.length || typeof GM_addValueChangeListener !== 'function') return;
        for (const provider of MODEL_PROVIDERS) {
            credentialValueListeners.push(GM_addValueChangeListener(providerSettingKey(provider.id, 'key'), () => {
                refreshCredentialStatus(provider.id);
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
