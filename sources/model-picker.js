    // 原生 select 仍负责值、禁用状态与 change 通知；可见列表使用官方标识。
    const brandedModelPickers = new WeakMap();
    function refreshBrandedModelPickers(shadow) {
        const provider = getModelProvider(shadow.getElementById('provider').value);
        for (const id of ['provider', 'model', 'info-model']) {
            const select = shadow.getElementById(id);
            let picker = brandedModelPickers.get(select);
            if (!picker) {
                picker = createBrandedModelPicker(select, shadow);
                brandedModelPickers.set(select, picker);
            }
            picker.refresh(provider);
        }
    }
    function createBrandedModelPicker(select, shadow) {
        const doc = select.ownerDocument, id = select.id;
        const label = shadow.querySelector(`label[for="${id}"]`);
        const wrapper = doc.createElement('div'); wrapper.className = 'model-picker';
        const button = doc.createElement('button'); button.type = 'button'; button.id = `${id}-picker`;
        button.className = 'model-picker-trigger'; button.setAttribute('role', 'combobox');
        button.setAttribute('aria-haspopup', 'listbox'); button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', `${id}-listbox`);
        const value = doc.createElement('span'); value.id = `${id}-picker-value`; value.className = 'model-picker-value';
        const arrow = doc.createElementNS('http://www.w3.org/2000/svg','svg');
        arrow.classList.add('model-picker-arrow');arrow.setAttribute('viewBox','0 0 16 16');
        arrow.setAttribute('width','14');arrow.setAttribute('height','14');arrow.setAttribute('fill','none');
        arrow.setAttribute('stroke','currentColor');arrow.setAttribute('stroke-width','1.6');
        arrow.setAttribute('stroke-linecap','round');arrow.setAttribute('stroke-linejoin','round');
        arrow.setAttribute('aria-hidden','true');arrow.setAttribute('focusable','false');
        const chevron=doc.createElementNS('http://www.w3.org/2000/svg','path');chevron.setAttribute('d','m4 6 4 4 4-4');arrow.append(chevron);
        button.append(value, arrow);
        if (label) {
            label.id ||= `${id}-picker-label`; label.htmlFor = button.id;
            button.setAttribute('aria-labelledby', `${label.id} ${value.id}`);
        } else button.setAttribute('aria-label', select.getAttribute('aria-label') || '选择模型');
        const list = doc.createElement('div'); list.id = `${id}-listbox`; list.className = 'model-picker-list';
        list.hidden = true; list.setAttribute('role', 'listbox');
        if (label) list.setAttribute('aria-labelledby', label.id);
        select.before(wrapper); wrapper.append(select, button, list); select.hidden = true;
        let entries = [], active = -1, provider = getModelProvider(), prefix = '', prefixTime = 0;
        const opened = () => !list.hidden;
        const close = () => {
            list.hidden = true; button.setAttribute('aria-expanded', 'false');
            button.removeAttribute('aria-activedescendant'); prefix = '';
        };
        const paintActive = () => {
            for (let index = 0; index < entries.length; index++) {
                const row = list.children[index], selected = entries[index].value === select.value;
                row.setAttribute('aria-selected', String(selected)); row.classList.toggle('is-active', index === active);
            }
            if (opened() && entries[active]) {
                button.setAttribute('aria-activedescendant', list.children[active].id);
                list.children[active].scrollIntoView?.({block:'nearest'});
            }
        };
        const available = () => entries.map((entry,index) => entry.disabled ? -1 : index).filter(index => index >= 0);
        const open = () => {
            if (select.disabled || !available().length) return;
            // 一个面板内同时只展开一个模型列表。
            for (const other of shadow.querySelectorAll('.model-picker-trigger[aria-expanded="true"]')) {
                if (other !== button) other.dispatchEvent(new doc.defaultView.Event('model-picker-close'));
            }
            list.hidden = false; button.setAttribute('aria-expanded', 'true');
            active = entries.findIndex(entry => entry.value === select.value && !entry.disabled);
            if (active < 0) active = available()[0];
            paintActive();
        };
        const commit = () => {
            const entry = entries[active];
            if (select.disabled || !entry || entry.disabled) return;
            const changed = select.value !== entry.value;
            select.value = entry.value; close();
            if (changed) select.dispatchEvent(new doc.defaultView.Event('change', {bubbles:true}));
            refresh(provider); button.focus();
        };
        const move = step => {
            const indices = available(), location = indices.indexOf(active);
            active = indices[Math.min(indices.length-1, Math.max(0, location + step))]; paintActive();
        };
        const content = (node, entry) => {
            node.replaceChildren();
            const platform = id === 'provider' ? getModelProvider(entry.value) : provider;
            if (platform.id !== 'custom' && platform.logo && entry.value) {
                const image = doc.createElement('img'); image.className = 'provider-logo';
                image.src = platform.logo; image.alt = ''; image.setAttribute('aria-hidden','true');
                image.width = 24; image.height = 24; image.draggable = false; node.append(image);
            }
            const text = doc.createElement('span'); text.className = 'model-picker-text'; text.textContent = entry.label;
            node.append(text);
        };
        function refresh(currentProvider = provider) {
            provider = currentProvider;
            entries = [...select.options].filter(option => !option.hidden).map(option => ({
                value:option.value, label:option.label || option.textContent, disabled:option.disabled
            }));
            list.replaceChildren();
            for (const [index, entry] of entries.entries()) {
                const row = doc.createElement('div'); row.id = `${id}-option-${index}`;
                row.className = 'model-picker-option'; row.setAttribute('role', 'option');
                row.setAttribute('aria-disabled', String(entry.disabled)); content(row,entry);
                row.addEventListener('pointerdown', event => event.preventDefault());
                row.addEventListener('pointermove', () => {if (!entry.disabled) {active = index; paintActive();}});
                row.addEventListener('click', () => {active = index; commit();}); list.append(row);
            }
            content(value, entries.find(entry => entry.value === select.value) || {value:'',label:'请选择模型'});
            button.disabled = select.disabled;
            if (select.disabled) close();
            if (active >= entries.length) active = entries.length - 1;
            paintActive();
        }
        button.addEventListener('model-picker-close', close);
        button.addEventListener('click', () => opened() ? close() : open());
        button.addEventListener('keydown', event => {
            if (select.disabled) return;
            if (['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(event.key)) {
                event.preventDefault(); event.stopPropagation();
                if (!opened()) {open(); if (event.key === 'Home') active = available()[0]; else if (event.key === 'End') active = available().at(-1); paintActive();}
                else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') move(event.key === 'ArrowDown' ? 1 : -1);
                else if (event.key === 'Home' || event.key === 'End') {active = event.key === 'Home' ? available()[0] : available().at(-1); paintActive();}
                else commit();
            } else if (event.key === 'Escape' && opened()) {event.preventDefault(); event.stopPropagation(); close();}
            else if (event.key === 'Tab') close();
            else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                event.preventDefault();
                if (!opened()) open();
                const now = Date.now(); prefix = now - prefixTime > 700 ? event.key : prefix + event.key; prefixTime = now;
                const found = entries.findIndex(entry => !entry.disabled && entry.label.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()));
                if (found >= 0) {active = found; paintActive();}
            }
        });
        button.addEventListener('blur', event => {if (!wrapper.contains(event.relatedTarget)) close();});
        select.addEventListener('change', () => refresh(getModelProvider(shadow.getElementById('provider').value)));
        const outside = event => {if (!event.composedPath().includes(wrapper)) close();};
        doc.addEventListener('pointerdown', outside);
        const observer = new doc.defaultView.MutationObserver(() => refresh(getModelProvider(shadow.getElementById('provider').value)));
        observer.observe(select, {childList:true,subtree:true,attributes:true,attributeFilter:['disabled','selected','label','hidden']});
        doc.defaultView.addEventListener('pagehide', () => {observer.disconnect(); doc.removeEventListener('pointerdown',outside);}, {once:true});
        return {refresh};
    }
