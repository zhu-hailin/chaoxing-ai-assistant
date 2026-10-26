const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {JSDOM, VirtualConsole} = require('jsdom');

const root = path.join(__dirname, '..');
const parser = fs.readFileSync(path.join(root, 'sources/question-parser.js'), 'utf8');
const saved = path.join(root, 'work/conservative-three-20261025/baseline/sources/question-parser.js');
const useSaved = fs.existsSync(saved) && !process.argv.includes('--portable-reference');
// The independent pre-change source is preferred locally. A portable reference
// exercises the retained direct-call legacy lookup branch without private indexes.
const reference = useSaved ? fs.readFileSync(saved, 'utf8')
    : parser.replace('media:legacy.media,parseLookup};', 'media:legacy.media};');
assert.notEqual(reference, parser, 'The reference must use the pre-index lookup path.');
const dependencies = ['question-context.js', 'question-media.js'].map(file =>
    fs.readFileSync(path.join(root, 'sources', file), 'utf8'));
const referenceMode = useSaved ? 'saved pre-change parser' : 'direct-call legacy lookup reference';

function fixture(html, source = parser) {
    const errors = [], console = new VirtualConsole();
    console.on('jsdomError', error => errors.push(error.message));
    const dom = new JSDOM(html, {url:'https://mooc1.chaoxing.com/work/doHomeWorkNew',
        runScripts:'outside-only', pretendToBeVisual:true, virtualConsole:console});
    const w = dom.window, d = w.document;
    w.eval(`function clean(value){return String(value || '').replace(/\\s+/g,' ').trim()}
      function questionId(node,index){return node.getAttribute('questionid') || node.getAttribute('data-question-id') || node.id || 'local-'+(index+1)}
      function courseElementVisible(node){return node.isConnected && !node.closest('[hidden]') && getComputedStyle(node).display!=='none'}
      ${dependencies[0]}
      ${source}
      ${dependencies[1]}
      globalThis.api={parseQuestionGraph,parseQuestionContent,buildQuestionRequestUnits,
        createQuestionSnapshot,assertQuestionSnapshot,questionBindingNodes};`);
    return {w,d,api:w.api,close(){dom.window.close();assert.deepEqual(errors, []);}};
}
const textQuestion = (id, controls, stem='填写两个概念') =>
    `<div class="TiMu" questionid="${id}"><div class="stem">【填空题】${stem}</div>${controls}</div>`;
const labelled = id => textQuestion(id,
    `<label for="${id}-a">概念甲</label><input id="${id}-a"><label for="${id}-b">概念乙</label><input id="${id}-b">`);
const aria = id => textQuestion(id,
    `<span id="${id}-left">左侧</span><span id="${id}-right">右侧</span><span id="${id}-last">末项</span>
     <input id="${id}-a" aria-labelledby="${id}-right ${id}-left"><input id="${id}-b" aria-labelledby="${id}-last">`);
const mixed = labelled('label-one') + labelled('label-two') + aria('aria-one') + aria('aria-two');
const choice = '<div class="TiMu" questionid="choice"><div class="stem">【单选题】选择甲</div>'
    + '<label><input type="radio" name="choice" value="A">A.甲</label><label><input type="radio" name="choice" value="B">B.乙</label></div>';

function nodePath(node) {
    const parts = [];
    for (let current=node; current && current.nodeType!==9; current=current.parentNode) {
        const parent=current.parentNode;
        parts.push([current.nodeName, parent ? [...parent.childNodes].indexOf(current) : -1]);
    }
    return parts.reverse();
}
function projection(f, graph=f.api.parseQuestionGraph(f.d)) {
    const request=f.api.buildQuestionRequestUnits(graph);
    const nodes=binding => [...f.api.questionBindingNodes(binding)].map(nodePath);
    const bindings=map => [...map].map(([id,binding]) => [id,{
        writer:binding.writer,type:binding.type,canPrefill:binding.canPrefill,nodes:nodes(binding),
        options:[...(binding.optionTargets || [])].map(([key,node]) => [key,nodePath(node)])}]);
    return JSON.parse(JSON.stringify({graph:{...graph,bindings:undefined},bindings:bindings(graph.bindings),
        request:{questions:request.questions,bindings:bindings(request.bindings),
            parentByUnit:[...request.parentByUnit],unitsByQuestion:[...request.unitsByQuestion]}}));
}
function compare(html, mutate=()=>{}) {
    const a=fixture(html,reference), b=fixture(html);
    try {mutate(a);mutate(b);assert.deepEqual(projection(b),projection(a));}
    finally {a.close();b.close();}
}

