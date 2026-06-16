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
    case 'place':
      tone(330, 0.06, 'square', 0.10);
      break;
    case 'pickup':
      tone(660, 0.08, 'sine', 0.12);
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
  }
}
