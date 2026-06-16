// ===== clouds.js =====
// 简单云层：生成一组扁平方块并水平循环移动。

export function createClouds(THREE, { scene, worldW, worldH, worldD }) {
  const clouds = [];
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });

  return {
    make() {
      if (clouds.length) return;
      for (let i = 0; i < 14; i++) {
        const w = 6 + (i * 7 % 9);
        const d = 5 + (i * 5 % 8);
        const cloud = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, d), mat);
        cloud.position.set(
          i * 37 % worldW,
          worldH + 8 + (i % 3),
          i * 53 % worldD
        );
        scene.add(cloud);
        clouds.push(cloud);
      }
    },
    update(dt) {
      for (const cloud of clouds) {
        cloud.position.x += dt * 0.6;
        if (cloud.position.x > worldW + 10) cloud.position.x = -10;
      }
    },
  };
}
