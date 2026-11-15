    // Only public profile fields are cached, separately for each verified UID.
    const ACCOUNT_HIDE_AVATAR_KEY='cx_account_hide_avatar';
    const ACCOUNT_PROFILE_PREFIX='cx_account_profile:';
    function normalizedAssistantProfile(value) {
        const uid=String(value?.uid||'');
        if(!/^\d{1,20}$/.test(uid))return null;
        const profile={uid,fid:String(value.fid||''),roleId:String(value.roleId||''),
            name:clean(value.name).slice(0,80),school:clean(value.school).slice(0,160),role:clean(value.role).slice(0,80),
            avatar:'https://photo.chaoxing.com/p/'+uid+'_80'};
        for(const field of ['fid','roleId'])if(!/^\d{1,20}$/.test(profile[field]))profile[field]='';
        try{
            const avatar=new URL(value.avatar);
            if(avatar.origin==='https://photo.chaoxing.com'&&new RegExp('^/p/'+uid+'_(80|160)$').test(avatar.pathname))profile.avatar=avatar.origin+avatar.pathname;
        }catch{}
        return profile;
    }
    function assistantAccountIdentifiers(doc) {
        const fields={},allowed=new Set(['UID','_uid','fid','spaceFid','siteRole','spaceRoleId']);
        try {
            for(const part of doc.cookie.split(';')) {
                const index=part.indexOf('='),name=part.slice(0,index).trim();
                if(index<0||!allowed.has(name))continue;
                const value=decodeURIComponent(part.slice(index+1));
                if(/^\d{1,20}$/.test(value))fields[name]=value;
            }
        }catch{}
        return {uid:fields.UID||fields._uid||'',fid:fields.spaceFid||fields.fid||'',roleId:fields.spaceRoleId||fields.siteRole||''};
    }
    function assistantAccountProfile(doc,identity,sourceURL) {
        const result={...identity,name:'',school:'',role:'',avatar:identity.uid?`https://photo.chaoxing.com/p/${identity.uid}_80`:''};
        let source;
        try {source=new URL(sourceURL);}catch{return result;}
        if(source.origin!=='https://i.chaoxing.com'||!/^\/base\/?$/.test(source.pathname))return result;
        result.name=clean(doc.querySelector('.user-block .user-name,.user > h3')?.textContent).slice(0,80);
        const unit=clean(doc.getElementById('siteName')?.textContent).slice(0,160),parts=/^(.*?)[(（]([^()（）]+)[)）]$/.exec(unit);
        result.school=parts?parts[1].trim():unit;result.role=parts?parts[2].trim():'';
        const image=doc.querySelector('.user-block img.head-img,.user img.icon-head');
        try {
            const avatar=new URL(image?.getAttribute('src')||'',source),match=/^\/p\/(\d{1,20})_(?:80|160)$/.exec(avatar.pathname);
            if(avatar.origin==='https://photo.chaoxing.com'&&match) {
                if(identity.uid&&identity.uid!==match[1])throw new Error('当前登录账号已变化，请刷新页面');
                result.uid=match[1];result.avatar=`${avatar.origin}${avatar.pathname}`;
                const stamp=avatar.searchParams.get('temp');
                if(/^\d{1,16}$/.test(stamp||''))result.avatar+=`?temp=${stamp}`;
            }
        }catch(error){if(error.message==='当前登录账号已变化，请刷新页面')throw error;}
        return result;
    }
    function requestAssistantAccountProfile() {
        let handle;
        const promise=new Promise((resolve,reject)=>{
            handle=GM_xmlhttpRequest({method:'GET',url:'https://i.chaoxing.com/base',timeout:15000,
                onload:response=>{
                    try {
                        const url=new URL(response.finalUrl||'https://i.chaoxing.com/base');
                        if(url.origin!=='https://i.chaoxing.com'||!/^\/base\/?$/.test(url.pathname))throw new Error('请先登录学习通后重试');
                        if(response.status!==200||typeof response.responseText!=='string'||response.responseText.length>2*1024*1024)throw new Error('暂时无法读取账号资料，请重新打开重试');
                        resolve({doc:new DOMParser().parseFromString(response.responseText,'text/html'),url:url.href});
                    }catch(error){reject(error);}
                },onerror:()=>reject(new Error('暂时无法读取账号资料，请重新打开重试')),
                ontimeout:()=>reject(new Error('读取账号资料超时，请重新打开重试')),
                onabort:()=>reject(new Error('已取消读取账号资料'))});
        });
        return {promise,abort:()=>handle?.abort()};
    }
    function initAccountProfile(doc,shadow) {
        const trigger=shadow.getElementById('nav-account');
        const hideAvatar=shadow.getElementById('account-hide-avatar');
        const status=shadow.getElementById('account-status'),details=shadow.getElementById('account-details');
        const portraits=[shadow.getElementById('account-nav-image'),shadow.getElementById('account-image')];
        let pending=null,generation=0,closed=false,currentUID='',currentName='',privacyListener=null,profileListener=null,listenedUID='',rendered='';
        const syncAvatarPrivacy=()=>{
            const hidden=get(ACCOUNT_HIDE_AVATAR_KEY,false)===true,name=hidden?'':currentName;
            hideAvatar.checked=hidden;trigger.dataset.privateAvatar=String(hidden);
            trigger.setAttribute('aria-label',name?`当前账号：${name}`:'账号信息');trigger.title=name?`${name} · 账号详情`:'账号信息';
        };
        const listenAvatarPrivacy=()=>{
            if(privacyListener===null&&typeof GM_addValueChangeListener==='function')privacyListener=GM_addValueChangeListener(ACCOUNT_HIDE_AVATAR_KEY,syncAvatarPrivacy);
        };
        const render=profile=>{
            const signature=JSON.stringify(profile);
            if(signature===rendered)return;
            rendered=signature;
            const name=profile.name||'当前账号';
            currentUID=profile.uid||'';
            currentName=profile.name||'';syncAvatarPrivacy();
            shadow.getElementById('account-name').textContent=name;shadow.getElementById('account-role').textContent=profile.role;
            for(const image of portraits) {
                image.nextElementSibling.textContent=profile.name?Array.from(profile.name)[0]:'我';
                if(profile.avatar){if(image.getAttribute('src')!==profile.avatar)image.src=profile.avatar;image.hidden=false;image.nextElementSibling.hidden=true;}
                else {image.removeAttribute('src');image.hidden=true;image.nextElementSibling.hidden=false;}
            }
            details.replaceChildren();
            for(const [label,value] of [['学校／单位',profile.school],['用户 ID',profile.uid],['单位 ID',profile.fid],['角色 ID',profile.roleId]]) {
                if(!value)continue;
                const row=doc.createElement('div'),term=doc.createElement('dt'),description=doc.createElement('dd');
                term.textContent=label;description.textContent=value;row.append(term,description);details.append(row);
            }
        };
        const localProfile=()=>assistantAccountProfile(doc,assistantAccountIdentifiers(doc),pageURL(doc)?.href);
        const reset=()=>render({uid:'',fid:'',roleId:'',name:'',school:'',role:'',avatar:''});
        for(const image of portraits)image.addEventListener('error',()=>{image.hidden=true;image.nextElementSibling.hidden=false;});
        const cached=uid=>{
            const profile=uid?normalizedAssistantProfile(get(ACCOUNT_PROFILE_PREFIX+uid,null)):null;
            return profile?.uid===uid?profile:null;
        };
        const save=profile=>{
            const normalized=normalizedAssistantProfile(profile);
            if(!normalized?.name)return;
            if(JSON.stringify(cached(normalized.uid))!==JSON.stringify(normalized))set(ACCOUNT_PROFILE_PREFIX+normalized.uid,normalized);
        };
        const listenProfile=uid=>{
            if(uid===listenedUID)return;
            if(profileListener!==null&&typeof GM_removeValueChangeListener==='function')GM_removeValueChangeListener(profileListener);
            profileListener=null;listenedUID=uid;
            if(uid&&typeof GM_addValueChangeListener==='function')profileListener=GM_addValueChangeListener(ACCOUNT_PROFILE_PREFIX+uid,()=>{
                const profile=cached(uid);
                if(!closed&&profile&&assistantAccountIdentifiers(doc).uid===uid)render(profile);
            });
        };
        const updateLocal=()=>{
            const local=localProfile();
            listenProfile(local.uid);
            const saved=cached(local.uid);
            const profile=local.name?normalizedAssistantProfile(local):saved?{...saved,...(local.fid?{fid:local.fid}:{}),...(local.roleId?{roleId:local.roleId}:{})}:local;
            if(local.name||saved)save(profile);
            render(profile);return profile;
        };
        const load=async({allowRemote=false,onlyMissing=false}={})=>{
            const current=++generation;pending?.abort();pending=null;status.textContent='';
            try {
                const local=updateLocal();
                if(local.name&&(onlyMissing||pageURL(doc)?.origin==='https://i.chaoxing.com'&&pageURL(doc)?.pathname==='/base'))return;
                if(!allowRemote){status.textContent=local.name?'':'点击头像读取账号资料';return;}
                const requestedUID=assistantAccountIdentifiers(doc).uid;
                status.textContent='正在读取账号资料…';pending=requestAssistantAccountProfile();
                const source=await pending.promise;
                if(closed||current!==generation)return;
                if(assistantAccountIdentifiers(doc).uid!==requestedUID){updateLocal();status.textContent='';return;}
                const profile=assistantAccountProfile(source.doc,assistantAccountIdentifiers(doc),source.url);
                if(!profile.name||!profile.uid)throw new Error('请先登录学习通后重试');
                if(requestedUID&&profile.uid!==requestedUID)throw new Error('当前登录账号已变化，请刷新页面');
                save(profile);listenProfile(profile.uid);render(normalizedAssistantProfile(profile));status.textContent='';
            }catch(error){if(!closed&&current===generation){try{updateLocal();}catch{reset();}status.textContent=error.message;}}
            finally{if(current===generation)pending=null;}
        };
        const cancel=()=>{generation++;pending?.abort();pending=null;};
        panelView.loadAccountProfile=load;panelView.cancelAccountProfile=cancel;
        hideAvatar.onchange=event=>{
            if(!trustedAssistantActivation(event,hideAvatar,'change')){syncAvatarPrivacy();return;}
            set(ACCOUNT_HIDE_AVATAR_KEY,hideAvatar.checked);syncAvatarPrivacy();
        };
        const focus=()=>{
            try{
                const uid=assistantAccountIdentifiers(doc).uid;
                if(uid!==currentUID){cancel();void load({allowRemote:Boolean(uid),onlyMissing:true});}
                else updateLocal();
            }catch{cancel();reset();}
        };
        const profileSelector='.user-block,.user,#siteName';
        const observer=new doc.defaultView.MutationObserver(records=>{
            if(closed)return;
            const changed=records.some(record=>{
                const target=record.target.nodeType===1?record.target:record.target.parentElement;
                return target?.closest(profileSelector)||[...record.addedNodes].some(node=>node.nodeType===1&&(node.matches(profileSelector)||node.querySelector(profileSelector)));
            });
            if(changed)focus();
        });
        const observe=()=>{
            const url=pageURL(doc);
            if(url?.origin==='https://i.chaoxing.com'&&/^\/base\/?$/.test(url.pathname))
                observer.observe(doc.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['src']});
        };
        doc.defaultView.addEventListener('focus',focus);
        doc.defaultView.addEventListener('pagehide',()=>{
            closed=true;observer.disconnect();cancel();reset();
            if(typeof GM_removeValueChangeListener==='function'){
                if(privacyListener!==null)GM_removeValueChangeListener(privacyListener);
                if(profileListener!==null)GM_removeValueChangeListener(profileListener);
            }
            privacyListener=null;profileListener=null;listenedUID='';
        });
        doc.defaultView.addEventListener('pageshow',()=>{closed=false;listenAvatarPrivacy();observe();focus();});
        syncAvatarPrivacy();listenAvatarPrivacy();observe();
        void load({allowRemote:Boolean(assistantAccountIdentifiers(doc).uid),onlyMissing:true});
    }
