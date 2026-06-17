// ===== remotePlayers.js =====
// 远程玩家渲染代理：按 peer/player id 管理 mesh 与插值目标。

export function createRemotePlayers(THREE, { scene, playerHeight }) {
  const players = {};

  function makeNameTag(name) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.y = 2.05;
    sprite.scale.set(1.9, 0.48, 1);
    sprite.renderOrder = 20;
    drawNameTag(sprite, name || 'Player');
    return sprite;
  }

  function drawNameTag(sprite, name) {
    const texture = sprite.material.map;
    const canvas = texture.image;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(6,8,10,0.66)';
    roundRect(ctx, 14, 10, 228, 42, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.24)';
    ctx.lineWidth = 2;
    roundRect(ctx, 14, 10, 228, 42, 8);
    ctx.stroke();
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText(String(name).slice(0, 16), 128, 32);
    texture.needsUpdate = true;
    sprite.userData.name = name;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

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
    const tag = makeNameTag('Player');
    g.add(body);
    g.add(head);
    g.add(tag);
    g.userData.nameTag = tag;
    return g;
  }

  function setName(player, name) {
    if (!name || player.name === name) return;
    player.name = name;
    const tag = player.mesh.userData.nameTag;
    if (tag) drawNameTag(tag, name);
  }

  function ensure(id, name) {
    if (players[id]) {
      setName(players[id], name);
      return players[id];
    }
    const mesh = makeMesh();
    scene.add(mesh);
    const player = { pos: new THREE.Vector3(), target: new THREE.Vector3(), yaw: 0, mesh, name: '' };
    setName(player, name || shortName(id));
    players[id] = player;
    return player;
  }

  function shortName(id) {
    if (id === 'host') return '房主';
    return '玩家 ' + String(id).replace(/^minimc-/, '').slice(-4).toUpperCase();
  }

  function remove(id) {
    const player = players[id];
    if (!player) return;
    scene.remove(player.mesh);
    const tag = player.mesh.userData.nameTag;
    if (tag) {
      tag.material.map.dispose();
      tag.material.dispose();
    }
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
