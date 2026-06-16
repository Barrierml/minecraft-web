// ===== remotePlayers.js =====
// 远程玩家渲染代理：按 peer/player id 管理 mesh 与插值目标。

export function createRemotePlayers(THREE, { scene, playerHeight }) {
  const players = {};

  function makeMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 1.0, 0.35),
      new THREE.MeshLambertMaterial({ color: 0x3a7bd5 })
    );
    body.position.y = 0.5;
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.45, 0.45),
      new THREE.MeshLambertMaterial({ color: 0xe0ac69 })
    );
    head.position.y = 1.25;
    g.add(body);
    g.add(head);
    return g;
  }

  function ensure(id) {
    if (players[id]) return players[id];
    const mesh = makeMesh();
    scene.add(mesh);
    const player = { pos: new THREE.Vector3(), target: new THREE.Vector3(), yaw: 0, mesh };
    players[id] = player;
    return player;
  }

  function remove(id) {
    const player = players[id];
    if (!player) return;
    scene.remove(player.mesh);
    delete players[id];
  }

  return {
    ensure,
    remove,
    update(dt) {
      for (const id in players) {
        const player = players[id];
        player.pos.lerp(player.target, Math.min(1, dt * 12));
        player.mesh.position.set(player.pos.x, player.pos.y - playerHeight, player.pos.z);
        player.mesh.rotation.y = player.yaw;
      }
    },
    count() {
      return Object.keys(players).length;
    },
    ids() {
      return Object.keys(players);
    },
    entries() {
      return Object.entries(players);
    },
  };
}
