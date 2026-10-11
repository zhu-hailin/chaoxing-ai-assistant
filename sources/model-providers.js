    // 平台能力按官方文档确认；未知模型只分析文字，不按名称猜测视觉能力。
    const KEY_PROVIDER = 'cx_provider';
    const MODEL_PROVIDERS = Object.freeze([
        {id:'deepseek',name:'DeepSeek',baseURL:DEEPSEEK_BASE,verifiedAt:'2026-10-11',
            docs:'https://api-docs.deepseek.com/quick_start/pricing/',
            models:[{id:'deepseek-flash',name:'DeepSeek Flash',images:true,thinking:true},
                {id:'deepseek-v4-pro',name:'DeepSeek V4 Pro',images:false,thinking:true}]},
        {id:'openai',name:'OpenAI',baseURL:'https://api.openai.com/v1',verifiedAt:'2026-10-11',
            docs:'https://developers.openai.com/api/docs/models/gpt-4.1-mini',
            models:[{id:'gpt-4.1-mini',name:'GPT-4.1 mini',images:true,thinking:false},
                {id:'gpt-4.1',name:'GPT-4.1',images:true,thinking:false}]},
        {id:'qwen',name:'通义千问',baseURL:'https://dashscope.aliyuncs.com/compatible-mode/v1',verifiedAt:'2026-10-11',
            docs:'https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions',
            models:[{id:'qwen-plus',name:'Qwen Plus',images:false,thinking:false},
                {id:'qwen3-vl-plus',name:'Qwen3 VL Plus',images:true,thinking:false}]},
        {id:'kimi',name:'Kimi',baseURL:'https://api.moonshot.cn/v1',verifiedAt:'2026-10-11',
            docs:'https://platform.kimi.com/docs/api/chat',
            models:[{id:'kimi-k2.6',name:'Kimi K2.6',images:true,thinking:false}]},
        {id:'glm',name:'智谱 GLM',baseURL:'https://open.bigmodel.cn/api/paas/v4',verifiedAt:'2026-10-11',
            docs:'https://docs.bigmodel.cn/cn/guide/develop/openai/introduction',
            models:[{id:'glm-5.3',name:'GLM-5.3',images:false,thinking:true,thinkingRequired:true},
                {id:'glm-5.3-flash',name:'GLM-5.3 Flash',images:true,thinking:false}]},
        {id:'custom',name:'自定义',baseURL:'',verifiedAt:'2026-10-11',models:[]}
    ]);
    const DEEPSEEK_IMAGE_ALIASES = new Set(['deepseek-v4-flash','deepseek-v4-flash-vision-exp']);
    function getModelProvider(id = get(KEY_PROVIDER,'deepseek')) {
        return MODEL_PROVIDERS.find(item=>item.id===id) || MODEL_PROVIDERS[0];
    }
    function providerModelCapabilities(provider, model) {
        const platform=getModelProvider(typeof provider==='object'?provider.id:provider);
        const preset=platform.models.find(item=>item.id===model);
        const legacyVision=platform.id==='deepseek' && DEEPSEEK_IMAGE_ALIASES.has(model);
        const known=Boolean(preset || legacyVision);
        const tested=!known && typeof verifiedModelImages==='function' && verifiedModelImages(platform.id,model);
        return {known,images:known?Boolean(preset?.images || legacyVision):Boolean(tested),imageEvidence:known?'official':tested?'image-test':'unknown',
            thinking:Boolean(preset?.thinking || legacyVision),thinkingRequired:preset?.thinkingRequired===true,
            effort:platform.id==='deepseek' && known || platform.id==='glm' && preset?.thinkingRequired===true,
            search:platform.id==='deepseek',jsonMode:platform.id==='deepseek' || known && ['openai','qwen','kimi'].includes(platform.id)};
    }
    function providerSettingKey(provider, field) {
        const id=getModelProvider(provider).id;
        const legacy={key:KEY_DS,model:KEY_MODEL,thinking:KEY_THINKING,effort:KEY_EFFORT,search:KEY_SEARCH};
        return id==='deepseek' && legacy[field] ? legacy[field] : `cx_provider_${id}_${field}`;
    }
    function readProviderSetting(provider, field, fallback = '') {
        return get(providerSettingKey(provider,field),fallback);
    }
    function normalizeModelBaseURL(value) {
        let url;
        try {url=new URL(String(value ?? '').trim());}
        catch {throw new Error('请输入有效的 API 地址');}
        if(url.protocol!=='https:' || !url.hostname || url.username || url.password || url.search || url.hash)
            throw new Error('API 地址需使用 HTTPS，且不包含账号、密码、查询参数或锚点');
        const base=url.href.replace(/\/+$/,'');
        if(/\/(?:chat\/completions|models)$/i.test(url.pathname.replace(/\/+$/,'')))
            throw new Error('请输入 API 基础地址，末尾不要包含 /chat/completions 或 /models');
        return base;
    }
    function readProviderConfiguration(provider = get(KEY_PROVIDER,'deepseek')) {
        const platform=getModelProvider(provider),id=platform.id;
        const key=String(readProviderSetting(id,'key','') ?? '').trim();
        const model=String(readProviderSetting(id,'model',platform.models[0]?.id || '') ?? '').trim();
        let baseURL=platform.baseURL;
        if(id==='custom') {
            try {baseURL=normalizeModelBaseURL(readProviderSetting(id,'baseURL',''));}
            catch {baseURL='';}
        }
        const capabilities=providerModelCapabilities(id,model);
        const images=id==='custom' ? readProviderSetting(id,'images',false)===true || Boolean(baseURL && typeof verifiedModelImages==='function' && verifiedModelImages(id,model,baseURL)) : capabilities.images;
        const thinking=capabilities.thinkingRequired || capabilities.thinking && Boolean(readProviderSetting(id,'thinking',false));
        const effortRaw=readProviderSetting(id,'effort','high');
        const effort=['low','high','max'].includes(effortRaw) ? effortRaw : 'high';
        const search=capabilities.search && Boolean(readProviderSetting(id,'search',false));
        const defaultInfoModel=platform.models.find(item=>item.images)?.id || (id==='custom' && images?model:'');
        const infoModel=String(readProviderSetting(id,'infoModel',defaultInfoModel) || '').trim();
        const rawInterval=Number(readProviderSetting(id,'videoInfoIntervalSeconds',30));
        const videoInfoIntervalSeconds=Number.isFinite(rawInterval)?Math.min(300,Math.max(5,rawInterval)):30;
        return {provider:id,baseURL,key,model,images,thinking,effort,search,infoModel,videoInfoIntervalSeconds,configured:Boolean(key && model && baseURL)};
    }
    function saveProviderSetting(field,value,provider = get(KEY_PROVIDER,'deepseek')) {
        const id=getModelProvider(provider).id;
        if(!['model','thinking','effort','search','baseURL','images','infoModel','videoInfoIntervalSeconds'].includes(field))throw new Error('不支持的模型配置字段');
        if(['thinking','search','images'].includes(field))value=Boolean(value);
        else if(field==='videoInfoIntervalSeconds') {
            value=Number(value);if(!Number.isFinite(value)||value<5||value>300)throw new Error('识别间隔请输入 5–300 秒');
        } else if(field==='baseURL') {
            if(id!=='custom')throw new Error('预置平台的 API 地址无需修改');
            value=normalizeModelBaseURL(value);
        } else value=String(value ?? '').trim();
        set(providerSettingKey(id,field),value);
    }
    function saveProviderKey(key,provider = get(KEY_PROVIDER,'deepseek')) {
        set(providerSettingKey(provider,'key'),String(key ?? '').trim());
    }
    function endpointFingerprint(value) {
        // 配置相等判断使用固定长度指纹，运行报告不保存 API 地址。
        let hash=14695981039346656037n;
        for(const character of String(value || '')) {
            hash ^= BigInt(character.codePointAt(0));
            hash=BigInt.asUintN(64,hash*1099511628211n);
        }
        return hash.toString(16).padStart(16,'0');
    }
    function modelConfigurationSignature(settings) {
        const provider=getModelProvider(settings.provider || 'deepseek').id;
        return {provider,model:String(settings.model || ''),images:modelSupportsImages(settings.model,settings),
            thinking:Boolean(settings.thinking),effort:String(settings.effort || 'high'),search:Boolean(settings.search),
            endpointFingerprint:endpointFingerprint(provider==='custom' ? settings.baseURL : getModelProvider(provider).baseURL),
            videoInfoEnabled:settings.videoInfoEnabled===true,infoModel:String(settings.infoModel || ''),videoInfoIntervalSeconds:Number(settings.videoInfoIntervalSeconds || 30)};
    }
    function modelOptionLabel(provider,id,name = id) {
        const platform=getModelProvider(typeof provider==='object'?provider.id:provider);
        const capability=providerModelCapabilities(platform.id,id);
        const capabilityLabel=capability.imageEvidence==='image-test' ? '支持图片（已实测）' : capability.known ? capability.images ? '支持图片' : '仅文字' : '图片能力未确认';
        return `${name || id} · ${capabilityLabel}`;
    }
    function buildConfiguredAnswerPayload(settings,questions,evidence,preparedMedia = new Map()) {
        const platform=getModelProvider(settings.provider || 'deepseek');
        const capabilities=providerModelCapabilities(platform.id,settings.model);
        const thinking=platform.id==='deepseek' ? Boolean(settings.thinking) : capabilities.thinkingRequired || capabilities.thinking && Boolean(settings.thinking);
        const payload=buildAnswerPayload(settings.model,questions,thinking,settings.effort || 'high',evidence,preparedMedia,settings.courseContext || []);
        if(platform.id==='deepseek')return payload;
        delete payload.thinking;
        delete payload.reasoning_effort;
        if(!capabilities.jsonMode)delete payload.response_format;
        if(platform.id==='qwen' && capabilities.known)payload.enable_thinking=false;
        if(platform.id==='kimi' && capabilities.known)payload.thinking={type:'disabled'};
        if(platform.id==='glm' && capabilities.effort && thinking)payload.reasoning_effort=['low','high','max'].includes(settings.effort)?settings.effort:'high';
        // original 是现有 DeepSeek 接口参数；其他平台按已确认的格式发送图片。
        for(const message of payload.messages)if(Array.isArray(message.content))for(const part of message.content) {
            if(part.type!=='image_url')continue;
            if(platform.id==='openai')part.image_url.detail='high';
            else delete part.image_url.detail;
        }
        return payload;
    }
    function assertConfiguredRequestSize(settings,payload) {
        assertRequestSize(payload);
        if(getModelProvider(settings.provider || 'deepseek').id==='qwen' && new Blob([JSON.stringify(payload)]).size > 16*1024*1024)
            throw new Error('通义千问请求超过 16 MiB，请减少单题或同题组的图片材料');
    }
    function configuredEndpoint(settings,path) {
        const platform=getModelProvider(settings.provider || 'deepseek');
        const baseURL=platform.id==='custom' ? normalizeModelBaseURL(settings.baseURL) : platform.baseURL;
        return `${baseURL}/${path}`;
    }
    async function fetchConfiguredModels(settings) {
        if(!settings.key)throw new Error('请先保存 API Key');
        const data=await requestJSON({method:'GET',url:configuredEndpoint(settings,'models'),key:settings.key,timeout:30000});
        if(!Array.isArray(data.data) || !data.data.length)throw new Error('模型列表为空');
        return data.data.filter(item=>item && typeof item.id==='string' && item.id.trim()).map(item=>({
            id:item.id.trim(),name:typeof item.name==='string'?item.name:item.id.trim(),
            effort:Array.isArray(item.effort?.supported_levels)?item.effort.supported_levels:[]
        }));
    }
    async function askConfiguredModel(settings,questions,evidence,preparedMedia = new Map(),signal) {
        if(!settings.key || !settings.model)throw new Error('请先配置模型：保存 API Key 并选择模型');
        if(questions.some(question=>questionImageIds(question).length) && !modelSupportsImages(settings.model,settings))
            throw new Error('所选模型不支持图片，此类题目暂不能分析');
        const payload=buildConfiguredAnswerPayload(settings,questions,evidence,preparedMedia);
        assertConfiguredRequestSize(settings,payload);
        const response=await requestJSON({method:'POST',url:configuredEndpoint(settings,'chat/completions'),key:settings.key,
            data:payload,timeout:settings.thinking?180000:90000,signal:signal || settings.signal});
        const choice=response.choices?.[0];
        if(!choice || choice.finish_reason!=='stop')throw new Error('模型输出不完整，建议减小题量或降低推理强度');
        const text=choice.message?.content;
        if(typeof text!=='string' || !text.trim())throw new Error('AI 返回空答案');
        let parsed;
        try {parsed=JSON.parse(text);}
        catch {throw new Error('AI 返回内容不是合法 JSON');}
        return {answers:normalize(parsed,questions),mediaAnalysis:normalizeMediaAnalysis(parsed,questions,preparedMedia),usage:response.usage || null};
    }
