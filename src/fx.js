// ===== fx.js =====
// 画面氛围效果：星空、破坏/爆炸粒子。依赖 THREE（作为参数传入，不直接 import）。

// ---- 星空 ----
// 在天球上撒一批点，返回 Points 对象；夜间显示，白天淡出（由 game 调 setStarOpacity）。
export function makeStars(THREE, count = 600, radius = 200) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // 在上半球随机方向
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random()); // 0~π/2，只在天上
    const r = radius;
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi);          // y 朝上
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.2, transparent: true, opacity: 0, sizeAttenuation: false });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = -1; // 画在最远
  return points;
}

// ---- 粒子系统 ----
// 简单的短生命粒子：破坏方块的碎屑、爆炸火花、脚步尘土。
// particles 是一个由 game 持有的数组，每个粒子 {mesh,vel,age,life}。
export function makeParticleSystem(THREE, scene) {
  const particles = [];
  const geo = new THREE.BoxGeometry(0.12, 0.12, 0.12);

  // 在某点喷一组粒子。color 十六进制，count 个，speed 初速，life 寿命秒
  function burst(x, y, z, color, count, speed, life) {
    const mat = new THREE.MeshBasicMaterial({ color });
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      scene.add(mesh);
      particles.push({
        mesh,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * speed,
          Math.random() * speed,
          (Math.random() - 0.5) * speed
        ),
        age: 0, life: life * (0.6 + Math.random() * 0.8),
      });
    }
  }

  // 每帧推进：重力下落、缩小、超寿命移除
  function update(dt, gravity) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      p.vel.y -= gravity * dt;
      p.mesh.position.x += p.vel.x * dt;
      p.mesh.position.y += p.vel.y * dt;
      p.mesh.position.z += p.vel.z * dt;
      const s = Math.max(0.01, 1 - p.age / p.life);
      p.mesh.scale.set(s, s, s);
      if (p.age >= p.life) { scene.remove(p.mesh); particles.splice(i, 1); }
    }
  }

  return { burst, update, particles };
}
