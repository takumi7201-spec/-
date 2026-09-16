import type { BiomeId } from '../../voxel/palette';
import type { FormationId, TeamSetup } from '../battle/types';
import { getRevos } from './revos';

/**
 * イベント戦。
 *
 * 通常のバトルが「進行度に応じた乱数の相手」なのに対して、こちらは
 * 固定編成の一本勝負にする。狙って挑めて、負けたら編成を組み替えて
 * また同じ相手に挑める——という形でないと、報酬が運の産物になる。
 *
 * 報酬のリヴォスは発掘では出ない個体（eventOnly）。地層から掘り出す
 * 本編と、記録の中から現れる個体を、入手経路から分けておく。
 */

export interface EventDef {
  id: string;
  /** 見出し。図鑑と違い、ここでは「事件名」として読ませる */
  name: string;
  subtitle: string;
  desc: string;
  /** 敵編成。先頭が前列 */
  enemies: string[];
  enemyLevel: number;
  enemyClean: number;
  formation: FormationId;
  /** 初回勝利で獲得できるリヴォス */
  reward: { defId: string; level: number; clean: number };
  /** 初回のコイン。2回目以降はこの 1/4 */
  coins: number;
  /** 挑めるようになるステージ進行度 */
  requires: number;
  biome: BiomeId;
}

export const EVENTS: EventDef[] = [
  {
    id: 'tyrant-1915',
    name: '1915年の暴君',
    subtitle: '旧復元の記録',
    desc:
      '組み上げられたまま倉庫に残っていた骨格が、記録の中から立ち上がる。' +
      '尾を引きずる姿勢は今では誤りとされているが、押しのける力は当時の図版のままだ。',
    enemies: ['tyrannosaurus-1915', 'velociraptor', 'pteranodon'],
    enemyLevel: 14,
    enemyClean: 72,
    formation: 'rush',
    reward: { defId: 'tyrannosaurus-1915', level: 10, clean: 70 },
    coins: 600,
    requires: 3,
    biome: 'frostpeak',
  },
  {
    id: 'sail-1915',
    name: '1915年の棘竜',
    subtitle: '焼け残った図版',
    desc:
      '原標本は空襲で失われ、残ったのは一枚の図版と記述だけ。' +
      'その紙の上の姿がそのまま出てくる。背の帆は、実物より記録のほうが厚い。',
    enemies: ['spinosaurus-1915', 'iguanodon', 'triceratops'],
    enemyLevel: 16,
    enemyClean: 74,
    formation: 'ring',
    reward: { defId: 'spinosaurus-1915', level: 10, clean: 70 },
    coins: 700,
    requires: 5,
    biome: 'emberfield',
  },
];

export const EVENTS_BY_ID = new Map(EVENTS.map((e) => [e.id, e]));

export function getEvent(id: string): EventDef | undefined {
  return EVENTS_BY_ID.get(id);
}

/** イベントの敵編成を戦闘用に組む。固定なので乱数を一切入れない */
export function buildEventTeam(ev: EventDef): TeamSetup {
  return {
    members: ev.enemies.map((defId, i) => ({
      uid: `ev${i}`,
      defId,
      level: ev.enemyLevel,
      clean: ev.enemyClean,
      skillLevel: 1,
    })),
    order: [0, 1, 2],
    formation: ev.formation,
    targetPrefs: ev.enemies.map((defId) => getRevos(defId).defaultPref),
  };
}
