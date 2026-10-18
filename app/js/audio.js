// 소리 엔진: 마이크 2개까지 → 에코·잔향 → 스피커, 노래 → (목소리 줄이기) → 스피커, 전체 → 녹음
export const ECHO_PRESETS = {
  off:    { echo: 0,    time: 0.18, feedback: 0.3,  reverb: 0 },
  light:  { echo: 0.15, time: 0.12, feedback: 0.2,  reverb: 0.15 },
  karaoke:{ echo: 0.32, time: 0.18, feedback: 0.38, reverb: 0.25 },
  hall:   { echo: 0.25, time: 0.26, feedback: 0.3,  reverb: 0.6 },
  cave:   { echo: 0.45, time: 0.32, feedback: 0.55, reverb: 0.5 },
};

export class Engine {
  // fast = 버퍼 최소(지연 약 15ms), stable = 끊김에 강함(지연 약 50ms)
  constructor(mode = 'fast') {
    this.mode = mode;
    this.ctx = null;
    this.mics = [null, null];
    this.media = new WeakMap();
  }

  async ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') await this.ctx.resume(); return this.ctx; }
    const ctx = this.ctx = new AudioContext({ latencyHint: this.mode === 'fast' ? 0 : 'interactive' });
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.recordDest = ctx.createMediaStreamDestination();
    this.master.connect(this.recordDest);

    // 노래 쪽
    this.songIn = ctx.createGain();
    this.songOut = ctx.createGain();
    this.songOut.connect(this.master);
    this._buildVocalCut();

    // 마이크 공통 효과
    this.micBus = ctx.createGain();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 90;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.15;
    this.micBus.connect(hp); hp.connect(comp);

    this.monitor = ctx.createGain();
    this.monitor.connect(this.master);
    comp.connect(this.monitor);                     // 원래 목소리

    this.delay = ctx.createDelay(1.5);
    this.feedback = ctx.createGain();
    const fbTone = ctx.createBiquadFilter(); fbTone.type = 'lowpass'; fbTone.frequency.value = 3500;
    this.echoWet = ctx.createGain();
    comp.connect(this.delay);
    this.delay.connect(fbTone); fbTone.connect(this.feedback); this.feedback.connect(this.delay);
    this.delay.connect(this.echoWet); this.echoWet.connect(this.monitor);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.4);
    this.reverbWet = ctx.createGain();
    comp.connect(this.reverb); this.reverb.connect(this.reverbWet); this.reverbWet.connect(this.monitor);

    this.applyAll();
    return ctx;
  }

  // 가운데(목소리)를 빼고 낮은 소리(베이스·드럼)는 살린다.
  _buildVocalCut() {
    const ctx = this.ctx;
    const split = ctx.createChannelSplitter(2);
    const inv = ctx.createGain(); inv.gain.value = -1;
    const side = ctx.createGain();
    split.connect(side, 0); split.connect(inv, 1); inv.connect(side);
    const sideHp = ctx.createBiquadFilter(); sideHp.type = 'highpass'; sideHp.frequency.value = 150;
    side.connect(sideHp);
    const bass = ctx.createBiquadFilter(); bass.type = 'lowpass'; bass.frequency.value = 150;
    this.songIn.connect(bass);
    this.songIn.connect(split);
    this.cutOut = ctx.createGain();
    sideHp.connect(this.cutOut); bass.connect(this.cutOut);
    this.dryOut = ctx.createGain();
    this.songIn.connect(this.dryOut);
    this.cutOut.connect(this.songOut); this.dryOut.connect(this.songOut);
  }

  _impulse(seconds) {
    const rate = this.ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  // 설정값은 ctx 가 없을 때도 기억해 두었다가 만들어질 때 한 번에 적용한다.
  settings = { songVolume: 0.8, vocalCut: false, monitor: true, micVolume: [1, 1], ...ECHO_PRESETS.karaoke };

  set(patch) { Object.assign(this.settings, patch); this.applyAll(); }

  applyAll() {
    if (!this.ctx) return;
    const s = this.settings, t = this.ctx.currentTime, ramp = (p, v) => p.setTargetAtTime(v, t, 0.02);
    ramp(this.songOut.gain, s.songVolume);
    ramp(this.cutOut.gain, s.vocalCut ? 1.4 : 0);
    ramp(this.dryOut.gain, s.vocalCut ? 0 : 1);
    ramp(this.monitor.gain, s.monitor ? 1 : 0);
    ramp(this.echoWet.gain, s.echo);
    ramp(this.delay.delayTime, s.time);
    ramp(this.feedback.gain, Math.min(s.feedback, 0.85));
    ramp(this.reverbWet.gain, s.reverb * 0.9);
    this.mics.forEach((m, i) => m && ramp(m.gain.gain, s.micVolume[i]));
  }

  connectMedia(el) {
    if (this.media.has(el)) return;
    const src = this.ctx.createMediaElementSource(el);
    src.connect(this.songIn);
    this.media.set(el, src);
  }

  async setMic(slot, deviceId) {
    await this.ensure();
    this.stopMic(slot);
    if (deviceId == null) return null;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        channelCount: 1, latency: 0,
      },
    });
    const src = this.ctx.createMediaStreamSource(stream);
    const gain = this.ctx.createGain();
    const analyser = this.ctx.createAnalyser(); analyser.fftSize = 512;
    src.connect(gain); gain.connect(this.micBus); gain.connect(analyser);
    const track = stream.getAudioTracks()[0];
    this.mics[slot] = { stream, src, gain, analyser, track, buf: new Float32Array(512) };
    this.applyAll();
    return track;
  }

  stopMic(slot) {
    const m = this.mics[slot];
    if (!m) return;
    m.stream.getTracks().forEach(t => t.stop());
    m.src.disconnect(); m.gain.disconnect();
    this.mics[slot] = null;
  }

  level(slot) {
    const m = this.mics[slot];
    if (!m) return 0;
    m.analyser.getFloatTimeDomainData(m.buf);
    let peak = 0;
    for (const v of m.buf) peak = Math.max(peak, Math.abs(v));
    return peak;
  }

  // 목소리가 스피커로 나오기까지 걸리는 시간(ms) 추정
  latencyMs() {
    if (!this.ctx) return null;
    let s = (this.ctx.baseLatency || 0) + (this.ctx.outputLatency || 0);
    const m = this.mics.find(Boolean);
    const inLat = m?.track.getSettings().latency;
    s += typeof inLat === 'number' ? inLat : 0.01;
    return Math.round(s * 1000);
  }

  async setOutput(deviceId) {
    await this.ensure();
    if (typeof this.ctx.setSinkId !== 'function') throw new Error('이 기기에서는 스피커를 고를 수 없습니다');
    await this.ctx.setSinkId(deviceId || '');
  }

  startRecording() {
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = types.find(t => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
    this.chunks = [];
    this.recorder = new MediaRecorder(this.recordDest.stream, mimeType ? { mimeType } : undefined);
    this.recorder.ondataavailable = e => e.data.size && this.chunks.push(e.data);
    this.recorder.start(1000);
  }

  stopRecording() {
    return new Promise(resolve => {
      if (!this.recorder) return resolve(null);
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.recorder.mimeType }));
      this.recorder.stop();
    });
  }
}
