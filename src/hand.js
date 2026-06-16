// ===== hand.js =====
// 第一人称手臂和挥击动画。

export function createHand(THREE, { camera }) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xe0ac69 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.5), mat);
  group.add(mesh);
  group.position.set(0.32, -0.3, -0.6);
  camera.add(group);

  const swingDuration = 0.25;
  let swingT = 0;

  return {
    startSwing() {
      swingT = swingDuration;
    },
    update(dt) {
      if (swingT > 0) swingT = Math.max(0, swingT - dt);
      const p = swingT / swingDuration;
      const swing = Math.sin(p * Math.PI);
      group.rotation.x = -swing * 1.4;
      group.rotation.z = swing * 0.3;
      group.position.y = -0.3 - swing * 0.1;
    },
  };
}
