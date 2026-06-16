// ===== daycycle.js =====
// 昼夜循环状态与 Three.js 光照/天空同步。

export function createDayCycle(THREE, { scene, sun, ambient, stars, player, dayLength = 120, initialTime = 0.15 }) {
  let dayTime = initialTime;
  const skyDay = new THREE.Color(0x88bbee);
  const skyNight = new THREE.Color(0x0a0a25);
  const skyDusk = new THREE.Color(0xff7a3d);

  function apply() {
    const ang = dayTime * Math.PI * 2;
    sun.position.set(Math.cos(ang) * 0.5, Math.sin(ang), 0.3);

    const day = Math.max(0, Math.sin(ang));
    const dusk = Math.max(0, 1 - Math.abs(Math.sin(ang)) * 2.2);
    const sky = skyNight.clone().lerp(skyDay, day);
    sky.lerp(skyDusk, dusk * 0.6);
    scene.background.copy(sky);
    if (scene.fog) scene.fog.color.copy(sky);

    sun.intensity = 0.15 + day * 0.85;
    ambient.intensity = 0.25 + day * 0.5;
    stars.material.opacity = Math.max(0, 1 - day * 2.5);
    stars.position.copy(player.pos);
  }

  return {
    update(dt) {
      dayTime = (dayTime + dt / dayLength) % 1;
      apply();
    },
    isNight() {
      return Math.sin(dayTime * Math.PI * 2) < 0;
    },
    getTime() {
      return dayTime;
    },
    setTime(value) {
      dayTime = Number.isFinite(value) ? ((value % 1) + 1) % 1 : initialTime;
      apply();
    },
    reset(value = initialTime) {
      dayTime = value;
      apply();
    },
  };
}
