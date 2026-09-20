import { h, button } from './dom';
import { audio } from '../core/Audio';

/**
 * 画面の外枠。
 *
 * アートボードで決めた構造をここに1度だけ書く。各画面はこれを呼ぶだけにして、
 * 「戻るが丸」「見出しは小札＋太字の2段」「右端は傾いた黒い札」という約束を
 * 画面ごとに書き直さないようにする。
 */

/** 傾いた黒い札。値を1つだけ載せる——2つ載せるとどちらが主か分からなくなる */
export function plate(eyebrow: string, opts: { tone?: 'amber' | 'mint' | 'plain' } = {}): {
  el: HTMLElement; set(value: string, sub?: string): void;
} {
  const valueEl = h('div', { class: `plate-value ${opts.tone ? `plate-value--${opts.tone}` : ''}` });
  const subEl = h('div', { class: 'plate-sub', hidden: true });
  const el = h('div', { class: 'plate' },
    h('div', { class: 'plate-inner' },
      h('div', { class: 'plate-eyebrow', text: spaced(eyebrow) }),
      valueEl,
      subEl,
    ),
  );
  return {
    el,
    set(value, sub) {
      valueEl.textContent = value;
      subEl.textContent = sub ?? '';
      subEl.hidden = !sub;
    },
  };
}

/** 画面の頭。戻る丸＋小札＋題、右端は任意の札 */
export function screenHead(opts: {
  eyebrow: string;
  title: string;
  onBack?: () => void;
  right?: HTMLElement;
}): HTMLElement {
  const head = h('div', { class: 'scr-head' });
  if (opts.onBack) {
    const back = button('‹', () => { audio.uiBack(); opts.onBack?.(); }, { class: 'btn--rail scr-back' });
    back.setAttribute('aria-label', '戻る');
    head.appendChild(back);
  }
  head.appendChild(h('div', { class: 'scr-head-main' },
    h('div', { class: 'scr-eyebrow', text: spaced(opts.eyebrow) }),
    h('div', { class: 'scr-title', text: opts.title }),
  ));
  if (opts.right) head.appendChild(opts.right);
  return head;
}

/** 身分。枠は属性色ではなく水の色で固定する——ここは個体ではなく「自分」の面 */
export function identity(): {
  el: HTMLElement; frame: HTMLElement; set(grade: number): void;
} {
  const gradeEl = h('span', { class: 'ident-grade-num num' });
  const frame = h('div', { class: 'ident-face' });
  const el = h('div', { class: 'ident' },
    h('div', { class: 'ident-frame' }, frame),
    h('div', { class: 'ident-grade' },
      h('span', { class: 'ident-grade-label', text: '等級' }),
      gradeEl,
    ),
  );
  return { el, frame, set(grade) { gradeEl.textContent = String(grade); } };
}

/** 傾いた帯。左に見出しと値、右端に水色の耳で達成率を出す */
export function banner(onTap?: () => void): {
  el: HTMLElement; set(eyebrow: string, value: string, cap: string): void;
} {
  const eyebrowEl = h('div', { class: 'banner-eyebrow' });
  const valueEl = h('div', { class: 'banner-value num' });
  const capEl = h('div', { class: 'banner-cap num' });
  const inner = h('div', { class: 'banner-inner' }, eyebrowEl, valueEl);
  const el = onTap
    ? button('', () => { audio.uiTap(); onTap(); }, { class: 'banner' })
    : h('div', { class: 'banner' });
  el.append(inner, capEl);
  return {
    el,
    set(eyebrow, value, cap) {
      eyebrowEl.textContent = spaced(eyebrow);
      valueEl.textContent = value;
      capEl.textContent = cap;
    },
  };
}

/** 左の縦列。丸い小札。報せは赤い点だけで、数は出さない */
export function railButton(icon: string, label: string, onTap: () => void): {
  el: HTMLButtonElement; alert(on: boolean): void;
} {
  const el = button(icon, () => { audio.uiTap(); onTap(); }, { class: 'btn--rail rail-btn' });
  el.setAttribute('aria-label', label);
  const dot = h('span', { class: 'rail-alert', text: '!' , hidden: true });
  el.appendChild(dot);
  return { el, alert(on) { dot.hidden = !on; } };
}

/** 右の色札。色を持てるのは3枚まで——全部に色を付けると優先順位が消える */
export function cardButton(
  icon: string,
  label: string,
  tone: 'rose' | 'amber' | 'mint' | 'dim',
  onTap: () => void,
): { el: HTMLElement; button: HTMLButtonElement; badge(n: number): void } {
  const b = button(icon, () => { audio.uiTap(); onTap(); }, { class: `card-btn card-btn--${tone}` });
  b.setAttribute('aria-label', label);
  const badgeEl = h('span', { class: 'card-badge num', hidden: true });
  const el = h('div', { class: 'card-slot' }, b, h('div', { class: 'card-label', text: label }), badgeEl);
  return {
    el,
    button: b,
    badge(n) { badgeEl.textContent = String(n); badgeEl.hidden = n <= 0; },
  };
}

export interface TabSpec { key: string; icon: string; label: string; onTap: () => void }

/** 下タブ。選択中の1枚だけが白く、背も高い */
export function tabBar(specs: TabSpec[]): {
  el: HTMLElement; select(key: string): void; badge(key: string, n: number): void;
} {
  const badges = new Map<string, HTMLElement>();
  const tabs = new Map<string, HTMLElement>();
  const el = h('div', { class: 'tabbar' });
  for (const s of specs) {
    const b = button('', () => { audio.uiTap(); s.onTap(); }, { class: 'tab' });
    b.setAttribute('aria-label', s.label);
    const badge = h('span', { class: 'tab-badge num', hidden: true });
    b.append(
      h('div', { class: 'tab-inner' },
        h('div', { class: 'tab-icon', text: s.icon }),
        h('div', { class: 'tab-label', text: s.label }),
      ),
      h('span', { class: 'tab-dots' }, h('i'), h('i')),
      badge,
    );
    badges.set(s.key, badge);
    tabs.set(s.key, b);
    el.appendChild(b);
  }
  return {
    el,
    select(key) { for (const [k, t] of tabs) t.classList.toggle('is-on', k === key); },
    badge(key, n) {
      const b = badges.get(key);
      if (!b) return;
      b.textContent = String(n);
      b.hidden = n <= 0;
    },
  };
}

/** 日本語の小札は字間を空ける。全角に欧文トラッキングの代わりをさせる */
export function spaced(s: string): string {
  return s.split('').join(' ');
}
