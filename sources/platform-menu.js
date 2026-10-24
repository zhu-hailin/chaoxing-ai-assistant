    // Platform menu adaptation: read current native nodes; never build navigation URLs.
    const COURSE_MENU_HIDDEN_KEY='cx_course_hidden_menus',PERSONAL_COURSE_DEFAULT_KEY='cx_personal_default_course';
    const COURSE_MENU_HIDE_ATTRIBUTE='data-cx-ai-menu-hidden';
    function platformMenuPage(doc,kind) {
        if(doc.defaultView!==doc.defaultView?.top)return null;
        const url=pageURL(doc);if(!url)return null;
        if(kind==='personal')return url.origin==='https://i.chaoxing.com'&&['/','/base'].includes(url.pathname)?'personal':null;
        if(!isCourseHomeURL(url)&&!isCourseStudyURL(url))return null;
        const identity=courseURLContext(url);
        return !identity.conflict&&identity.course&&identity.classroom
            ?JSON.stringify([url.origin,url.pathname,identity.course,identity.classroom,identity.student]):null;
    }
    function platformMenuLabel(node) {
        const copy=node.cloneNode(true);
        for(const child of copy.querySelectorAll('script,style,svg,img,i,.badge,.count,.num,[aria-hidden="true"]'))child.remove();
        return clean(copy.textContent).replace(/\s+[（(]?\d+[）)]?$/,'').trim();
    }
    function platformMenuVisible(node,managed) {
        for(let current=node;current;current=current.parentElement){
            if(current.hidden||current.getAttribute('aria-hidden')==='true'||current.style.display==='none')return false;
            const style=current.ownerDocument.defaultView.getComputedStyle(current);
            if(style.visibility==='hidden'||style.display==='none'&&!managed.has(current))return false;
        }
        return true;
    }
    function platformMenuIcon(target) {
        const doc=target.ownerDocument,view=doc.defaultView;
        const visual=style=>{
            const snapshot=Object.fromEntries(['width','height','boxSizing','paddingTop','paddingRight','paddingBottom','paddingLeft','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderTopStyle','borderRightStyle','borderBottomStyle','borderLeftStyle','backgroundImage','backgroundSize','backgroundPosition','backgroundRepeat','backgroundOrigin','backgroundClip','maskImage','maskSize','maskPosition','maskRepeat','maskOrigin','maskClip','backgroundColor','color','fontFamily','fontSize','fontWeight','fontStyle','lineHeight','borderRadius','opacity','objectFit','objectPosition'].map(key=>[key,style[key]]));
            // Sprite percentages depend on the original painting box. Scale the whole box only after cropping.
            const px=key=>parseFloat(snapshot[key])||0;
            for(const [axis,edges] of [['width',['Left','Right']],['height',['Top','Bottom']]]){
                if(px(axis)<=0)snapshot[axis]=`${Math.max(20,px('fontSize'))}px`;
                const extra=snapshot.boxSizing==='border-box'?0:edges.reduce((sum,edge)=>sum+px('padding'+edge)+px('border'+edge+'Width'),0);
                snapshot[axis==='width'?'viewportWidth':'viewportHeight']=px(axis)+extra;
            }
            return snapshot;
        };
        for(const node of [target,...target.querySelectorAll('img,svg,i,span,em')].slice(0,32)){
            const style=view.getComputedStyle(node);
            if(style.display==='none'||style.visibility==='hidden')continue;
            if(node.localName==='img')return {kind:'image',src:node.currentSrc||node.src,style:visual(style)};
            if(node.localName==='svg'){
                // Rebuild geometry only; page events, foreign content and external references stay outside the assistant.
                const shapes=new Set(['svg','g','symbol','path','rect','circle','ellipse','line','polyline','polygon','use']);
                const attributes=['viewBox','d','x','y','x1','x2','y1','y2','width','height','rx','ry','r','cx','cy','points','transform','fill','stroke','stroke-width','fill-rule','clip-rule','stroke-linecap','stroke-linejoin','opacity'];
                const copy=(source,depth=0)=>{
                    if(depth>12||!shapes.has(source.localName))return null;
                    if(source.localName==='use'){
                        const href=source.getAttribute('href')||source.getAttribute('xlink:href');
                        return href?.startsWith('#')&&doc.getElementById(href.slice(1))?copy(doc.getElementById(href.slice(1)),depth+1):null;
                    }
                    const result=doc.createElementNS('http://www.w3.org/2000/svg',source.localName==='symbol'?'svg':source.localName);
                    for(const name of attributes){const value=source.getAttribute(name);if(value!==null&&!/url\s*\(/i.test(value))result.setAttribute(name,value);}
                    for(const child of source.children){const shape=copy(child,depth+1);if(shape)result.append(shape);}
                    return result;
                };
                const svg=copy(node);if(svg)return {kind:'svg',markup:new XMLSerializer().serializeToString(svg),color:style.color};
            }
            if(style.backgroundImage!=='none'||style.maskImage&&style.maskImage!=='none')return {kind:'css',style:visual(style)};
            for(const pseudo of ['::before','::after']){
                const css=view.getComputedStyle(node,pseudo),content=css.content;
                if(!content||['none','normal'].includes(content))continue;
                const image=/^url\(["']?(.*?)["']?\)$/.exec(content);
                if(image)return {kind:'image',src:image[1]};
                if(css.backgroundImage!=='none'||css.maskImage&&css.maskImage!=='none'||node!==target&&/^["'][^"']{1,4}["']$/.test(content)){
                    return {kind:'css',style:visual(css),text:/^["'].*["']$/.test(content)?content.slice(1,-1):''};
                }
            }
            if(node.localName==='i'&&clean(node.textContent).length>0&&clean(node.textContent).length<=4)return {kind:'css',style:visual(style),text:clean(node.textContent)};
        }
        return null;
    }
    function renderPlatformMenuIcon(holder,icon) {
        holder.replaceChildren();if(!icon)return;
        const doc=holder.ownerDocument;let visual;
        if(icon.kind==='image'){visual=doc.createElement('img');visual.src=icon.src;visual.alt='';}
        else if(icon.kind==='svg'){
            visual=doc.importNode(new DOMParser().parseFromString(icon.markup,'image/svg+xml').documentElement,true);visual.style.color=icon.color;
        }else{
            visual=doc.createElement('span');visual.textContent=icon.text||'';
        }
        const {viewportWidth=20,viewportHeight=20,...style}=icon.style||{};
        Object.assign(visual.style,style);visual.style.display='block';visual.style.flex='none';visual.style.margin='0';
        if(icon.text){visual.style.display='grid';visual.style.placeItems='center';visual.style.lineHeight='1';}
        const frame=doc.createElement('span');frame.className='course-menu-icon-frame';
        frame.style.width=`${viewportWidth}px`;frame.style.height=`${viewportHeight}px`;
        frame.style.transform=`translate(-50%,-50%) scale(${Math.min(20/viewportWidth,20/viewportHeight)})`;
        visual.setAttribute('aria-hidden','true');frame.append(visual);holder.append(frame);
    }
    function readPlatformMenu(doc,kind,managed=new Map()) {
        const scope=platformMenuPage(doc,kind);if(!scope||!doc.body)return {scope,items:[]};
        const seeds=new Set(kind==='course'?['章节','任务','讨论','作业','考试','资料','学习记录']:['首页','课程','常用','应用中心','考试系统']);
        const roots=new Set(doc.querySelectorAll('.stuNavigationList > ul,#boxscrollleft ul,aside ul,nav ul,[role="navigation"] ul,[role="menu"],[id*="left" i] ul,[class*="sidebar" i] ul'));
        // Fallback for schools with different wrapper classes; labels only locate a navigation group.
        for(const node of doc.querySelectorAll('a,button,li,span,div,p')){
            if(!seeds.has(clean(node.textContent))||[...node.children].some(child=>seeds.has(clean(child.textContent))))continue;
            const box=node.getBoundingClientRect();if(box.left>doc.documentElement.clientWidth*.35)continue;
            for(let parent=node.parentElement,depth=0;parent&&depth<5&&!parent.matches('body,html');parent=parent.parentElement,depth++)roots.add(parent);
        }
        const candidates=[];
        for(const root of roots){
            if(root.closest('[id^="cx-ai-"]')||root.querySelector('.chapter_item,#coursetree'))continue;
            const box=root.getBoundingClientRect();
            if(box.width<=0||box.right<=0||box.left>doc.documentElement.clientWidth*.35||box.width>Math.max(360,doc.documentElement.clientWidth*.4))continue;
            const rows=[...root.children];if(rows.length<2||rows.length>60)continue;
            const items=[];
            for(const row of rows){
                if(row.matches('script,style,iframe')||row.querySelector('ul,ol')||!platformMenuVisible(row,managed))continue;
                const target=row.matches('a,button,[role="menuitem"],[role="tab"]')?row
                    :row.querySelector('a,button,[role="menuitem"],[role="tab"]')||(row.hasAttribute('onclick')?row:null);
                if(!target||!platformMenuVisible(target,managed))continue;
                const label=platformMenuLabel(target);if(!label||label.length>40)continue;
                let route='';try{const raw=target.getAttribute('data-url')||row.getAttribute('data-url')||target.getAttribute('href');if(raw){const url=new URL(raw,doc.baseURI);if(['http:','https:'].includes(url.protocol))route=url.pathname;}}catch{}
                const key=JSON.stringify([label,row.getAttribute('dataname')||target.getAttribute('dataname')||route]);
                items.push({key,label,row,target,root,disabled:row.matches('[disabled],[aria-disabled="true"]')||target.matches(':disabled,[aria-disabled="true"]')});
            }
            const known=kind==='course'&&root.closest('.stuNavigationList,#boxscrollleft'),hits=items.filter(item=>seeds.has(item.label)).length;
            if(items.length<2||!known&&hits<2)continue;
            const unique=items.filter(item=>items.filter(other=>other.key===item.key).length===1);
            if(unique.length<2)continue;
            candidates.push({scope,items:unique,score:(known?100:0)+(root.matches('ul,ol,[role="menu"]')?20:0)+hits});
        }
        candidates.sort((a,b)=>b.score-a.score);
        return candidates[0]||{scope,items:[]};
    }
    function createCourseMenuManager(doc) {
        if(!platformMenuPage(doc,'course'))return null;
        const view=doc.defaultView,panels=new Map(),managed=new Map();let items=[],scope=null,closed=false,timer=null;
        const savedHidden=()=>{const saved=get(COURSE_MENU_HIDDEN_KEY,[]);return new Set(Array.isArray(saved)?saved.filter(key=>typeof key==='string'&&key.length<400).slice(0,1000):[]);};
        let hidden=savedHidden();
        const style=doc.createElement('style');style.id='cx-ai-course-menu-style';style.textContent=`[${COURSE_MENU_HIDE_ATTRIBUTE}="true"]{display:none!important}`;
        (doc.head||doc.documentElement).append(style);
        const restore=row=>{
            if(row.getAttribute(COURSE_MENU_HIDE_ATTRIBUTE)==='true'){
                const previous=managed.get(row);if(previous===null)row.removeAttribute(COURSE_MENU_HIDE_ATTRIBUTE);else row.setAttribute(COURSE_MENU_HIDE_ATTRIBUTE,previous);
            }
            managed.delete(row);
        };
        const render=()=>{
            const busy=courseRunActive(doc)||courseQueueActive()||controller?.state.busy===true;
            for(const [shadow,state] of panels){
                if(!shadow.host.isConnected){panels.delete(shadow);continue;}
                const section=shadow.getElementById('other-course-menus'),list=shadow.getElementById('other-course-menu-list');
                section.hidden=!scope||!items.length;
                const signature=JSON.stringify([scope,items.map(item=>[item.key,item.label])]);
                if(state.signature!==signature){
                    state.signature=signature;state.controls=[];list.replaceChildren();
                    for(const item of items){
                        const key=item.key,expectedScope=scope,displayName=item.label.replace(/\s+NEW$/i,''),row=doc.createElement('div');row.className='course-menu-row';
                        const label=doc.createElement('label');label.className='check-label course-menu-toggle';label.title=`隐藏${displayName}`;
                        const check=doc.createElement('input');check.type='checkbox';check.setAttribute('aria-label',`隐藏${displayName}`);
                        label.append(check);
                        check.onchange=event=>{
                            if(!trustedAssistantActivation(event,check,'change')||platformMenuPage(doc,'course')!==expectedScope){refresh();return;}
                            const latest=readPlatformMenu(doc,'course',managed).items.find(entry=>entry.key===key);
                            if(!latest||latest.disabled){refresh();return;}
                            const next=savedHidden();if(check.checked)next.add(key);else next.delete(key);
                            set(COURSE_MENU_HIDDEN_KEY,[...next]);refresh();
                        };
                        const open=doc.createElement('button');open.type='button';open.className='course-menu-link';open.setAttribute('aria-label',`打开${displayName}`);
                        const icon=doc.createElement('span');icon.className='course-menu-icon';icon.setAttribute('aria-hidden','true');
                        const name=doc.createElement('span');name.className='course-menu-name';name.textContent=displayName;open.title=displayName;open.append(icon,name);
                        open.onclick=event=>{
                            if(!trustedAssistantActivation(event,open)||platformMenuPage(doc,'course')!==expectedScope)return;
                            if(courseRunActive(doc)||courseQueueActive()||controller?.state.busy)return;
                            const latest=readPlatformMenu(doc,'course',managed).items.find(entry=>entry.key===key);
                            if(!latest||latest.disabled){refresh();return;}
                            latest.target.click();
                        };
                        row.append(label,open);list.append(row);state.controls.push({key,check,open,icon,iconSignature:''});
                    }
                }
                for(const control of state.controls){
                    const item=items.find(entry=>entry.key===control.key);control.check.checked=hidden.has(control.key);
                    if(item){const signature=JSON.stringify(item.icon);if(control.iconSignature!==signature){control.iconSignature=signature;renderPlatformMenuIcon(control.icon,item.icon);}}
                    setAssistantControlDisabled(control.check,Boolean(item?.disabled),'平台当前未开放此菜单');
                    setAssistantControlDisabled(control.open,busy||!item||item.disabled,busy?'任务进行中，请结束后切换课程菜单':'平台当前未开放此菜单');
                }
            }
        };
        const refresh=()=>{
            if(closed)return;
            hidden=savedHidden();const current=readPlatformMenu(doc,'course',managed);scope=current.scope;items=current.items.map(item=>({...item,icon:platformMenuIcon(item.target)}));
            const desired=new Set(items.filter(item=>hidden.has(item.key)&&!item.disabled).map(item=>item.row));
            for(const row of [...managed.keys()])if(!desired.has(row))restore(row);
            for(const row of desired){if(!managed.has(row))managed.set(row,row.getAttribute(COURSE_MENU_HIDE_ATTRIBUTE));if(row.getAttribute(COURSE_MENU_HIDE_ATTRIBUTE)!=='true')row.setAttribute(COURSE_MENU_HIDE_ATTRIBUTE,'true');}
            render();
        };
        const schedule=()=>{if(closed)return;view.clearTimeout(timer);timer=view.setTimeout(refresh,120);};
        const observer=new view.MutationObserver(records=>{if(records.some(record=>!record.target.parentElement?.closest('[id^="cx-ai-"]')&&!record.target.closest?.('[id^="cx-ai-"]')))schedule();});
        observer.observe(doc.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','id','href','src','srcset','data-url','dataname','hidden','aria-hidden','aria-disabled','disabled','style']});
        doc.addEventListener('load',schedule,true);
        const listener=GM_addValueChangeListener(COURSE_MENU_HIDDEN_KEY,refresh);
        view.addEventListener('popstate',schedule);view.addEventListener('resize',schedule);
        return {render,bind(shadow){if(!panels.has(shadow))panels.set(shadow,{signature:'',controls:[]});refresh();},close(){
            if(closed)return;closed=true;observer.disconnect();view.clearTimeout(timer);GM_removeValueChangeListener(listener);
            view.removeEventListener('popstate',schedule);view.removeEventListener('resize',schedule);
            doc.removeEventListener('load',schedule,true);
            for(const row of [...managed.keys()])restore(row);style.remove();panels.clear();
        }};
    }
    function personalCourseMenuEntry(doc) {
        const entries=readPlatformMenu(doc,'personal').items.filter(item=>item.label.replace(/\s+NEW$/i,'')==='课程'&&!item.disabled);
        if(entries.length===1)return entries[0].target;
        // Personal-space skins may use href-less anchors and delegated li handlers.
        const candidates=new Set();
        for(const node of doc.querySelectorAll('a,button,li,[role="menuitem"],[role="tab"],span')){
            if(platformMenuLabel(node).replace(/\s+NEW$/i,'')!=='课程')continue;
            const target=node.closest('a,button,[role="menuitem"],[role="tab"],[onclick]')||node.closest('li');
            if(!target||!target.closest('ul,nav,aside,[role="navigation"],[role="menu"],[class*="nav" i],[class*="side" i]')
                ||target.closest('[id^="cx-ai-"]')||target.matches(':disabled,[aria-disabled="true"]')||target.closest('[aria-disabled="true"],[disabled]')||!platformMenuVisible(target,new Map()))continue;
            const box=target.getBoundingClientRect();
            if(box.width>0&&box.height>0&&box.right>0&&box.left<doc.documentElement.clientWidth*.35)candidates.add(target);
        }
        const targets=[...candidates].filter(target=>![...candidates].some(other=>other!==target&&target.contains(other)));
        return targets.length===1?targets[0]:null;
    }
    function createPersonalCourseDefault(doc,{restored=false}={}) {
        if(!platformMenuPage(doc,'personal'))return null;
        const view=doc.defaultView,panels=new Set();let closed=false,timer=null,until=Date.now()+15000,clicked=false,done=false;
        const armed=!restored&&get(PERSONAL_COURSE_DEFAULT_KEY,false)===true;
        let status=armed?'等待课程菜单就绪':'开启后，下次访问个人空间生效';
        const render=()=>{
            doc.documentElement.dataset.cxDefaultCourseStatus=status;
            for(const shadow of panels){
                if(!shadow.host.isConnected){panels.delete(shadow);continue;}
                shadow.getElementById('other-default-course').hidden=!platformMenuPage(doc,'personal');
                shadow.getElementById('other-default-course-enabled').checked=get(PERSONAL_COURSE_DEFAULT_KEY,false)===true;
                shadow.getElementById('other-default-course-status').textContent=status;
            }
        };
        const courseVisible=()=>{
            const frame=doc.getElementById('frame_content');
            try{return Boolean(frame?.isConnected&&isCourseListFrameURL(new URL(frame.getAttribute('src'),doc.baseURI)));}catch{return false;}
        };
        const stop=message=>{done=true;status=message;view.clearTimeout(timer);render();};
        const attempt=()=>{
            timer=null;if(closed||done||!armed)return;
            if(get(PERSONAL_COURSE_DEFAULT_KEY,false)!==true){stop('已关闭默认打开课程');return;}
            if(!platformMenuPage(doc,'personal')){stop('页面已切换');return;}
            if(courseVisible()){stop('当前已打开课程菜单');return;}
            if(Date.now()>until){stop(clicked?'课程菜单未确认打开，请手动点击':'未识别到课程菜单，请手动打开');return;}
            if(!clicked&&doc.readyState!=='loading'&&doc.getElementById('frame_content')){
                const target=personalCourseMenuEntry(doc);
                if(target){clicked=true;status='正在打开课程菜单';target.click();render();}
            }
            if(!done&&!closed)timer=view.setTimeout(attempt,300);
        };
        const manual=event=>{
            if(!armed||done||event.isTrusted!==true||event.type==='keydown'&&!['Enter',' '].includes(event.key))return;
            if(event.target.closest?.('[id^="cx-ai-"]'))return;
            const menu=readPlatformMenu(doc,'personal'),target=event.target.closest?.('a,button,[role="menuitem"],[role="tab"],[onclick],li');
            if(menu.items.some(item=>item.row.contains(event.target))||target&&target.closest('nav,aside,[role="navigation"],[role="menu"],[class*="nav" i],[class*="side" i]')&&target.getBoundingClientRect().left<doc.documentElement.clientWidth*.35)stop('已按你的手动选择保留当前栏目');
        };
        doc.addEventListener('pointerdown',manual,true);doc.addEventListener('keydown',manual,true);
        const listener=GM_addValueChangeListener(PERSONAL_COURSE_DEFAULT_KEY,()=>{if(get(PERSONAL_COURSE_DEFAULT_KEY,false)!==true&&!done)stop('已关闭默认打开课程');else render();});
        if(armed)timer=view.setTimeout(attempt,250);
        return {render,bind(shadow){if(panels.has(shadow))return;panels.add(shadow);
            const check=shadow.getElementById('other-default-course-enabled');
            check.onchange=event=>{
                if(!trustedAssistantActivation(event,check,'change')){render();return;}
                set(PERSONAL_COURSE_DEFAULT_KEY,check.checked);status=check.checked?'下次访问个人空间时默认打开课程':'已关闭默认打开课程';
                if(!check.checked){done=true;view.clearTimeout(timer);}render();
            };render();
        },close(){if(closed)return;closed=true;view.clearTimeout(timer);GM_removeValueChangeListener(listener);doc.removeEventListener('pointerdown',manual,true);doc.removeEventListener('keydown',manual,true);panels.clear();}};
    }
