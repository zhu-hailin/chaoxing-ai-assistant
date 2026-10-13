    // Key 编辑只从脚本管理器菜单进入，浏览器原生对话框不会把输入放入课程页面 DOM。
    // @sandbox DOM 优先使用扩展隔离环境；不使用 unsafeWindow 或网页事件接收凭据。
    const credentialPrompt = window.prompt.bind(window);
    const credentialConfirm = window.confirm.bind(window);
    const credentialAlert = window.alert.bind(window);
    let credentialMenusRegistered = false;
    let credentialMenuSuffix = '';
    const credentialValueListeners = [];

    function credentialSettingsBusy() {
        return Boolean(controller?.state.busy || courseRunActive());
    }
    function reportCredentialSettings(message) {
        if (controller) controller.report(message);
        else credentialAlert(message);
    }
    function refreshCredentialStatus(provider, cleared = false) {
        if (!controller || readModelConfiguration().provider !== provider) return;
        if (cleared) controller.last = null;
        if (!controller.state.busy && !courseRunActive()) renderModelSettings(controller);
        renderRunState(controller.state);
    }
    function chooseCredentialProvider(action) {
        const list = MODEL_PROVIDERS.map((provider,index) => `${index + 1}. ${provider.name}`).join('\n');
        const choice = credentialPrompt(`${action} API Key：输入平台编号\n${list}`, '');
        if (choice === null) return null;
        const number = String(choice).trim();
        if (!/^[1-6]$/.test(number) || !MODEL_PROVIDERS[Number(number) - 1]) {
            reportCredentialSettings('平台编号无效，API Key 未修改');
            return null;
        }
        return MODEL_PROVIDERS[Number(number) - 1];
    }
    function editCredentialFromMenu(clear = false) {
        if (credentialSettingsBusy()) return reportCredentialSettings('正在运行，请停止任务后再修改 API Key');
        const provider = chooseCredentialProvider(clear ? '清除' : '设置 / 替换');
        if (!provider) return;
        if (clear) {
            if (!credentialConfirm(`清除 ${provider.name} 已保存的 API Key？`)) return;
            if (credentialSettingsBusy()) return reportCredentialSettings('正在运行，API Key 未修改');
            saveProviderKey('', provider.id);
            refreshCredentialStatus(provider.id, true);
            reportCredentialSettings(`${provider.name} Key 已清除`);
            return;
        }
        const baseURL=readProviderConfiguration(provider.id).baseURL;
        if (!baseURL) return reportCredentialSettings('请先在模型设置中保存有效的自定义接口地址，再从菜单设置 API Key');
        const input = credentialPrompt(`输入 ${provider.name} API Key（不回显已保存的 Key）\n授权的 API 地址：${baseURL}\n此浏览器对话框输入可见，请注意周围环境。取消保留原配置。`, '');
        if (input === null) return;
        const key = String(input).trim();
        if (!key) return reportCredentialSettings('API Key 为空，原配置已保留');
        if (credentialSettingsBusy()) return reportCredentialSettings('正在运行，API Key 未修改');
        if (readProviderConfiguration(provider.id).baseURL!==baseURL) return reportCredentialSettings('API 地址已变化，API Key 未修改；请重新从菜单配置');
        saveProviderKey(key, provider.id);
        refreshCredentialStatus(provider.id);
        reportCredentialSettings(`${provider.name} Key 已保存`);
    }
    function initCredentialValueListeners() {
        if (credentialValueListeners.length || typeof GM_addValueChangeListener !== 'function') return;
        for (const provider of MODEL_PROVIDERS) {
            const listener = GM_addValueChangeListener(providerSettingKey(provider.id, 'key'), (_name, _old, value) => {
                refreshCredentialStatus(provider.id, !value);
            });
            credentialValueListeners.push(listener);
        }
    }
    function initCredentialSettingsMenu() {
        initCredentialValueListeners();
        if (credentialMenusRegistered || typeof GM_registerMenuCommand !== 'function') return;
        if (window !== window.top) {
            if (!hasQuestionNodes(document)) return;
            // 顶层页面可能不匹配脚本。每份题目文档用独立名称，避免篡改猴合并菜单后重复弹出输入。
            if (!credentialMenuSuffix) {
                const frameId = [...crypto.getRandomValues(new Uint8Array(4))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
                credentialMenuSuffix = `（题目页 ${frameId}）`;
            }
        }
        GM_registerMenuCommand(`设置 / 替换模型 API Key${credentialMenuSuffix}`, () => editCredentialFromMenu(false));
        GM_registerMenuCommand(`清除模型 API Key${credentialMenuSuffix}`, () => editCredentialFromMenu(true));
        credentialMenusRegistered = true;
    }
    window.addEventListener('pagehide', () => {
        if (typeof GM_removeValueChangeListener !== 'function') return;
        for (const listener of credentialValueListeners) GM_removeValueChangeListener(listener);
        credentialValueListeners.length = 0;
    });
    window.addEventListener('pageshow', initCredentialValueListeners);
