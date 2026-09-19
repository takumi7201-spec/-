import { Screen } from '../UIRoot';
import { h, button, clear } from '../dom';
import type { SaveData, OwnedRevos } from '../../core/Save';
import { makeUid } from '../../core/Save';
import { REVOS, getRevos } from '../../game/data/revos';
import { EVENTS } from '../../game/data/events';
import { ELEMENT_NAMES } from '../../voxel/palette';
import { audio } from '../../core/Audio';
import { revosIcon } from '../revosIcon';
import { revosDetailBody } from '../revosDetail';
import { screenHead, spaced } from '../chrome';

/**
 * デバッグモード。
 *
 * 全19種を触るには、本来なら4つのバイオームを掘り尽くしてイベントを
 * 踏破する必要がある。挙動を確かめたいだけのときに、それを毎回やり直す
 * のは無理がある——特性の噛み合わせは実際に編成して殴らせないと分から
 * ないので、確かめる手段そのものが遠いと、確かめなくなる。
 *
 * 設計方針:
 * - 配るのは「本物と同じ個体」。special-case を戦闘側に持ち込まない。
 *   ロスターに入ってしまえば、編成も図鑑も詳細も既存の経路で動く
 * - ただし debug 印は付ける。付けないと、検証用に出した19体と、
 *   掘って当てた個体が混ざって、元の手持ちに戻せなくなる
 * - 撤収できること。「戻せないデバッグ機能」は結局さわらなくなる
 */

/** 配る個体の初期値。ここを動かしてから「全種を解放」を押す */
interface Grant { level: number; clean: number; skillLevel: number; }

const LEVELS = [1, 5, 10, 15, 20, 25, 30];
const CLEANS = [50, 62, 75, 85, 95, 100];
const SKILLS = [1, 2, 3, 4, 5];

export class DebugScreen extends Screen {
  private data!: SaveData;
  private bodyEl!: HTMLElement;
  private grant: Grant = { level: 20, clean: 85, skillLevel: 3 };

  onBack?: () => void;
  onChanged?: () => void;

  constructor() { super('debug'); }

  setData(d: SaveData): void { this.data = d; this.render(); }

  build(): void {
    const strip = screenHead({
      eyebrow: '検証用', title: 'デバッグ',
      onBack: () => this.onBack?.(),
      right: h('div', { class: 'dbg-stamp' }, h('span', { text: spaced('検証') })),
    });
    this.bodyEl = h('div', { class: 'dbg-body' });
    this.el.append(strip, this.bodyEl);
  }

  enter(): void { this.render(); }

  // ------------------------------------------------------------ 部品

  /** 値を並べて1つ選ぶ行。スライダーは指では細かすぎる */
  private picker(label: string, values: number[], current: number, set: (v: number) => void): HTMLElement {
    const row = h('div', { class: 'dbg-picker' });
    for (const v of values) {
      row.appendChild(button(String(v), () => {
        audio.uiTap();
        set(v);
        this.render();
      }, { class: `btn--sm dbg-chip ${v === current ? 'is-on' : 'btn--ghost'}` }));
    }
    return h('div', { class: 'dbg-field' },
      h('div', { class: 'label', text: label }),
      row,
    );
  }

  private action(label: string, sub: string, run: () => string, danger = false): HTMLButtonElement {
    return button(label, () => {
      audio.uiConfirm();
      const msg = run();
      this.onChanged?.();
      this.render();
      this.ui.toast(msg, danger ? 'warn' : 'info');
    }, { class: `btn--wide ${danger ? 'btn--ghost dbg-danger' : 'btn--ghost'}`, sub });
  }

  // ------------------------------------------------------------ 操作

  /** 未所持の種を、指定した育成状態で配る */
  private grantAll(): string {
    const owned = new Set(this.data.roster.map((r) => r.defId));
    let added = 0;
    for (const def of REVOS) {
      if (owned.has(def.id)) continue;
      const unit: OwnedRevos = {
        uid: makeUid(),
        defId: def.id,
        level: this.grant.level,
        exp: 0,
        clean: this.grant.clean,
        skillLevel: this.grant.skillLevel,
        obtainedAt: Date.now(),
        debug: true,
      };
      this.data.roster.push(unit);
      if (!this.data.dex.includes(def.id)) this.data.dex.push(def.id);
      added++;
    }
    return added === 0 ? '全種そろっている' : `${added} 体を追加した`;
  }

  /** 手持ち全部を指定した育成状態にそろえる。比較したいときに差を消す */
  private levelAll(): string {
    for (const r of this.data.roster) {
      r.level = this.grant.level;
      r.exp = 0;
      r.clean = this.grant.clean;
      r.skillLevel = this.grant.skillLevel;
    }
    return `${this.data.roster.length} 体を Lv${this.grant.level} / C${this.grant.clean} にそろえた`;
  }

  private revokeDebug(): string {
    const before = this.data.roster.length;
    this.data.roster = this.data.roster.filter((r) => !r.debug);
    const gone = before - this.data.roster.length;
    // 編成に入っていた個体が消えたら、指定も外す（buildTeamSetup が
    // 先頭から埋め直すので、残しておくと古い uid を引きずる）
    const alive = new Set(this.data.roster.map((r) => r.uid));
    if (this.data.party.order?.some((uid) => !alive.has(uid))) this.data.party.order = null;
    return gone === 0 ? 'デバッグで配った個体はない' : `${gone} 体を外した`;
  }

