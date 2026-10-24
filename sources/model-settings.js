    // 模型配置读取、能力展示与设置值回显。
    function readModelConfiguration() {
        const cfg=readProviderConfiguration();
        return {...cfg,videoInfoEnabled:get(KEY_AUTO_CONTEXT,true)!==false,analysisConcurrency:analysisConcurrency(get(KEY_ANALYSIS_CONCURRENCY,3))};
    }
    function refreshModelCapabilities(shadow, busy = false) {
        const cfg = readModelConfiguration();
        const caps = providerModelCapabilities(cfg.provider, cfg.model);
        const busyReason = '任务运行中，请结束后再修改模型设置';
        shadow.getElementById('thinking').checked = cfg.thinking;
        setAssistantControlDisabled(shadow.getElementById('thinking'),busy || !caps.thinking || caps.thinkingRequired,busy ? busyReason : caps.thinkingRequired ? '当前模型始终开启深度思考' : '当前模型不提供深度思考开关');
        setAssistantControlDisabled(shadow.getElementById('effort'),busy || !caps.effort || !cfg.thinking,busy ? busyReason : !caps.effort ? '当前模型不支持调整推理强度' : '请先开启深度思考');
        shadow.getElementById('search').checked = cfg.search;
        setAssistantControlDisabled(shadow.getElementById('search'),busy || !caps.search,busy ? busyReason : '当前模型不支持此网络检索选项');
        const tested=cfg.provider==='custom' ? typeof verifiedModelImages==='function' && verifiedModelImages(cfg.provider,cfg.model,cfg.baseURL) : caps.imageEvidence==='image-test';
        const label = tested ? '视觉（已通过图片识别测试）' : cfg.provider === 'custom' ? (cfg.images ? '视觉（自定义声明）' : '文本（自定义声明）')
            : caps.known ? (cfg.images ? '视觉：可分析题干和选项中的图片' : '文本：图片题将保留待核对') : '图片能力未确认：图片题将保留待核对';
        shadow.getElementById('auto-context').checked = cfg.videoInfoEnabled;
        setAssistantControlDisabled(shadow.getElementById('info-model'),busy || !cfg.videoInfoEnabled || cfg.provider === 'custom',busy ? busyReason : !cfg.videoInfoEnabled ? '请先开启自动识别信息' : '自定义接口沿用当前模型');
        setAssistantControlDisabled(shadow.getElementById('info-interval'),busy || !cfg.videoInfoEnabled,busy ? busyReason : '请先开启自动识别信息');
        shadow.getElementById('model-capability').textContent = label + (caps.thinkingRequired ? '；此模型始终开启深度思考。' : '。');
        refreshBrandedModelPickers(shadow);
    }
    function renderModelSettings(ctl, fetchedModels) {
        if (!panelView) return;
        const shadow = panelView.shadow;let cfg = readModelConfiguration();
        refreshCredentialEditor(cfg);
        if(fetchedModels){rememberProviderModelList(cfg,fetchedModels);cfg=readModelConfiguration();}
        const provider = getModelProvider(cfg.provider);
        const el = id => shadow.getElementById(id), doc = panelView.host.ownerDocument;
        el('provider').value = cfg.provider;
        el('api-key-status').textContent = cfg.credentialNeedsApproval ? '自定义接口地址尚未授权，请重新输入并保存 API Key' : cfg.key ? `${provider.name} Key 已保存` : `${provider.name} 尚未配置 API Key`;
        el('preset-model-block').hidden = cfg.provider === 'custom';
        el('custom-model-block').hidden = cfg.provider !== 'custom';
        el('custom-base').value = readProviderSetting('custom', 'baseURL', '');
        el('custom-model').value = readProviderSetting('custom', 'model', '');
        el('custom-images').checked = Boolean(readProviderSetting('custom', 'images', false));
        const available=currentProviderModelList(cfg),models=available || [];
        el('model').replaceChildren();
        const placeholder=doc.createElement('option');placeholder.value=available?'':cfg.model;placeholder.disabled=true;
        placeholder.dataset.disabledReason=available?'请选择列表中的模型':'请先点击“获取模型”加载可选列表';
        placeholder.textContent=available?'请选择模型':cfg.model?modelOptionLabel(cfg.provider,cfg.model)+'（已保存，待获取列表校验）':'请先获取模型列表';
        el('model').append(placeholder);
        for (const model of models) {
            const option = doc.createElement('option'); option.value = model.id;
            option.textContent = modelOptionLabel(cfg.provider, model.id, model.name); el('model').append(option);
        }
        el('model').value = cfg.model;
        const visionModels = cfg.provider==='custom' || !available ? (cfg.images && cfg.model ? [{id:cfg.model,name:cfg.model}] : []) : models.filter(item=>providerModelCapabilities(cfg.provider,item.id).images);
        el('info-model').replaceChildren();
        for (const model of visionModels) { const option=doc.createElement('option');option.value=model.id;option.textContent=model.name;el('info-model').append(option); }
        if (!visionModels.length) { const option=doc.createElement('option');option.value='';option.textContent='当前接口未确认图片能力';el('info-model').append(option); }
        el('info-model').value=cfg.infoModel;
        el('info-interval').value=cfg.videoInfoIntervalSeconds;
        el('effort').value = cfg.effort;
        el('analysis-concurrency').value = cfg.analysisConcurrency;
        refreshModelCapabilities(shadow, ctl.state.busy || courseRunActive());
    }
