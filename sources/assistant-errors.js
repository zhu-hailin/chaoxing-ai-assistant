    // Public diagnostics contain catalog text and bounded facts only. Raw causes stay private.
    const CX_ERROR_CATALOG = Object.freeze({
        'CX-NET-001':'网络请求失败，具体原因未知',
        'CX-NET-002':'网络请求超时',
        'CX-NET-003':'已确认网络处于离线状态',
        'CX-NET-004':'已确认网络请求权限被拒绝',
        'CX-NET-005':'已确认 DNS 解析失败',
        'CX-NET-006':'已确认 TLS/SSL 握手失败',
        'CX-NET-007':'已确认连接被拒绝或重置',
        'CX-CFG-001':'API Key 未配置，请先保存 API Key',
        'CX-CFG-002':'未选择模型，请先选择或保存模型',
        'CX-CFG-003':'API 基础地址无效，请保存有效的 HTTPS API 基础地址',
        'CX-CFG-004':'所选模型不支持请求的能力',
        'CX-CFG-005':'自定义接口尚未获得必要授权，请重新保存 Key',
        'CX-CFG-006':'缺少运行所需权限或依赖',
        'CX-RES-001':'服务响应不是合法 JSON',
        'CX-RES-002':'接口没有返回有效的必要响应字段',
        'CX-RES-003':'模型返回空答案或空消息',
        'CX-RES-004':'模型输出被截断，请减少单次题量',
        'CX-RES-005':'AI 答案结构不符合协议',
        'CX-RES-006':'AI 答案与请求的题目数量或 ID 不匹配',
        'CX-RES-007':'服务商返回业务错误，请检查模型和服务配置',
        'CX-PAR-001':'未发现可识别的题目容器',
        'CX-PAR-002':'无法唯一定位题干',
        'CX-PAR-003':'无法可靠判断题型',
        'CX-PAR-004':'题目材料不完整',
        'CX-PAR-005':'字体混淆未成功还原',
        'CX-PAR-006':'图片或公式材料无法读取',
        'CX-PAR-007':'题目结构存在歧义',
        'CX-PAR-008':'页面题目解析快照已失效',
        'CX-CTL-001':'未发现答案控件',
        'CX-CTL-002':'答案控件类型暂不支持',
        'CX-CTL-003':'无法可靠识别提交按钮',
        'CX-CTL-004':'控件处于禁用或不可编辑状态',
        'CX-CTL-005':'存在多个可能的操作入口',
        'CX-CTL-006':'原生控件已被动态替换',
        'CX-CTL-007':'无法可靠识别继续按钮',
        'CX-MAT-001':'题目与答案控件无法建立关联',
        'CX-MAT-002':'存在多个同等可信的关联候选',
        'CX-MAT-003':'子问题与填空槽位数量不匹配',
        'CX-MAT-004':'跨 iframe 任务归属无法确认',
        'CX-MAT-005':'关联证据在执行前发生变化',
        'CX-EXE-001':'执行前校验失败',
        'CX-EXE-002':'原生控件写入失败',
        'CX-EXE-003':'提交结果无法确认，请人工核对',
        'CX-EXE-004':'执行时页面或控件发生变化',
        'CX-EXE-005':'操作已取消',
        'CX-EXE-006':'已存在未确认提交，禁止重复执行',
        'CX-EXE-007':'执行阶段等待超时',
        'CX-EXE-008':'连续章节失败保护已触发',
        'CX-SYS-001':'任务运行环境不符合要求',
        'CX-SYS-002':'未分类程序异常',
        'CX-SYS-003':'页面生命周期已结束',
        'CX-SYS-004':'必需模块或依赖不可用'
    });
    const CX_HTTP_MESSAGES = Object.freeze({400:'请求参数错误',401:'API 身份认证失败',402:'服务商要求处理计费或付款',
        403:'服务器拒绝访问',404:'接口、模型或资源不存在',408:'服务器返回请求超时',413:'请求体过大',422:'请求数据无法处理',
        429:'触发请求频率限制',500:'服务端内部错误',502:'上游网关异常',503:'服务暂不可用',504:'网关超时'});
    const CX_LEGACY_CODES = Object.freeze({NETWORK:'CX-NET-001',TIMEOUT:'CX-NET-002',BAD_JSON:'CX-RES-001',
        BAD_RESPONSE:'CX-RES-002',EMPTY_REPLY:'CX-RES-003',MODEL_ERROR:'CX-RES-007',NO_API_KEY:'CX-CFG-001',
        NO_MODEL:'CX-CFG-002',NO_ENDPOINT:'CX-CFG-003',ENDPOINT_NOT_APPROVED:'CX-CFG-005',
        BAD_ANSWER:'CX-RES-005',BAD_ANSWER_IDS:'CX-RES-006',SNAPSHOT_CHANGED:'CX-PAR-008',CONFIG_CHANGED:'CX-EXE-001',
        ABORTED:'CX-EXE-005',COURSE_TIMEOUT:'CX-EXE-007',COURSE_FAILURE_LIMIT:'CX-EXE-008',
        COURSE_FRAME_UNAVAILABLE:'CX-MAT-004',COURSE_MANUAL_ANSWER_REQUIRED:'CX-CTL-002'});
    const cxPrivateErrors = new WeakMap();
    const cxRecordedErrors = new WeakMap();
    const cxDiagnosticBuffer = [];
    let cxDiagnosticSequence = 0;
    const cxInstanceId = Math.random().toString(36).slice(2,12);
    function cxKnownCode(code,status) {
        if (typeof code === 'string' && Object.prototype.hasOwnProperty.call(CX_ERROR_CATALOG,code)) return code;
        if (typeof code === 'string' && /^CX-HTTP-[1-5]\d\d$/.test(code)) return code;
        if (code === 'HTTP' && Number.isInteger(status) && status >= 100 && status <= 599) return `CX-HTTP-${status}`;
        return Object.prototype.hasOwnProperty.call(CX_LEGACY_CODES,code) ? CX_LEGACY_CODES[code] : 'CX-SYS-002';
    }
    function cxCatalogMessage(code) {
        return CX_ERROR_CATALOG[code] || (/^CX-HTTP-/.test(code) ? `HTTP ${Number(code.slice(8))}：${CX_HTTP_MESSAGES[Number(code.slice(8))] || '服务器返回非成功 HTTP 状态'}` : CX_ERROR_CATALOG['CX-SYS-002']);
    }
    function cxSafeLocalId(value) {
        return typeof value === 'string' && /^cx-(?:local|task|request|snapshot|document|run|diag)-[a-z0-9-]{1,96}$/i.test(value) ? value : undefined;
    }
    const CX_MODULES = new Set(['request','model','provider','parser','media','context','actions','controller','course','video-quiz','system','settings','analysis','question-parser','question-context','question-media']);
    const CX_OPERATIONS = new Set(['request','fetch','parse','validate','normalize','classify','answer','answers','answer-ids','analyze','solve','prepare','extract','match','snapshot','plan','execute','prefill','submit','continue','wait','cancel','copy','export','initialize','detect','models','list','configure','retry','guard','lifecycle','font','run','protection','parse-document','validate-snapshot','prepare-media']);
    const CX_PHASES = new Set(['reading','analyzing','prefilling','submitting','replay-wait','manual-wait','passed','pending','running','stopped','failed','complete','cancelled','stale','idle','preflight']);
    const CX_EVIDENCE = new Set(['same-document','same-node','ancestor','frame-ancestor','frame-chain','outside','unknown','inside','same-task','confirmed','probable','ambiguous','unsupported','label-for','label-wrapper','unique-control','explicit-slot','explicit-subquestion','adapter-option-group','adapter-group','adapter-verified','node-replaced','document-changed','content-changed','relation-changed','aborted','timeout','http-status','explicit-permission-denied','explicit-offline','dns-failure','tls-failure','connection-refused','connection-reset',
        'missing-node','detached-node','frame-cycle','ancestor-frame-container','same-document-container','same-document-outside','unreadable-parent','independent-document','stale-document','outside-context-policy','frame-element','depth-limit',
        'adapter-slot-reference','native-label-reference','adapter-option-key','isolated-option-group','unverified-option-group','adapter-question-boundary','unique-text-response','missing-unique-response']);
    function cxSafeFacts(context) {
        const result = {};
        if (!context || typeof context !== 'object') return result;
        // There is deliberately no arbitrary string/message/reason/URL/response field here.
        for (const name of ['questionCount','answerCount','unitCount','controlCount','relationCount','mediaCount','materialCount','batchIndex','batchCount','attempt','retryCount','frameDepth','count','expectedCount','actualCount','maxAttempts','bindingGeneration','elapsedMs','bytes','limit','suppressedCount','recoveryAttempts']) {
            const value=context[name];
            if (typeof value==='number' && Number.isFinite(value) && value>=0 && value<=Number.MAX_SAFE_INTEGER) result[name]=value;
        }
        for (const name of ['images','writable','recognized','online','cancelled','visible','focused','configured','submissionStarted','outcomeConfirmed','automatic','manual','installed','truncated','json','hasMessage','hasContent','hasBusinessError','required','bindingValid'])
            if (typeof context[name]==='boolean') result[name]=context[name];
        if (CX_PHASES.has(context.phase)) result.phase=context.phase;
        if (['GET','POST'].includes(context.method)) result.method=context.method;
        if (['auto','manual','uncertain','needs-classification'].includes(context.policyStatus)) result.policyStatus=context.policyStatus;
        if (['confirmed','probable','ambiguous','unsupported','inside','outside','unknown'].includes(context.relationStatus)) result.relationStatus=context.relationStatus;
        if (Array.isArray(context.evidence)) result.evidence=[...new Set(context.evidence.filter(item=>CX_EVIDENCE.has(item)))].slice(0,20);
        // Only a parsed host is retained, never credentials, paths, query strings or fragments.
        if (typeof context.endpoint==='string') {
            try {const value=new URL(context.endpoint);if (value.protocol==='https:' && !value.username && !value.password) result.endpointHost=value.hostname;} catch {}
        }
        return result;
    }
    function createCxError(cxCode,context={},options={}) {
        const code=cxKnownCode(cxCode,options.status),error=new Error(cxCatalogMessage(code));
        error.code=options.legacyCode || code;
        error.cxCode=code;
        if (options.status!==undefined) error.status=options.status;
        if (error.code==='ABORTED' || code==='CX-EXE-005') error.name='AbortError';
        cxPrivateErrors.set(error,{context:cxSafeFacts(context),module:context.module,operation:context.operation,
            taskId:cxSafeLocalId(context.taskId),requestId:cxSafeLocalId(context.requestId),severity:options.severity,cause:options.cause});
        return error;
    }
    function normalizeCxError(error,context={}) {
        const source=error && typeof error==='object'?error:{},stored=cxPrivateErrors.get(source) || {};
        const status=Number.isInteger(source.status)?source.status:Number.isInteger(source.httpStatus)?source.httpStatus:undefined;
        const code=cxKnownCode(source.cxCode || source.code || (source.name==='AbortError'?'ABORTED':undefined),status);
        const legacy=typeof source.code==='string' && (Object.prototype.hasOwnProperty.call(CX_LEGACY_CODES,source.code) || source.code==='HTTP') ? source.code :
            typeof source.legacyCode==='string' && (Object.prototype.hasOwnProperty.call(CX_LEGACY_CODES,source.legacyCode) || source.legacyCode==='HTTP') ? source.legacyCode : undefined;
        const severity=code==='CX-EXE-005' || code==='CX-SYS-003' || legacy==='COURSE_MANUAL_ANSWER_REQUIRED' ? 'info' :
            ['info','warning','error'].includes(stored.severity)?stored.severity:'error';
        const module=CX_MODULES.has(context.module)?context.module:CX_MODULES.has(stored.module)?stored.module:CX_MODULES.has(source.module)?source.module:'system';
        const operation=CX_OPERATIONS.has(context.operation)?context.operation:CX_OPERATIONS.has(stored.operation)?stored.operation:CX_OPERATIONS.has(source.operation)?source.operation:'validate';
        const diagnostics={...stored.context,...cxSafeFacts(source.diagnostics),...cxSafeFacts(context)};
        const elapsedMs=diagnostics.elapsedMs;
        return {id:`cx-diag-${cxInstanceId}-${++cxDiagnosticSequence}`,code,...(legacy?{legacyCode:legacy}:{}),severity,module,operation,
            message:cxCatalogMessage(code),...(cxSafeLocalId(context.taskId) || stored.taskId || cxSafeLocalId(source.taskId) ? {taskId:cxSafeLocalId(context.taskId) || stored.taskId || cxSafeLocalId(source.taskId)}:{}),
            ...(cxSafeLocalId(context.requestId) || stored.requestId || cxSafeLocalId(source.requestId)?{requestId:cxSafeLocalId(context.requestId) || stored.requestId || cxSafeLocalId(source.requestId)}:{}),
            timestamp:new Date().toISOString(),...(elapsedMs!==undefined?{elapsedMs}:{}),
            ...(status>=100 && status<=599?{httpStatus:status}:{}),
            retryable:code==='CX-NET-001' || code==='CX-NET-002' || ['CX-HTTP-502','CX-HTTP-503','CX-HTTP-504'].includes(code),
            recoverable:!['CX-EXE-003','CX-EXE-006','CX-SYS-003'].includes(code),diagnostics};
    }
    function recordCxDiagnostic(errorOrDiagnostic,context={}) {
        const object=errorOrDiagnostic && typeof errorOrDiagnostic==='object'?errorOrDiagnostic:null;
        if (object && cxRecordedErrors.has(object)) return cxRecordedErrors.get(object);
        const diagnostic=normalizeCxError(errorOrDiagnostic,context);
        if(diagnostic.diagnostics.evidence)Object.freeze(diagnostic.diagnostics.evidence);
        Object.freeze(diagnostic.diagnostics);Object.freeze(diagnostic);
        cxDiagnosticBuffer.push(diagnostic);
        if (cxDiagnosticBuffer.length>100) cxDiagnosticBuffer.shift();
        if (object) cxRecordedErrors.set(object,diagnostic);
        cxRecordedErrors.set(diagnostic,diagnostic);
        return diagnostic;
    }
    function exportCxDiagnostics() {
        return JSON.stringify({schemaVersion:1,diagnostics:cxDiagnosticBuffer},null,2);
    }
