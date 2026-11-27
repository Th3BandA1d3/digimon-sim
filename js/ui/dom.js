import { escapeHtml } from '../util.js';
// DOM helpers: query, toast, bottom sheets, downloads.
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const h = escapeHtml;

export function toast(msg, ms = 2600) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}

// Bottom sheet modal. Returns { el, close }. content is an HTML string.
// Dismissable sheets get a pinned ✕ button, close on a tap outside, and can be swiped down by the handle.
export function sheet(content, { onClose, tall = false, dismissable = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet ${tall ? 'tall' : ''}" role="dialog" aria-modal="true"><div class="sheet-top"><div class="grab"></div>${dismissable ? '<button class="sheet-x" type="button" aria-label="Close">✕</button>' : ''}</div>${content}</div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const el = wrap.querySelector('.sheet');
  const close = () => { if (closed) return; closed = true; wrap.style.pointerEvents = 'none'; wrap.classList.remove('open'); el.style.transform = ''; setTimeout(() => wrap.remove(), 200); onClose?.(); };
  if (dismissable) {
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    wrap.querySelector('.sheet-x').addEventListener('click', (e) => { e.stopPropagation(); close(); });
    // Swipe down on the top bar to close.
    const top = wrap.querySelector('.sheet-top');
    let y0 = null;
    top.addEventListener('pointerdown', (e) => { if (e.target.closest('.sheet-x')) return; y0 = e.clientY; top.setPointerCapture?.(e.pointerId); el.style.transition = 'none'; });
    top.addEventListener('pointermove', (e) => { if (y0 == null) return; const dy = Math.max(0, e.clientY - y0); el.style.transform = `translateY(${dy}px)`; });
    const end = (e) => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; el.style.transition = ''; if (dy > 80) close(); else el.style.transform = ''; };
    top.addEventListener('pointerup', end); top.addEventListener('pointercancel', end);
  }
  return { el, close };
}

export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// iOS doesn't shrink dvh for the on-screen keyboard: pad bottom sheets by the keyboard height.
if (typeof window !== 'undefined' && window.visualViewport) {
  const vv = window.visualViewport;
  const upd = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px`);
  vv.addEventListener('resize', upd); vv.addEventListener('scroll', upd);
  document.addEventListener('focusin', (e) => { if (e.target.closest?.('.sheet')) setTimeout(() => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300); });
}
