// Piccoli helper DOM (nessuna dipendenza). Il renderer gira sotto sandbox: solo API del browser.

/** h('div', {class:'x', onclick: fn, 'aria-label':'..', style:{..}}, ...figli) */
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') for (const [sk, sv] of Object.entries(v)) el.style.setProperty(sk, sv);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

/** SVG inline minimale da stringa di path (icone locali, 16x16). */
export function icon(paths, cls = 'ico') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = paths;
  return svg;
}

/**
 * Ricostruisce i figli del contenitore preservando focus (elementi con data-fk), caret e scroll.
 */
export function renderInto(container, build) {
  const active = document.activeElement;
  let fk = null; let selStart = null; let selEnd = null;
  if (active && container.contains(active) && active.dataset && active.dataset.fk) {
    fk = active.dataset.fk;
    try { selStart = active.selectionStart; selEnd = active.selectionEnd; } catch { /* non testuale */ }
  }
  const scroll = container.scrollTop;
  const nodes = build();
  container.replaceChildren(...[].concat(nodes).filter(Boolean));
  container.scrollTop = scroll;
  if (fk) {
    const el = [...container.querySelectorAll('[data-fk]')].find((e) => e.dataset.fk === fk);
    if (el) {
      el.focus({ preventScroll: true });
      if (selStart != null && el.setSelectionRange) { try { el.setSelectionRange(selStart, selEnd); } catch { /* ignora */ } }
    }
  }
}

/** Dialogo di conferma modale accessibile (<dialog>). Ritorna Promise<boolean>. */
export function confirmDialog(message, { okLabel = 'Conferma', cancelLabel = 'Annulla', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: 'dlg', 'aria-label': message });
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.append(
      h('p', { class: 'dlg-msg' }, message),
      h('div', { class: 'dlg-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => done(false) }, cancelLabel),
        h('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, type: 'button', autofocus: true, onclick: () => done(true) }, okLabel)),
    );
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Stringa -> bool di sola lettura su localStorage con try/catch (puo' essere indisponibile). */
export const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignora */ }
  },
};
