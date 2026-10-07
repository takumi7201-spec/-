/**
 * 試作個体。ゲームの表（revos.ts）には入れず、計測のときだけ登録する。
 *
 * 新しい特性や必殺を試すときは、simulate.ts に仕組みを足したうえで、
 * それを使う個体をここに置く。expunit が registerRevos() で差し込むので、
 * 図鑑にも発掘にも出ないまま勝率だけ測れる——採用が決まってから
 * revos.ts へ移す。
 *
 * ここが空なのは、いま試している案が無いというだけのこと。
 */
import type { RevosDef } from '../src/game/data/revos.ts';

export const EXP_DEFS: RevosDef[] = [];
