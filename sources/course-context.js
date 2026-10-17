    const KEY_AUTO_CONTEXT = 'cx_auto_course_context';
    // 课程资料只保存在当前章内存中。仅读取现有字幕/文字，不下载媒体或推断画面内容。
    const COURSE_CONTEXT_LIMITS = Object.freeze({ items:24, itemCharacters:4000, totalCharacters:12000, cues:10000 });
    const courseContextNodeIds = new WeakMap();
    let courseContextNodeSequence = 0;
    function courseContextNodeId(node) {
        if (!courseContextNodeIds.has(node)) courseContextNodeIds.set(node,++courseContextNodeSequence);
        return courseContextNodeIds.get(node);
    }
    function courseContextPlainText(value, doc) {
        let text=typeof value==='string'?value:'';
        // WebVTT 标记和空的富文本笔记均先转为纯文本；不把片段插入页面。
        if (doc && /<[^>]*>|&(?:nbsp|#160|#xA0);/i.test(text)) {
            const fragment=doc.createElement('template');fragment.innerHTML=text;
            for (const node of fragment.content.querySelectorAll('script,style,iframe,object,embed')) node.remove();
            text=fragment.content.textContent || '';
        }
        return text.replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').replace(/\u00A0/g,' ')
            .replace(/\r\n?/g,'\n').replace(/[\t ]+/g,' ').replace(/ *\n */g,'\n').replace(/\n{3,}/g,'\n\n').trim();
    }
    function courseContextNoteText(root) {
        if (!root?.isConnected || root.matches('html,body') || root.closest('.singleQuesId,.TiMu,.CeYan,.fanyaMarking_left,[data-quiz-status]')
            || root.querySelector('.singleQuesId,.TiMu,.CeYan,.fanyaMarking_left,[data-quiz-status]')) return '';
        const doc=root.ownerDocument;
        let value;
        if (root.matches('textarea,input:not([type]),input[type="text"]')) value=root.value;
        else {
            const copy=root.cloneNode(true);
            for (const node of copy.querySelectorAll('script,style,button,[hidden],[aria-hidden="true"],[data-placeholder]')) node.remove();
            value=copy.textContent || '';
        }
        const text=courseContextPlainText(value,doc);
        const placeholders=[root.getAttribute('placeholder'),root.getAttribute('data-placeholder'),root.getAttribute('aria-placeholder')]
            .filter(Boolean).map(value=>courseContextPlainText(value,doc));
        if (!text || placeholders.includes(text) || /^(?:暂无(?:课堂)?笔记|还没有(?:课堂)?笔记|尚无(?:课堂)?笔记|没有(?:课堂)?笔记|请输入(?:课堂)?笔记|点击(?:此处)?(?:添加|记录|编辑)笔记)[。.!！…]*$/.test(text)) return '';
        return text;
    }
    function createCourseContext(chapterId) {
        return {chapterId:String(chapterId ?? '').trim(),items:[],truncated:false};
    }
    function collectCourseContext({chapterId,video,reader,notesRoots=[]}={}) {
        if (!String(chapterId ?? '').trim()) return [];
        const items=[];
        const add=(kind,title,text,sourceId,truncated=false)=>{
            const normalized=courseContextPlainText(text);
            if (!normalized || items.length>=COURSE_CONTEXT_LIMITS.items) return;
            items.push({kind,title:courseContextPlainText(title).slice(0,120),text:normalized.slice(0,COURSE_CONTEXT_LIMITS.itemCharacters),sourceId,
                ...(truncated || normalized.length>COURSE_CONTEXT_LIMITS.itemCharacters?{truncated:true}:{})});
        };
        if (video?.isConnected) {
            try {
                const tracks=video.textTracks;
                for (let index=0;index<Math.min(tracks?.length || 0,24);index++) {
                    const track=tracks[index];
                    if (!track || !['captions','subtitles'].includes(track.kind)) continue;
                    let cues;
                    try { cues=track.cues; } catch { continue; }
                    if (!cues) continue;
                    const lines=[],seen=new Set();let length=0,processed=0;
                    for (let cueIndex=0;cueIndex<Math.min(cues.length,COURSE_CONTEXT_LIMITS.cues);cueIndex++) {
                        processed=cueIndex+1;
                        const text=courseContextPlainText(cues[cueIndex]?.text,video.ownerDocument);
                        if (!text || seen.has(text)) continue;
                        seen.add(text);lines.push(text);length+=text.length+1;
                        if (length>=COURSE_CONTEXT_LIMITS.itemCharacters) break;
                    }
                    add('subtitle',track.label || '视频字幕',lines.join('\n'),`subtitle:${courseContextNodeId(video)}:${index}`,processed<cues.length);
                }
            } catch { /* 未开放或未加载的字幕轨道不作为资料，也不改变轨道 mode。 */ }
        }
        const root=reader?.contentRoot;
        if (root?.isConnected && root.matches('.pdfViewer,.page,.textLayer,[data-document-reader],.continuous-reader')) {
            const layers=root.matches('.textLayer')?[root]:[...root.querySelectorAll('.textLayer')];
            let length=0,processed=0;const lines=[];
            for (const layer of layers) {
                processed++;
                if (layer.closest('.singleQuesId,.TiMu,.CeYan,.fanyaMarking_left')) continue;
                const text=courseContextPlainText(layer.textContent,layer.ownerDocument);
                if (!text) continue;
                lines.push(text);length+=text.length+1;
                if (length>=COURSE_CONTEXT_LIMITS.itemCharacters) break;
            }
            add('document','课件文字',lines.join('\n'),`document:${courseContextNodeId(root)}`,processed<layers.length);
        }
        // 平台笔记根节点必须由已确认的适配器传入；不扫描 body、题目或作答区。
        for (const root of Array.isArray(notesRoots)?notesRoots.slice(0,24):[]) {
            const text=courseContextNoteText(root);
            if (text) add('note','课堂笔记',text,`note:${courseContextNodeId(root)}`);
        }
        return items;
    }
    function mergeCourseContext(store,chapterId,items) {
        const id=String(chapterId ?? '').trim();
        if (!id || !store || store.chapterId!==id || !Array.isArray(store.items)) return false;
        for (const item of Array.isArray(items)?items:[]) {
            if (!item || !['subtitle','document','note','video-frame'].includes(item.kind)) continue;
            const text=courseContextPlainText(item.text).slice(0,COURSE_CONTEXT_LIMITS.itemCharacters);
            if (!text) continue;
            const entry={kind:item.kind,title:courseContextPlainText(item.title).slice(0,120),text,
                sourceId:typeof item.sourceId==='string'?item.sourceId.slice(0,120):'',
                ...(item.truncated || courseContextPlainText(item.text).length>COURSE_CONTEXT_LIMITS.itemCharacters?{truncated:true}:{})};
            const index=store.items.findIndex(previous=>previous.kind===entry.kind && (entry.sourceId?previous.sourceId===entry.sourceId:previous.title===entry.title && previous.text===entry.text));
            if (entry.truncated) store.truncated=true;
            if (index>=0) {
                if (store.items[index].text!==entry.text) store.truncated=true;
                store.items[index]=entry;
            } else store.items.push(entry);
            // 连续画面采用滚动窗口，早期采样不能永久挡住后面的字幕、资料或视频。
            while (store.items.length>COURSE_CONTEXT_LIMITS.items) {
                const frame=store.items.findIndex(previous=>previous.kind==='video-frame');
                store.items.splice(frame>=0?frame:store.items.length-1,1);store.truncated=true;
            }
        }
        let total=store.items.reduce((sum,item)=>sum+item.text.length,0);
        while (total>COURSE_CONTEXT_LIMITS.totalCharacters) {
            const frames=store.items.map((item,index)=>item.kind==='video-frame'?index:-1).filter(index=>index>=0);
            if (frames.length<=1) break;
            const [removed]=store.items.splice(frames[0],1);total-=removed.text.length;store.truncated=true;
        }
        if (total>COURSE_CONTEXT_LIMITS.totalCharacters) {
            // 至少保留最新的一份画面文字，其他资料按原顺序有界保留；无画面时正常尾裁切。
            const lastFrame=store.items.findLast(item=>item.kind==='video-frame');
            let remaining=COURSE_CONTEXT_LIMITS.totalCharacters-(lastFrame?.text.length || 0);
            store.items=store.items.filter(item=>{
                if (item===lastFrame) return true;
                if (!remaining) {store.truncated=true;return false;}
                if (item.text.length>remaining) {item.truncated=true;store.truncated=true;}
                item.text=item.text.slice(0,remaining).trim();remaining-=item.text.length;
                return Boolean(item.text);
            });
        }
        return true;
    }
    function courseContextForPrompt(store,chapterId) {
        if (!store || !String(chapterId ?? '').trim() || store.chapterId!==String(chapterId).trim()) return [];
        const copy=createCourseContext(chapterId);copy.truncated=Boolean(store.truncated);mergeCourseContext(copy,chapterId,store.items);
        return copy.items.map(({kind,title,text,truncated},index)=>({kind,title,text,
            ...(truncated || copy.truncated && index===copy.items.length-1?{truncated:true}:{})}));
    }