  // ------------------------------------------------------------ 描画

  private render(): void {
    if (!this.data || !this.bodyEl) return;
    clear(this.bodyEl);
    const d = this.data;

    const debugOwned = d.roster.filter((r) => r.debug).length;
    const missing = REVOS.filter((def) => !d.roster.some((r) => r.defId === def.id));

    this.bodyEl.append(
      h('div', { class: 'dbg-note' },
        h('div', { text: '検証用。配った個体には印が付き、あとでまとめて外せる。' }),
      ),

      h('div', { class: 'dbg-section' },
        h('div', { class: 'dbg-head', text: '配る個体の状態' }),
        this.picker('レベル', LEVELS, this.grant.level, (v) => { this.grant.level = v; }),
        this.picker('クリーン度', CLEANS, this.grant.clean, (v) => { this.grant.clean = v; }),
        this.picker('スキルLv', SKILLS, this.grant.skillLevel, (v) => { this.grant.skillLevel = v; }),
      ),

      h('div', { class: 'dbg-section' },
        h('div', { class: 'dbg-head', text: 'ロスター' }),
        h('div', { class: 'dbg-stat num' },
          h('span', { text: `所持 ${d.roster.length} / ${REVOS.length} 種` }),
          h('span', { class: 'dim', text: `うちデバッグ ${debugOwned} 体` }),
        ),
        this.action(
          missing.length > 0 ? `未所持の ${missing.length} 種を解放` : '全種そろっている',
          `Lv${this.grant.level} / クリーン度 ${this.grant.clean} / スキルLv ${this.grant.skillLevel}`,
          () => this.grantAll(),
        ),
        this.action('手持ち全部を上の状態にそろえる', '性能を比べるときに育成差を消す', () => this.levelAll()),
        this.action('デバッグで配った個体を外す', '掘って当てたぶんは残る', () => this.revokeDebug(), true),
      ),

      h('div', { class: 'dbg-section' },
        h('div', { class: 'dbg-head', text: '進行' }),
        h('div', { class: 'dbg-stat num' },
          h('span', { text: `ステージ ${d.stageProgress}` }),
          h('span', { class: 'dim', text: `◈ ${d.player.coins}` }),
        ),
        h('div', { class: 'dbg-row' },
          button('ステージ −1', () => {
            audio.uiTap();
            d.stageProgress = Math.max(0, d.stageProgress - 1);
            this.onChanged?.(); this.render();
          }, { class: 'btn--sm btn--ghost' }),
          button('＋1', () => {
            audio.uiTap();
            d.stageProgress++;
            this.onChanged?.(); this.render();
          }, { class: 'btn--sm btn--ghost' }),
          button('＋5', () => {
            audio.uiTap();
            d.stageProgress += 5;
            this.onChanged?.(); this.render();
          }, { class: 'btn--sm btn--ghost' }),
        ),
        this.action(
          'イベントを全部開ける',
          `ステージ ${Math.max(...EVENTS.map((e) => e.requires), 0)} まで進める`,
          () => {
            d.stageProgress = Math.max(d.stageProgress, ...EVENTS.map((e) => e.requires));
            return `ステージ ${d.stageProgress} にした`;
          },
        ),
        this.action('◈ 10000 を足す', '精錬や強化の検証用', () => {
          d.player.coins += 10000;
          return `◈ ${d.player.coins}`;
        }),
        this.action('図鑑を全部開ける', '掘らずに全種の記載を見る', () => {
          for (const def of REVOS) if (!d.dex.includes(def.id)) d.dex.push(def.id);
          return `${d.dex.length} 種を記載した`;
        }),
      ),

      h('div', { class: 'dbg-section' },
        h('div', { class: 'dbg-head', text: `全 ${REVOS.length} 種` }),
        h('div', { class: 'party-hint', text: 'タップで詳細 — 未所持は薄く出る' }),
        h('div', { class: 'dbg-grid' },
          ...REVOS.map((def) => {
            const owned = d.roster.some((r) => r.defId === def.id);
            const cell = button('', () => { audio.uiTap(); this.openDetail(def.id); }, {
              class: `dbg-cell ${owned ? '' : 'is-missing'}`,
            });
            cell.append(
              revosIcon(def.id, 'dbg-cell-icon'),
              h('span', { class: 'dbg-cell-name', text: def.short ?? def.name }),
              h('span', { class: 'dbg-cell-sub' },
                h('span', { class: `chip chip--${def.element}`, text: ELEMENT_NAMES[def.element] }),
                h('span', { class: 'dbg-cell-rarity', text: '★'.repeat(def.rarity) }),
              ),
            );
            return cell;
          }),
        ),
      ),
    );
  }

  private openDetail(defId: string): void {
    const def = getRevos(defId);
    this.ui.sheet(def.name, revosDetailBody(defId, {
      owned: this.data.roster.filter((r) => r.defId === defId),
    }));
  }
}
