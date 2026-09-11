/**
 * 効果音は全て WebAudio で合成する。音声ファイルを持たないので
 * 初回DLに1バイトも足さず、ピッチ・長さをゲーム状態から連続的に変えられる。
 * 「ダメージ量でヒット音のピッチを変える」のは最も安いAAA感。
 *
 * iOS対策:
 *  - 最初のユーザージェスチャで resume()
 *  - visibilitychange で毎回 resume（バックグラウンド復帰で interrupted になる）
 *  - 消音スイッチ対策に無音の <audio playsinline> を1回鳴らしてセッションを切り替える
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private unlocked = false;
  private musicTimer: number | undefined;
  private musicStep = 0;

  sfxVolume = 0.8;
  bgmVolume = 0.5;

  init(): void {
    if (this.ctx) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVolume;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);

    // ホワイトノイズは打撃・掘削・風の全てに使う
    const len = this.ctx.sampleRate * 1.2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void this.ctx?.resume();
    });
  }

  /** 最初のタップで呼ぶ */
  async unlock(): Promise<void> {
    this.init();
    if (!this.ctx) return;
    try {
      await this.ctx.resume();
      // iOS の消音スイッチ下でも Web Audio を鳴らすための空再生
      if (!this.unlocked) {
        const el = document.createElement('audio');
        el.setAttribute('playsinline', '');
        el.muted = true;
        el.src =
          'data:audio/mp4;base64,AAAAHGZ0eXBNNEEgAAAAAE00QSBpc29tbXA0MgAAAAhmcmVlAAAAG21kYXQAAAGzABAHAAABthBgUYI';
        el.play().catch(() => { /* 期待される失敗 */ });
      }
      this.unlocked = true;
    } catch { /* noop */ }
  }

  setVolumes(sfx: number, bgm: number): void {
    this.sfxVolume = sfx;
    this.bgmVolume = bgm;
    if (this.sfxBus) this.sfxBus.gain.value = sfx;
    if (this.musicBus) this.musicBus.gain.value = this.musicTimer !== undefined ? bgm * 0.4 : 0;
  }

  private now(): number { return this.ctx?.currentTime ?? 0; }

  private noise(dur: number, gain: number, filterHz: number, q = 1, type: BiquadFilterType = 'bandpass'): void {
    if (!this.ctx || !this.sfxBus || !this.noiseBuffer) return;
    const t = this.now();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterHz;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  private tone(
    freq: number, dur: number, gain: number,
    type: OscillatorType = 'sine', sweepTo?: number, delay = 0,
  ): void {
    if (!this.ctx || !this.sfxBus) return;
    const t = this.now() + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  // ------------------------------------------------------------ SE

  uiTap(): void { this.tone(660, 0.06, 0.16, 'square', 880); }
  uiBack(): void { this.tone(420, 0.08, 0.13, 'square', 300); }
  uiConfirm(): void { this.tone(560, 0.07, 0.16, 'triangle', 840); this.tone(840, 0.1, 0.1, 'triangle', 1180, 0.05); }
  uiError(): void { this.tone(180, 0.16, 0.2, 'sawtooth', 120); }

  /** 掘削。硬さで音色が変わる */
  dig(hardness: number): void {
    const hz = 300 + (1 - Math.min(1, hardness / 5)) * 700;
    this.noise(0.09 + hardness * 0.012, 0.3, hz, 1.6);
    this.tone(90 + hardness * 14, 0.07, 0.16, 'square', 50);
  }

  /** 化石を掘り当てた瞬間。ここは派手にしてよい */
  fossilHit(): void {
    this.tone(880, 0.1, 0.2, 'triangle', 1320);
    this.tone(1320, 0.22, 0.16, 'sine', 1760, 0.06);
    this.noise(0.3, 0.12, 2600, 3);
  }

  /** エコーパルス発射 */
  echoPing(): void {
    this.tone(1400, 0.5, 0.11, 'sine', 700);
    this.noise(0.35, 0.05, 1800, 6);
  }

  /** 探知反応。強さ1-3で連数が変わる */
  echoHit(strength: 1 | 2 | 3): void {
    const base = 900 + strength * 260;
    for (let i = 0; i < strength; i++) {
      this.tone(base, 0.09, 0.15, 'sine', base * 1.35, i * 0.11);
    }
  }

  /** バトルのヒット。ダメージ比でピッチと厚みを変える */
  hit(intensity: number, crit = false): void {
    const p = Math.min(1, Math.max(0, intensity));
    this.noise(0.07 + p * 0.07, 0.32, 380 + p * 1500, 1.1);
    this.tone(120 + p * 190, 0.09 + p * 0.05, 0.2, 'square', 60);
    if (crit) {
      this.tone(1760, 0.16, 0.14, 'triangle', 2400);
      this.noise(0.22, 0.14, 3200, 2);
    }
  }

  heal(): void {
    this.tone(660, 0.18, 0.12, 'sine', 990);
    this.tone(990, 0.24, 0.1, 'sine', 1320, 0.08);
  }

  ko(): void {
    this.tone(220, 0.5, 0.22, 'sawtooth', 60);
    this.noise(0.4, 0.2, 300, 0.8, 'lowpass');
  }

  odReady(): void {
    this.tone(520, 0.1, 0.13, 'triangle', 780);
    this.tone(780, 0.14, 0.13, 'triangle', 1040, 0.08);
    this.tone(1040, 0.2, 0.12, 'triangle', 1560, 0.16);
  }

  odFire(): void {
    this.tone(160, 0.5, 0.26, 'sawtooth', 900);
    this.noise(0.45, 0.24, 900, 0.7, 'lowpass');
    this.tone(1200, 0.3, 0.14, 'square', 400, 0.06);
  }

  victory(): void {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.3, 0.15, 'triangle', undefined, i * 0.1));
  }

  defeat(): void {
    [440, 392, 330, 262].forEach((f, i) => this.tone(f, 0.35, 0.14, 'sine', undefined, i * 0.13));
  }

  reward(step = 0): void {
    this.tone(880 + step * 120, 0.12, 0.14, 'triangle', 1320 + step * 120);
  }

  // ------------------------------------------------------------ BGM

  /**
   * 簡易アルペジオBGM。ファイルを持たずに場の空気だけ作る。
   * 曲として聴かせるのではなく、無音の居心地の悪さを消すのが目的。
   */
  startMusic(mode: 'calm' | 'dig' | 'battle'): void {
    this.init();
    if (!this.ctx || !this.musicBus) return;
    this.stopMusic();
    this.musicBus.gain.value = this.bgmVolume * 0.4;

    const scales: Record<string, number[]> = {
      calm: [220, 261.6, 329.6, 392, 440, 392, 329.6, 261.6],
      dig: [174.6, 220, 261.6, 293.7, 349.2, 293.7, 261.6, 220],
      battle: [196, 233, 293.7, 349.2, 392, 349.2, 293.7, 233],
    };
    const notes = scales[mode];
    const interval = mode === 'battle' ? 220 : mode === 'dig' ? 300 : 380;
    this.musicStep = 0;

    const tick = () => {
      if (!this.ctx || !this.musicBus) return;
      const t = this.ctx.currentTime;
      const n = notes[this.musicStep % notes.length];
      const o = this.ctx.createOscillator();
      o.type = mode === 'battle' ? 'sawtooth' : 'triangle';
      o.frequency.value = n;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + interval / 1000 * 1.6);
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 1400;
      o.connect(f).connect(g).connect(this.musicBus);
      o.start(t);
      o.stop(t + interval / 1000 * 2);

      // 4拍ごとにベース
      if (this.musicStep % 4 === 0) {
        const b = this.ctx.createOscillator();
        b.type = 'sine';
        b.frequency.value = notes[0] / 2;
        const bg = this.ctx.createGain();
        bg.gain.setValueAtTime(0.0001, t);
        bg.gain.exponentialRampToValueAtTime(0.18, t + 0.04);
        bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
        b.connect(bg).connect(this.musicBus);
        b.start(t);
        b.stop(t + 0.7);
      }
      this.musicStep++;
    };
    tick();
    this.musicTimer = setInterval(tick, interval) as unknown as number;
  }

  stopMusic(): void {
    if (this.musicTimer !== undefined) {
      clearInterval(this.musicTimer);
      this.musicTimer = undefined;
    }
    if (this.musicBus) this.musicBus.gain.value = 0;
  }
}

export const audio = new AudioManager();