function main() {
    const passed=[], failed=[], counts={};
    const test=(name,run)=>{try{run();passed.push(name);console.log('PASS '+name);}
        catch(error){failed.push({name,error:error.stack});console.log('FAIL '+name+' '+error.message);}};
    test('Graph, ordered request units and live bindings match the pre-change parser',()=>{
        compare(mixed+choice);
        const f=fixture(mixed);
        try {
            const g=f.api.parseQuestionGraph(f.d);
            assert(g.questions.every(q=>q.responseUnits.length===2));
            assert.equal(g.questions[2].responseUnits[0].question,'右侧；左侧');
            assert(!JSON.stringify(g).includes('parseLookup'));
        } finally {f.close();}
    });
    test('Each parse indexes full-document labels and ids once, and a new parse rebuilds them',()=>{
        for (const [name,source] of [['reference',reference],['optimized',parser]]) {
            const f=fixture(mixed,source);
            try {
                const original=f.d.querySelectorAll.bind(f.d), queries={label:0,'[id]':0};
                f.d.querySelectorAll=selector=>{if(selector in queries)queries[selector]++;return original(selector);};
                f.api.parseQuestionGraph(f.d);counts[name]={...queries};
                f.api.parseQuestionGraph(f.d);
                assert.equal(queries.label,counts[name].label*2);
                assert.equal(queries['[id]'],counts[name]['[id]']*2);
            } finally {f.close();}
        }
        assert.deepEqual(counts.optimized,{label:1,'[id]':1});
        assert(counts.reference.label>counts.optimized.label);
        assert(counts.reference['[id]']>counts.optimized['[id]']);
    });
    test('Choice-only parses do not build unused document indexes',()=>{
        const f=fixture(choice);
        try {
            const original=f.d.querySelectorAll.bind(f.d), queries=[];
            f.d.querySelectorAll=selector=>{queries.push(selector);return original(selector);};
            f.api.parseQuestionGraph(f.d);
            assert(!queries.includes('label'));assert(!queries.includes('[id]'));
        } finally {f.close();}
    });
    test('Duplicate ids and external or hidden labels retain full-document ambiguity checks',()=>{
        for (const extra of ['<input id="label-one-a" hidden>',
            '<label for="label-one-a">题外标签</label>',
            '<div hidden><label for="label-one-a">隐藏标签</label></div>',
            '<div class="cx-ai-ignore" id="label-one-a"></div>']) compare(labelled('label-one')+extra);
        compare(aria('aria-one')+'<span id="aria-one-left" hidden>重复引用目标</span>');
    });
    test('ARIA order, duplicate references, cross-question references and missing targets match baseline',()=>{
        for (const refs of ['aria-one-right aria-one-left','aria-one-left aria-one-left',
            'aria-two-left','missing','aria-one-a']) compare(aria('aria-one')+aria('aria-two'),
            f=>f.d.getElementById('aria-one-a').setAttribute('aria-labelledby',refs));
        compare(aria('aria-one'),f=>f.d.getElementById('aria-one-b').setAttribute('aria-labelledby','aria-one-left aria-one-right'));
    });
    test('Fresh parses observe relation, id, label, order, replacement and editability changes',()=>{
        const mutations=[
            f=>f.d.querySelector('label').setAttribute('for','label-one-b'),
            f=>f.d.getElementById('label-one-a').id='new-id',
            f=>f.d.getElementById('aria-one-a').setAttribute('aria-labelledby','aria-one-left'),
            f=>f.d.querySelector('label').textContent='改变含义',
            f=>{const node=f.d.getElementById('label-one-a');node.replaceWith(node.cloneNode(true));},
            f=>{const node=f.d.getElementById('label-one-a');node.parentNode.append(node);},
            f=>{f.d.getElementById('label-one-a').disabled=true;},
            f=>{f.d.getElementById('label-one-a').readOnly=true;}
        ];
        for (const mutate of mutations) {
            const outputs=[];
            for (const source of [reference,parser]) {
                const f=fixture(mixed,source);
                try {
                    const before=f.api.parseQuestionGraph(f.d), snapshot=f.api.createQuestionSnapshot(before,{doc:f.d});
                    mutate(f);let code=null;
                    try{f.api.assertQuestionSnapshot(snapshot);}catch(error){code=error.cxCode || error.code;}
                    assert(code,'The old snapshot must still reject a changed relation or control.');
                    outputs.push({code,projection:projection(f)});
                } finally {f.close();}
            }
            assert.deepEqual(outputs[1],outputs[0]);
        }
    });
    test('Actual answers, checked state and unrelated feedback retain existing snapshot semantics',()=>{
        for (const source of [reference,parser]) {
            const f=fixture(mixed+choice,source);
            try {
                const snapshot=f.api.createQuestionSnapshot(f.api.parseQuestionGraph(f.d),{doc:f.d});
                f.d.getElementById('label-one-a').value='人工内容';
                f.d.querySelector('input[type=radio]').checked=true;
                f.d.body.insertAdjacentHTML('beforeend','<p class="feedback">已保存</p>');
                assert.equal(f.api.assertQuestionSnapshot(snapshot),true);
            } finally {f.close();}
        }
    });
    test('Identical ids in different documents never reuse another document lookup',()=>{
        const f=fixture(labelled('same')+'<iframe></iframe>');
        try {
            const other=f.d.querySelector('iframe').contentDocument;
            other.body.innerHTML=labelled('same').replace('概念甲','另文档甲');
            const own=f.api.parseQuestionGraph(f.d), inner=f.api.parseQuestionGraph(other);
            assert.equal(own.questions[0].responseUnits[0].question,'概念甲');
            assert.equal(inner.questions[0].responseUnits[0].question,'另文档甲');
            assert.equal(inner.bindings.get('same').inputs[0].ownerDocument,other);
            assert.equal(f.api.parseQuestionGraph(f.d).questions[0].responseUnits[0].question,'概念甲');
        } finally {f.close();}
    });
    test('Media maps preserve images, reading order, formulas, tables, code and shared material',()=>{
        compare('<div class="mark_item"><div class="question-instructions">公共材料<img src="/shared.png"></div>'
            +textQuestion('media','<input>','前文<img src="/one.png">后文<math><mi>x</mi></math><table><tr><td>甲</td></tr></table><pre>code</pre>')
            +labelled('labels')+'</div>');
    });
    test('Direct parseQuestionContent calls keep the original no-index fallback',()=>{
        const outputs=[];
        for (const source of [reference,parser]) {
            const f=fixture(aria('direct'),source);
            try {
                const g=f.api.parseQuestionGraph(f.d), question=g.questions[0], binding=g.bindings.get(question.id);
                const content=f.api.parseQuestionContent(binding.node,{question,binding,doc:f.d,parseContext:{},media:g.media});
                outputs.push(JSON.parse(JSON.stringify({...content,slots:content.slots.map(slot=>({...slot,control:nodePath(slot.control)}))})));
            } finally {f.close();}
        }
        assert.deepEqual(outputs[1],outputs[0]);
    });
    console.log(JSON.stringify({referenceMode,passed:passed.length,failed:failed.length,queriesPerParse:counts,tests:passed,failures:failed}));
    process.exitCode=failed.length?1:0;
}
if (require.main===module) main();
module.exports={parser,reference,referenceMode};
