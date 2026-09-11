/** 最小限の hyperscript。UIフレームワークを入れずにDOMを組むための道具 */

type Child = Node | string | number | false | null | undefined;

export interface Attrs {
  class?: string;
  id?: string;
  text?: string;
  html?: string;
  style?: Partial<CSSStyleDeclaration> | string;
  disabled?: boolean;
  hidden?: boolean;
  [key: string]: unknown;
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k === 'style') {
        if (typeof v === 'string') el.setAttribute('style', v);
        else Object.assign(el.style, v);
      } else if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === 'disabled' || k === 'hidden') {
        if (v) el.setAttribute(k, '');
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/**
 * ボタン。タッチでは pointerdown で即反応させる（click は 100〜300ms 遅れる）。
 * ただし pointerdown が自分の中で始まった場合のみ発火させ、
 * 外からドラッグしてきた指を拾わない。
 */
export function button(
  label: string,
  onTap: () => void,
  opts: { class?: string; icon?: string; sub?: string; disabled?: boolean; key?: string } = {},
): HTMLButtonElement {
  const el = h('button', {
    class: `btn interactive ${opts.class ?? ''}`,
    type: 'button',
    'data-ui-block': '',
    disabled: opts.disabled,
  });
  if (opts.icon) el.appendChild(h('span', { class: 'btn-icon', text: opts.icon }));
  el.appendChild(h('span', { class: 'btn-label', text: label }));
  if (opts.sub) el.appendChild(h('span', { class: 'btn-sub', text: opts.sub }));
  if (opts.key) el.appendChild(h('span', { class: 'k', text: opts.key }));

  let armed = false;
  el.addEventListener('pointerdown', (e) => {
    if (el.disabled) return;
    armed = true;
    el.setPointerCapture?.((e as PointerEvent).pointerId);
  });
  el.addEventListener('pointerup', (e) => {
    if (!armed || el.disabled) return;
    armed = false;
    const r = el.getBoundingClientRect();
    const pe = e as PointerEvent;
    // 指がボタンの外へ滑っていたらキャンセル扱い
    if (pe.clientX < r.left - 12 || pe.clientX > r.right + 12 ||
        pe.clientY < r.top - 12 || pe.clientY > r.bottom + 12) return;
    onTap();
  });
  el.addEventListener('pointercancel', () => { armed = false; });
  el.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter' || ke.key === ' ') { e.preventDefault(); onTap(); }
  });
  return el;
}

export function bar(cls = '', value = 0): { el: HTMLElement; fill: HTMLElement; set(v: number): void } {
  const fill = h('i');
  const el = h('div', { class: `bar ${cls}` }, fill);
  const set = (v: number) => {
    const p = Math.max(0, Math.min(1, v));
    fill.style.width = `${p * 100}%`;
    el.classList.toggle('is-low', cls.includes('hp') && p < 0.25);
    el.classList.toggle('is-mid', cls.includes('hp') && p >= 0.25 && p < 0.55);
  };
  set(value);
  return { el, fill, set };
}

export function icon(name: string): HTMLElement {
  return h('span', { class: 'ico', 'aria-hidden': 'true', text: ICONS[name] ?? '◆' });
}

/** 絵文字ではなく幾何記号。フォント依存を減らし、ボクセルの直線的な世界観に合う */
const ICONS: Record<string, string> = {
  dig: '⛏',
  clean: '✦',
  battle: '⚔',
  party: '❖',
  dex: '☰',
  shop: '◈',
  back: '‹',
  close: '✕',
  play: '▶',
  pause: '❚❚',
  radar: '◎',
  up: '▲',
  down: '▼',
  check: '✓',
  lock: '🔒',
  star: '★',
  speed: '»',
  bag: '▤',
  depth: '↧',
};

export function fmtNum(n: number): string {
  return n.toLocaleString('ja-JP');
}
