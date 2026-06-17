// ===== audio.js =====
// Web Audio 合成音效。模块内部持有 AudioContext，外部只调用 initAudio/playSound。

let audioCtx = null;

export function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    audioCtx = null;
  }
}

function tone(freq, dur, type = 'square', vol = 0.15) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + dur);
}

function noise(dur, vol = 0.12) {
  if (!audioCtx) return;
  const size = Math.floor(audioCtx.sampleRate * dur);
  const buffer = audioCtx.createBuffer(1, size, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();
  src.buffer = buffer;
  gain.gain.setValueAtTime(vol, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  src.connect(gain);
  gain.connect(audioCtx.destination);
  src.start();
}

export function playSound(kind) {
  if (!audioCtx) return;
  switch (kind) {
    case 'hit':
      tone(220, 0.08, 'square', 0.12);
      break;
    case 'hurt':
      tone(160, 0.15, 'sawtooth', 0.18);
      break;
    case 'break':
      tone(120, 0.06, 'square', 0.10);
      break;
    case 'splash':
      noise(0.12, 0.06);
      tone(260, 0.08, 'sine', 0.05);
      break;
    case 'place':
      tone(330, 0.06, 'square', 0.10);
      break;
    case 'pickup':
      tone(660, 0.08, 'sine', 0.12);
      break;
    case 'smelt':
      tone(180, 0.08, 'triangle', 0.08);
      setTimeout(() => tone(520, 0.12, 'sine', 0.08), 70);
      break;
    case 'kill':
      tone(440, 0.12, 'triangle', 0.15);
      break;
    case 'fuse':
      tone(880, 0.1, 'sine', 0.1);
      break;
    case 'explode':
      tone(80, 0.4, 'sawtooth', 0.25);
      tone(50, 0.5, 'square', 0.2);
      break;
    case 'thunder':
      noise(0.9, 0.18);
      tone(55, 0.7, 'sawtooth', 0.13);
      break;
    case 'zombie':
      tone(92, 0.28, 'sawtooth', 0.08);
      tone(72, 0.36, 'triangle', 0.06);
      break;
    case 'skeleton':
      tone(520, 0.04, 'square', 0.07);
      setTimeout(() => tone(640, 0.035, 'square', 0.05), 45);
      break;
    case 'creeper':
      noise(0.18, 0.05);
      tone(340, 0.12, 'sine', 0.04);
      break;
    case 'boneHit':
      tone(620, 0.05, 'square', 0.09);
      tone(360, 0.08, 'triangle', 0.05);
      break;
  }
}
