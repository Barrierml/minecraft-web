// ===== weather.js =====
// Lightweight local weather: clear/rain/snow/storm precipitation that follows the player.

export function createWeather(THREE, { scene, player, playSound, labelEl }) {
  const COUNT = 900;
  const radius = 42;
  const height = 34;
  const positions = new Float32Array(COUNT * 3);
  const speeds = new Float32Array(COUNT);
  const group = new THREE.Group();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0x9fd4ff,
    size: 0.12,
    transparent: true,
    opacity: 0,
    sizeAttenuation: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  group.add(points);
  scene.add(group);

  let mode = 'clear';
  let weatherTimer = 25;
  let lightning = 0;
  let thunderTimer = 12;

  for (let i = 0; i < COUNT; i++) resetDrop(i, true);
  setMode('clear');

  function resetDrop(i, spreadY = false) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * radius;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = spreadY ? Math.random() * height : height * (0.7 + Math.random() * 0.3);
    positions[i * 3 + 2] = Math.sin(a) * r;
    speeds[i] = mode === 'snow' ? 3 + Math.random() * 2 : 18 + Math.random() * 12;
  }

  function setMode(next) {
    mode = next;
    const raining = mode === 'rain' || mode === 'storm';
    mat.opacity = mode === 'clear' ? 0 : (mode === 'snow' ? 0.72 : 0.62);
    mat.color.setHex(mode === 'snow' ? 0xffffff : 0x9fd4ff);
    mat.size = mode === 'snow' ? 0.18 : 0.09;
    weatherTimer = 35 + Math.random() * 55;
    thunderTimer = mode === 'storm' ? 4 + Math.random() * 10 : 999;
    if (labelEl) {
      labelEl.textContent = ({
        clear: '天气 晴',
        rain: '天气 雨',
        snow: '天气 雪',
        storm: '天气 雷暴',
      })[mode];
      labelEl.classList.toggle('storm', mode === 'storm');
      labelEl.classList.toggle('wet', raining);
      labelEl.classList.toggle('snow', mode === 'snow');
    }
  }

  function chooseNextWeather() {
    const roll = Math.random();
    if (roll < 0.48) return 'clear';
    if (roll < 0.76) return 'rain';
    if (roll < 0.92) return 'snow';
    return 'storm';
  }

  function update(dt) {
    weatherTimer -= dt;
    if (weatherTimer <= 0) setMode(chooseNextWeather());

    group.position.set(player.pos.x, player.pos.y + 8, player.pos.z);
    if (mode !== 'clear') {
      for (let i = 0; i < COUNT; i++) {
        const yi = i * 3 + 1;
        positions[yi] -= speeds[i] * dt;
        if (mode === 'snow') {
          positions[i * 3] += Math.sin((positions[yi] + i) * 0.11) * dt * 0.8;
          positions[i * 3 + 2] += Math.cos((positions[yi] + i) * 0.09) * dt * 0.8;
        }
        if (positions[yi] < -4) resetDrop(i);
      }
      geo.attributes.position.needsUpdate = true;
    }

    if (mode === 'storm') {
      thunderTimer -= dt;
      if (thunderTimer <= 0) {
        lightning = 0.16;
        thunderTimer = 7 + Math.random() * 12;
        playSound('thunder');
      }
    }
    if (lightning > 0) lightning = Math.max(0, lightning - dt);
    return { mode, lightning };
  }

  return {
    update,
    getMode: () => mode,
    setMode,
  };
}
