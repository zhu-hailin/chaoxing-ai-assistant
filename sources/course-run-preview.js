    // Read-only projection: wheel selection never chooses navigation targets or starts tasks.
    function createCourseWheel(doc,view) {
        const list=view.shadow.getElementById('course-preview-list'),rowHeight=76;
        let items=[],scope='',currentId=null,signature='',selected=0,frame=null,visible=new Set(),wheelUntil=0;
        const reduced=()=>doc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const paint=()=>{
            if(!items.length||!list.clientHeight)return;
            const position=list.scrollTop/rowHeight;
            selected=Math.max(0,Math.min(items.length-1,Math.round(position)));
            const next=new Set(),first=Math.max(0,Math.floor(position)-4),last=Math.min(items.length-1,Math.ceil(position)+4);
            for(let i=first;i<=last;i++) {
                const row=list.children[i],distance=i-position,amount=Math.abs(distance);next.add(i);
                row.style.opacity=String(Math.max(.12,1-amount*.24));
                row.style.transform=`perspective(700px) rotateX(${Math.max(-55,Math.min(55,-distance*16))}deg) scale(${Math.max(.76,1-amount*.075)})`;
                row.style.filter=amount>1.5?`blur(${Math.min(1.2,(amount-1.5)*.45)}px)`:'none';
                row.setAttribute('aria-selected',String(i===selected));row.classList.toggle('is-wheel-selected',i===selected);
            }
            for(const i of visible)if(!next.has(i)&&list.children[i]){
                list.children[i].style.opacity='0';list.children[i].setAttribute('aria-selected','false');list.children[i].classList.remove('is-wheel-selected');
            }
            visible=next;list.setAttribute('aria-activedescendant',`course-wheel-option-${selected}`);
        };
        const schedule=()=>{if(frame===null)frame=doc.defaultView.requestAnimationFrame(()=>{frame=null;paint();});};
        const center=(index,smooth=false)=>{
            if(!items.length)return;
            const target=Math.max(0,Math.min(items.length-1,index));
            list.scrollTo({top:target*rowHeight,behavior:smooth&&!reduced()?'smooth':'auto'});schedule();
        };
        const layout=()=>{
            if(!list.clientHeight)return;
            list.style.setProperty('--wheel-edge',`${Math.max(0,(list.clientHeight-rowHeight)/2)}px`);
            center(selected);paint();
        };
        list.addEventListener('scroll',schedule,{passive:true});
        list.addEventListener('wheel',event=>{
            if(event.ctrlKey||event.shiftKey||!event.cancelable||!items.length||!Number.isFinite(event.deltaY)
                ||Math.abs(event.deltaY)<=Math.abs(event.deltaX))return;
            event.preventDefault();event.stopPropagation();
            const at=doc.defaultView.performance.now();
            // One adjacent card per step; merge the short burst emitted by high-resolution wheels.
            if(at<wheelUntil)return;
            wheelUntil=at+180;
            center(Math.round(list.scrollTop/rowHeight)+Math.sign(event.deltaY),true);
        },{passive:false});
        list.addEventListener('click',event=>{
            const row=event.target.closest('[data-wheel-index]');if(row&&row.parentElement===list)center(Number(row.dataset.wheelIndex),true);
        });
        list.addEventListener('keydown',event=>{
            let next;
            if(event.key==='ArrowDown')next=selected+1;else if(event.key==='ArrowUp')next=selected-1;
            else if(event.key==='Home')next=0;else if(event.key==='End')next=items.length-1;else return;
            event.preventDefault();event.stopPropagation();center(next,true);
        });
        const observer=typeof doc.defaultView.ResizeObserver==='function'?new doc.defaultView.ResizeObserver(layout):null;
        observer?.observe(list);doc.defaultView.addEventListener('resize',layout);
        doc.defaultView.addEventListener('pagehide',()=>{
            observer?.disconnect();doc.defaultView.removeEventListener('resize',layout);
            if(frame!==null)doc.defaultView.cancelAnimationFrame(frame);
        },{once:true});
        view.refreshCourseWheel=layout;
        return {update(next,nextScope,nextCurrent){
            const reset=scope!==nextScope||currentId!==nextCurrent,oldIndex=selected,oldId=items[selected]?.id,oldScroll=list.scrollTop;
            const nextSignature=JSON.stringify([next,nextCurrent]),rebuild=signature!==nextSignature;
            if(rebuild){
                signature=nextSignature;items=next;visible=new Set();list.replaceChildren();
                items.forEach((item,index)=>{
                    const row=doc.createElement('li');row.className='course-wheel-row';row.id=`course-wheel-option-${index}`;row.dataset.wheelIndex=String(index);
                    row.setAttribute('role','option');row.setAttribute('aria-selected','false');row.setAttribute('aria-setsize',String(items.length));row.setAttribute('aria-posinset',String(index+1));
                    const badge=doc.createElement('span');badge.className='course-preview-badge';badge.textContent=item.id===nextCurrent?'当前':'';
                    const body=doc.createElement('div');body.className='course-preview-body';
                    const title=doc.createElement('strong');title.textContent=item.title;title.title=item.title;
                    const detail=doc.createElement('span');detail.className='course-preview-detail';detail.textContent=[item.detail,item.progress].filter(Boolean).join(' · ');detail.title=detail.textContent;
                    body.append(title,detail);row.append(badge,body);list.append(row);
                });
            }
            scope=nextScope;currentId=nextCurrent;
            if(reset)wheelUntil=0;
            selected=reset?Math.max(0,items.findIndex(item=>item.id===currentId)):Math.max(0,items.findIndex(item=>item.id===oldId));
            list.parentElement.hidden=!items.length;list.setAttribute('aria-disabled',String(!items.length));
            if(list.clientHeight)list.style.setProperty('--wheel-edge',`${Math.max(0,(list.clientHeight-rowHeight)/2)}px`);
            if(reset||selected!==oldIndex)center(selected);else if(rebuild)list.scrollTop=oldScroll;
            if(!items.length)list.removeAttribute('aria-activedescendant');
            paint();
        }};
    }
    function initCourseRunPreview(doc,view,queue) {
        const s=view.shadow,empty=s.getElementById('course-preview-empty');
        const selection=s.getElementById('course-queue-selection'),choices=s.getElementById('course-queue-choices'),all=s.getElementById('course-queue-all');
        const wheel=createCourseWheel(doc,view);
        let choiceSignature='',resultPhase='';
        all.onchange=event=>{
            if(!queue?.list||queue.active||!trustedAssistantActivation(event,all,'change'))return;
            for(const item of courseListSnapshot()?.items||[])if(courseListItemSelectable(item)){if(all.checked)queue.selected.add(item.key);else queue.selected.delete(item.key);}
            render();doc.dispatchEvent(new Event('cx-ai-course-queue-update'));
        };
        s.getElementById('course-preview-select').onclick=()=>{switchChapterView('queue');selection.open=true;selection.querySelector('summary').focus();};
        const labels={waiting:'等待中',running:'正在学习',completed:'任务点已完成','no-tasks':'无需刷课',pending:'本轮已处理，仍有待办','waiting-unlock':'待解锁',skipped:'已跳过',failed:'待重试'};
        const chapterLabels={running:'正在学习',already:'已完成',done:'已完成','no-tasks':'无任务点',skipped:'已跳过','timed-out':'已超时','manual-pending':'需人工处理','waiting-unlock':'待解锁','navigation-unknown':'入口未确认',stopped:'已停止'};
        function render() {
            const mode=queue?.list,record=queue?.record,snapshot=queue?.list?courseListSnapshot():null;
            s.getElementById('course-mode-badge').hidden=!queue?.active||queue.list;
            selection.hidden=!queue?.list;
            if(queue?.list) {
                const items=snapshot?.items||[],locked=queue.active;
                if(snapshot?.ready&&!locked)for(const key of queue.selected)if(!items.some(item=>item.key===key&&courseListItemSelectable(item)))queue.selected.delete(key);
                const connectionReason=doc.documentElement.dataset.cxCourseListReason||'正在加载课程…';
                const signature=JSON.stringify([items,locked,[...queue.selected],snapshot?.ready?'':[doc.documentElement.dataset.cxCourseListConnection,connectionReason]]);
                if(signature!==choiceSignature) {
                    choiceSignature=signature;choices.replaceChildren();
                    if(!snapshot?.ready&&!items.length) {
                        const status=doc.createElement('div');status.className='course-choice-empty';status.setAttribute('role','status');status.textContent=connectionReason;
                        if(doc.documentElement.dataset.cxCourseListConnection==='error') {
                            const retry=doc.createElement('button');retry.type='button';retry.className='secondary';retry.textContent='重新连接';
                            retry.onclick=event=>{if(trustedAssistantActivation(event,retry)&&!courseListParent?.cancel)mountCourseListBridge(doc,true);};
                            status.append(retry);
                        } else {
                            status.classList.add('is-loading');status.setAttribute('aria-busy','true');
                            const bar=doc.createElement('span');bar.className='course-list-loading';bar.setAttribute('role','progressbar');bar.setAttribute('aria-label','正在连接课程列表');status.append(bar);
                        }
                        choices.append(status);
                    }
                    for(const item of items) {
                        const label=doc.createElement('label');label.className='course-choice';
                        const check=doc.createElement('input');check.type='checkbox';check.checked=queue.selected.has(item.key);
                        setAssistantControlDisabled(check,locked||!courseListItemSelectable(item),locked?'课程队列运行中，请停止后修改选择':item.ended?'课程已结束':'无任务点');
                        const title=doc.createElement('span');title.className='course-choice-title';
                        title.textContent=items.filter(other=>other.title===item.title).length>1?`${item.title} · 班级 ${item.identity.classroom}`:item.title;title.title=title.textContent;
                        const detail=doc.createElement('span');detail.className='course-choice-progress';
                        if(!item.ended&&item.total>0) {
                            const complete=item.completed===item.total,percent=complete?100:Math.min(99,Math.floor(item.completed*100/item.total)),bar=doc.createElement('progress');
                            bar.max=item.total;bar.value=item.completed;bar.setAttribute('aria-label',`${item.title}：${item.completed}/${item.total} 任务点`);
                            if(complete)detail.classList.add('is-complete');
                            const value=doc.createElement('span');value.textContent=`${percent}%`;
                            detail.title=`${item.completed}/${item.total} 任务点`;detail.append(bar,value);
                        } else {
                            detail.classList.add('is-text');detail.textContent=item.ended?'已结束':'无任务点';
                        }
                        check.onchange=event=>{
                            if(queue.active||!courseListItemSelectable(item)||!trustedAssistantActivation(event,check,'change'))return;
                            if(check.checked)queue.selected.add(item.key);else queue.selected.delete(item.key);
                            render();doc.dispatchEvent(new Event('cx-ai-course-queue-update'));
                        };
                        label.append(check,title,detail);choices.append(label);
                    }
                }
                const eligible=items.filter(courseListItemSelectable),count=eligible.filter(item=>queue.selected.has(item.key)).length;
                s.getElementById('course-queue-selection-count').textContent=`已选 ${count} 门`;
                all.checked=eligible.length>0&&count===eligible.length;all.indeterminate=count>0&&count<eligible.length;
                setAssistantControlDisabled(all,locked||!eligible.length,locked?'课程队列运行中，请停止后修改选择':snapshot?.ready?'当前暂无可选择的课程':connectionReason);
            }
            let cards=[],emptyCourse=false,wheelScope='',wheelCurrent=null;
            if(mode) {
                let items=queue.active?record.items:snapshot?.items.filter(item=>queue.selected.has(item.key))||[];
                if(!items.length&&record?.phase==='done')items=record.items;
                wheelScope=`courses:${record?.id||'selection'}`;wheelCurrent=queue.active?record.items[record.index]?.key:items[0]?.key;
                if(record?.phase==='done'&&items===record.items)wheelCurrent=items[items.length-1]?.key;
                cards=items.map(item=>({id:item.key,title:item.title,
                    detail:queue.active&&item.key===wheelCurrent?(record.phase==='running'?'正在学习':record.message):labels[item.status]||'等待中',
                    progress:item.total!==null?`${item.completed}/${item.total} 任务点`:''}));
            } else {
                const catalog=readCourseCatalog(doc),entries=catalog?.entries.filter(item=>!item.isGroup)||[],owner=studyOwnerDocument(doc);
                emptyCourse=catalog?.empty===true;
                const stored=owner&&courseScoreKey(owner)?get(`cx_course_run:${courseScoreKey(owner)}`,null):null;
                const running=courseRunActive(doc),lease=owner?.getElementById('cx-ai-course-lease'),currentId=lease?.getAttribute('data-chapter-id');
                let index=0;
                if(running)index=Math.max(0,entries.findIndex(item=>item.id===(currentId||entries.find(entry=>entry.active)?.id)));
                else if(!s.getElementById('course-from-current').disabled&&s.getElementById('course-from-current').checked)index=Math.max(0,entries.findIndex(item=>item.active));
                else if(s.getElementById('course-skip-learned').checked){const pending=entries.findIndex(item=>item.completed!==true&&item.pending!==0);index=pending<0?Math.max(0,entries.length-1):pending;}
                const sameRun=running&&stored?.ownerId===lease?.getAttribute('data-run-id');
                const selected=sameRun&&Array.isArray(stored.queue)?stored.queue.map(item=>entries.find(entry=>entry.id===item.id)).filter(Boolean)
                    :entries.slice(index).filter((item,i)=>i===0||!s.getElementById('course-skip-learned').checked||item.completed!==true&&item.pending!==0);
                wheelScope=`chapters:${catalog?.scopeKey||owner?.URL||doc.URL}`;wheelCurrent=running?currentId||selected[0]?.id:selected[0]?.id;
                cards=selected.map(item=>{
                    const chapter=sameRun?stored.report?.chapters?.find(entry=>entry.id===item.id):null;
                    return {id:item.id,title:`${item.number} ${item.title}`.trim(),detail:chapterLabels[chapter?.status]||catalogStatus(item),progress:''};
                });
            }
            wheel.update(cards,wheelScope,wheelCurrent);
            empty.hidden=cards.length>0;s.getElementById('course-preview-select').hidden=!queue?.list||!snapshot?.ready;
            const connecting=Boolean(queue?.list&&!snapshot?.ready&&doc.documentElement.dataset.cxCourseListConnection!=='error');
            s.getElementById('course-list-loading').hidden=!connecting;
            empty.setAttribute('aria-busy',String(connecting));
            s.getElementById('course-preview-empty-text').textContent=queue?.list?(snapshot?.ready?'选择本次课程':doc.documentElement.dataset.cxCourseListReason||'课程列表加载中…'):emptyCourse?'暂无章节，无需刷课':'章节目录加载中…';
            s.getElementById('course-preview-scope').textContent=mode?`课程队列${queue.active?` · ${Math.min(record.index+1,record.items.length)}/${record.items.length}`:''}`:'本课程';
            const results=s.getElementById('course-queue-results');results.hidden=!queue?.list||!record;
            results.dataset.queuePhase=record?.phase||'';
            if(!results.hidden) {
                if(resultPhase!==record.phase&&['done','stopped'].includes(record.phase))results.open=true;
                resultPhase=record.phase;
                const body=s.getElementById('course-queue-result-list'),details=record.items.map(item=>`${item.title} · ${labels[item.status]||'等待中'}${item.reason?'：'+item.reason:''}${item.report?'\n'+courseReportText(item.report):''}`).join('\n\n');
                const text=(record.phase==='stopped'&&record.message?`队列已停止：${record.message}\n\n`:'')+details;
                if(body.textContent!==text)body.textContent=text;
            }
        }
        const help=s.getElementById('course-speed-help'),tip=s.getElementById('course-speed-tooltip');
        let shown=false;
        const hide=()=>{if(shown)tip.hidePopover();shown=false;tip.hidden=true;};
        const show=()=>{
            if(typeof tip.showPopover!=='function'){help.title=tip.textContent;return;}
            if(shown)return;
            const panel=s.getElementById('panel').getBoundingClientRect();tip.style.maxWidth=`${Math.max(80,panel.width-16)}px`;
            tip.hidden=false;tip.showPopover();shown=true;
            const box=tip.getBoundingClientRect(),button=help.getBoundingClientRect();
            tip.style.left=`${Math.max(panel.left+8,Math.min(button.left,panel.right-box.width-8))}px`;
            tip.style.top=`${Math.max(panel.top+8,Math.min(button.bottom+7,panel.bottom-box.height-8))}px`;
        };
        help.addEventListener('pointerenter',show);help.addEventListener('pointerleave',hide);help.addEventListener('focus',show);help.addEventListener('blur',hide);
        help.onclick=event=>{event.preventDefault();show();};
        s.addEventListener('scroll',hide,true);s.addEventListener('keydown',event=>{if(event.key==='Escape')hide();});
        s.addEventListener('click',event=>{if(event.target.closest('#close,#minimize,[data-panel-view],[data-chapter-view]'))hide();});
        doc.defaultView.addEventListener('resize',hide);doc.defaultView.addEventListener('pagehide',hide,{once:true});
        view.renderCoursePreview=render;render();return render;
    }
