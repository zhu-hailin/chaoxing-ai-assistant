    const KEY_ANALYSIS_CONCURRENCY = 'cx_analysis_concurrency';
    function analysisConcurrency(value) {
        const number = typeof value === 'number' ? value : typeof value === 'string' && /^[1-7]$/.test(value) ? Number(value) : NaN;
        return Number.isInteger(number) && number >= 1 && number <= 7 ? number : 3;
    }
    function analysisDelay(milliseconds, signal) {
        return new Promise((resolve, reject) => {
            let timer;
            const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(cancelledError()); };
            if (signal?.aborted) { cancel(); return; }
            signal?.addEventListener('abort', cancel, {once:true});
            timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, milliseconds);
        });
    }
    function analysisRetryPolicy(error, enabled) {
        const code = normalizeCxError(error).code;
        const transient = ['CX-NET-001','CX-NET-002','CX-HTTP-429','CX-HTTP-502','CX-HTTP-503','CX-HTTP-504'].includes(code);
        const format = ['CX-RES-001','CX-RES-002','CX-RES-005'].includes(code);
        return {code, transient, attempts:!enabled ? 1 : transient ? 3 : format ? 2 : 1};
    }
    function analysisFatalError(error) {
        const code = normalizeCxError(error).code;
        return error.code === 'ANALYSIS_CONFIG_CHANGED' || ['CX-EXE-005','CX-PAR-008','CX-CTL-006','CX-EXE-004','CX-SYS-003',
            'CX-CFG-001','CX-CFG-002','CX-CFG-003','CX-CFG-005','CX-HTTP-401','CX-HTTP-402','CX-HTTP-403'].includes(code);
    }
    function analysisPausedError(gate) {
        const error = createCxError(gate.code || 'CX-HTTP-429', {module:'analysis',operation:'request'});
        error.analysisPaused = true;
        const remaining=gate.notBefore-Date.now();
        error.analysisReason = (gate.reason || '请求已暂停，请稍后重试未完成题目')+(remaining>0?`（${Math.ceil(remaining/1000)} 秒后可重试）`:'');
        return error;
    }
    async function waitAnalysisGate(gate, signal, check) {
        const deadline=Date.now()+60000;
        do {
            check(); throwIfAborted(signal);
            if (gate.paused) throw analysisPausedError(gate);
            if (gate.notBefore > deadline) {
                gate.paused=true;gate.reason='服务商要求等待超过 60 秒，请稍后重试未完成题目';
                throw analysisPausedError(gate);
            }
            const delay = gate.notBefore - Date.now();
            if (delay <= 0) return;
            await analysisDelay(delay, signal);
        } while (Date.now() <= deadline);
        check();throwIfAborted(signal);
        if(gate.paused || gate.notBefore>Date.now()){gate.paused=true;throw analysisPausedError(gate);}
    }
    function runAnalysisQueue(records, {concurrency, signal, check, prepare, preparationConcurrency=2, execute, onChange=()=>{}, onSuccess=()=>{}, onRetry=()=>{}, onError=()=>{}, onFatal=()=>{}, retryTransient=false, gate} = {}) {
        const limit = analysisConcurrency(concurrency);
        const materialLimit = Math.min(2, Math.max(1, Number(preparationConcurrency) || 2));
        gate.paused = false; gate.failures = 0;
        for (const record of records) Object.assign(record, {status:prepare && record.materialReady?'ready':'pending',attempts:0,retryAt:0,error:null,errorCode:null});
        return new Promise((resolve, reject) => {
            let active = 0, preparing = 0, timer, fatal = null, finished = false;
            const queued = () => records.filter(record => ['pending','ready','retry-wait'].includes(record.status));
            const setError = (record, error, status) => Object.assign(record, {status,error:error.analysisReason || error.message,errorCode:normalizeCxError(error).code});
            const stop = error => {
                if (!fatal) { fatal = error; onFatal(error); }
                for (const record of queued()) setError(record, error, 'cancelled');
                pump();
            };
            const notify = () => { if (!fatal) { try { onChange(); } catch (error) { stop(error); } } };
            const abort = () => stop(cancelledError());
            function pump() {
                if (finished) return;
                clearTimeout(timer);
                if (!fatal && signal?.aborted) { stop(cancelledError()); return; }
                if (!fatal) { try { check(); } catch (error) { stop(error); return; } }
                if (gate.notBefore - Date.now() > 60000) {
                    gate.paused = true; gate.code ||= 'CX-HTTP-429'; gate.reason = '服务商要求等待超过 60 秒，请稍后重试未完成题目';
                }
                if (gate.paused) for (const record of queued()) setError(record, analysisPausedError(gate), 'cancelled');
                if (!fatal && !gate.paused) {
                    if (prepare) for (const record of queued()) {
                        if (fatal || gate.paused || signal?.aborted || preparing >= materialLimit) break;
                        if (record.status === 'pending') startPreparation(record);
                    }
                    for (const record of queued()) {
                        if (fatal || gate.paused || signal?.aborted || active >= limit || gate.notBefore > Date.now()) break;
                        if (prepare && record.status === 'pending') continue;
                        if (record.retryAt > Date.now()) continue;
                        start(record);
                    }
                }
                if (!active && !preparing && !queued().length) {
                    finished = true; signal?.removeEventListener('abort', abort); clearTimeout(timer);
                    if (!fatal) { try { onChange(); } catch (error) { fatal = error; onFatal(error); } }
                    if (fatal) reject(fatal); else resolve();
                } else if (!fatal && !gate.paused && active < limit) {
                    const waiting = queued().filter(record => !prepare || record.status !== 'pending');
                    if (waiting.length) {
                        const next = Math.max(gate.notBefore, Math.min(...waiting.map(record => record.retryAt || 0)));
                        timer = setTimeout(pump, Math.max(1, next - Date.now()));
                    }
                }
            }
            function startPreparation(record) {
                preparing++; record.status='preparing'; record.phase='materials'; notify();
                Promise.resolve().then(() => { check(); throwIfAborted(signal); return prepare(record); }).then(() => {
                    check(); throwIfAborted(signal);
                    if (fatal) { setError(record,fatal,'cancelled'); return; }
                    if (gate.paused) { setError(record,analysisPausedError(gate),'cancelled'); return; }
                    record.materialReady=true; record.status='ready';
                }).catch(error => {
                    if (fatal || signal?.aborted) { setError(record,fatal || error,'cancelled'); return; }
                    setError(record,error,'failed'); onError(error);
                    if (analysisFatalError(error)) stop(error);
                }).finally(() => { preparing--; notify(); pump(); });
            }
            function start(record) {
                active++; record.status = 'running'; record.attempts++; record.error = null; record.errorCode = null;
                notify();
                Promise.resolve().then(() => {
                    check(); throwIfAborted(signal);
                    if (record.attempts > 1) onRetry();
                    return execute(record);
                }).then(result => {
                    check(); throwIfAborted(signal);
                    record.result = result; record.status = 'success'; gate.failures = 0;
                    onSuccess(record);
                }).catch(error => {
                    if (fatal || signal?.aborted) { setError(record, fatal || error, 'cancelled'); return; }
                    if (analysisFatalError(error)) { setError(record, error, 'failed'); stop(error); return; }
                    onError(error);
                    const policy = analysisRetryPolicy(error, retryTransient);
                    setError(record, error, error.analysisPaused ? 'cancelled' : 'failed');
                    if (error.analysisPaused) return;
                    gate.failures = policy.transient ? gate.failures + 1 : 0;
                    const delay = 2000 * 2 ** (record.attempts - 1) * (1 + Math.random() * 0.25);
                    if (policy.code === 'CX-HTTP-429' || error.retryAfterMs > 0) {
                        gate.notBefore = Math.max(gate.notBefore, Date.now() + Math.max(delay, error.retryAfterMs || 0));gate.code=policy.code;
                    }
                    if (gate.failures >= 5) {
                        gate.paused = true; gate.code = policy.code; gate.reason = '连续请求失败，已暂停后续请求，可重试未完成题目';
                    }
                    if (!gate.paused && record.attempts < policy.attempts) {
                        record.status = 'retry-wait'; record.retryAt = Math.max(Date.now() + delay, gate.notBefore);
                    }
                }).finally(() => { active--; notify(); pump(); });
            }
            signal?.addEventListener('abort', abort, {once:true});
            pump();
        });
    }
