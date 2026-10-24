    // 只解释现有禁用状态，不改变控件权限和业务操作。
    function setAssistantControlDisabled(control, disabled, reason = '当前状态下暂不可用') {
        if (control.disabled !== Boolean(disabled)) control.disabled = Boolean(disabled);
        if (control.getAttribute('aria-disabled') !== String(control.disabled)) control.setAttribute('aria-disabled', String(control.disabled));
        if (control.disabled) {
            if (control.dataset.disabledReason !== reason) control.dataset.disabledReason = reason;
            if (control.getAttribute('aria-description') !== reason) control.setAttribute('aria-description', reason);
        } else {
            delete control.dataset.disabledReason;
            control.removeAttribute('aria-description');
        }
    }
    const assistantControlFeedback = new WeakMap();
    function initAssistantControlFeedback(shadow) {
        if (assistantControlFeedback.has(shadow)) return;
        const doc = shadow.host.ownerDocument;
        const style = doc.createElement('style');
        style.textContent = `
          :is(button,input,select,textarea):disabled,[aria-disabled="true"]{cursor:not-allowed}
          :is(button,input,select,textarea):disabled,:is(button,input,select,textarea):disabled *,[role="option"][aria-disabled="true"]{pointer-events:none}
          input:disabled,select:disabled,textarea:disabled{opacity:.55}
          label:has(input:disabled),label:has(select:disabled){cursor:not-allowed;color:#8994a5}
          .cx-disabled-cursor{cursor:not-allowed!important}
          .cx-control-feedback{position:fixed;inset:auto;margin:0;padding:7px 10px;width:max-content;max-width:min(280px,calc(100vw - 24px));box-sizing:border-box;border:1px solid #dce3ed;border-radius:6px;background:#fff;color:#526279;box-shadow:0 4px 16px #172b4a18;font:12px/1.6 "Microsoft YaHei",sans-serif;overflow-wrap:anywhere;pointer-events:none}
          .cx-control-feedback::backdrop{background:transparent;pointer-events:none}
        `;
        const tip = doc.createElement('span');
        tip.className = 'cx-control-feedback'; tip.setAttribute('popover','manual'); tip.hidden = true;
        tip.setAttribute('role','status'); tip.setAttribute('aria-live','polite');
        shadow.append(style, tip);
        const selector = 'button:disabled,input:disabled,select:disabled,textarea:disabled,[aria-disabled="true"]';
        let current = null, timer = null, cursor = null, outsideDoc = null, shown = false, fallbackTitles = [];
        const hide = () => {
            clearTimeout(timer); timer = null;
            if (shown) tip.hidePopover(); shown = false; tip.hidden = true;
            tip.textContent = ''; current = null;
            cursor?.classList.remove('cx-disabled-cursor'); cursor = null;
            outsideDoc?.removeEventListener('pointerdown', outside, true);
            outsideDoc?.removeEventListener('scroll',hide,true);
            outsideDoc?.defaultView?.removeEventListener('resize',hide); outsideDoc = null;
            for(const [node,title] of fallbackTitles) { if(title===null)node.removeAttribute('title');else node.setAttribute('title',title); }
            fallbackTitles = [];
        };
        const outside = event => { if (!event.composedPath().includes(shadow.host)) hide(); };
        const disabled = node => node?.matches?.(selector);
        const locate = event => {
            const path = event.composedPath();
            const direct = path.find(disabled);
            if (direct) return direct;
            const label = path.find(node => node.tagName === 'LABEL');
            if (disabled(label?.control)) return label.control;
            // 原生 disabled 不派发 click；不包裹/重排控件，按真实命中区域给出反馈。
            const target = event.target;
            if (!target?.querySelectorAll || !Number.isFinite(event.clientX)) return null;
            return [...target.querySelectorAll(selector)].reverse().find(node => {
                const rect = node.getBoundingClientRect();
                if (!rect.width || !rect.height || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return false;
                // 被滚动容器裁掉的控件不能拦截当前可见位置。
                for (let parent = node.parentElement; parent && parent !== target; parent = parent.parentElement) {
                    const css = node.ownerDocument.defaultView.getComputedStyle(parent), bounds = parent.getBoundingClientRect();
                    if (/(auto|scroll|hidden|clip)/.test(css.overflowX) && (event.clientX < bounds.left || event.clientX > bounds.right)) return false;
                    if (/(auto|scroll|hidden|clip)/.test(css.overflowY) && (event.clientY < bounds.top || event.clientY > bounds.bottom)) return false;
                }
                return true;
            });
        };
        const show = (control, event, pressed = false) => {
            if (current === control && !pressed) return;
            hide(); current = control;
            const reason = control.dataset.disabledReason || control.getAttribute('aria-description') || control.title || '当前状态下暂不可用';
            tip.textContent = reason;
            // 老版本浏览器沿用原生说明，不额外增加对话框。
            if (typeof tip.showPopover !== 'function') {
                for(const node of new Set([control,event.target]))if(node?.setAttribute){fallbackTitles.push([node,node.getAttribute('title')]);node.setAttribute('title',reason);}
                if(pressed)timer=setTimeout(hide,2400);return;
            }
            tip.hidden = false;
            try { tip.showPopover(); shown = true; } catch { hide(); return; }
            const view = shadow.host.ownerDocument.defaultView, rect = control.getBoundingClientRect();
            const box = tip.getBoundingClientRect();
            tip.style.left = `${Math.max(8,Math.min(rect.left,view.innerWidth-box.width-8))}px`;
            const below = rect.bottom + 7;
            tip.style.top = `${Math.max(8,Math.min(below+box.height<=view.innerHeight-8?below:rect.top-box.height-7,view.innerHeight-box.height-8))}px`;
            cursor = event.target?.classList ? event.target : null; cursor?.classList.add('cx-disabled-cursor');
            outsideDoc = shadow.host.ownerDocument; outsideDoc.addEventListener('pointerdown',outside,true);
            outsideDoc.addEventListener('scroll',hide,true); outsideDoc.defaultView.addEventListener('resize',hide);
            if (pressed) timer = setTimeout(hide,2400);
        };
        const hover = event => { const control=locate(event); if(control)show(control,event);else hide(); };
        const activate = event => {
            const control = locate(event);
            if (!control) { hide(); return; }
            event.preventDefault(); event.stopImmediatePropagation(); show(control,event,true);
        };
        shadow.addEventListener('pointermove',hover,{passive:true});
        shadow.addEventListener('pointerdown',activate,true);
        shadow.addEventListener('click',activate,true);
        shadow.addEventListener('focusin',hover);
        shadow.addEventListener('focusout',hide);
        shadow.host.addEventListener('pointerleave',hide);
        shadow.addEventListener('scroll',hide,true);
        shadow.addEventListener('keydown',hide,true);
        const observer = new doc.defaultView.MutationObserver(() => {
            if(current && (!current.isConnected || !disabled(current) || !current.getClientRects().length || current.closest('[hidden]') || current.dataset.disabledReason && current.dataset.disabledReason!==tip.textContent))hide();
        });
        observer.observe(shadow,{subtree:true,childList:true,attributes:true,attributeFilter:['disabled','aria-disabled','data-disabled-reason','hidden']});
        assistantControlFeedback.set(shadow,hide);
        window.addEventListener('pagehide',() => { hide(); observer.disconnect(); },{once:true});
    }
    function clearAssistantControlFeedback() {
        for (const shadow of [panelView?.shadow, toolbarView?.shadow, credentialView?.shadow]) assistantControlFeedback.get(shadow)?.();
    }
