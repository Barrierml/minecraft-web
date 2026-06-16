// ===== hud.js =====
// DOM rendering for the always-visible HUD.

function colorHex(color) {
  return '#' + color.toString(16).padStart(6, '0');
}

export function createHud({
  player,
  inventory,
  placeable,
  blocks,
  maxHealth,
  maxHunger,
}) {
  const hotbarEl = document.getElementById('hotbar');
  const infoEl = document.getElementById('info');
  const healthEl = document.getElementById('health');
  const hungerEl = document.getElementById('hunger');
  const xpFillEl = document.getElementById('xpfill');
  const xpTextEl = document.getElementById('xptext');
  let infoTimer = 0;
  let lastInfo = '';

  function renderXP() {
    const into = player.xp % 100;
    xpFillEl.style.width = into + '%';
    xpTextEl.textContent = 'Lv ' + player.level + '  (' + player.xp + ' XP)';
  }

  function renderHunger() {
    hungerEl.textContent = '';
    const drums = maxHunger / 2;
    for (let i = 0; i < drums; i++) {
      const hp = player.hunger - i * 2;
      const span = document.createElement('span');
      span.className = 'drum';
      span.textContent = hp >= 2 ? '🍗' : (hp === 1 ? '🦴' : '⬛');
      hungerEl.appendChild(span);
    }
  }

  function renderHealth() {
    healthEl.textContent = '';
    const hearts = maxHealth / 2;
    for (let i = 0; i < hearts; i++) {
      const hp = player.health - i * 2;
      const span = document.createElement('span');
      span.className = 'heart';
      span.textContent = hp >= 2 ? '❤️' : (hp === 1 ? '💔' : '🖤');
      healthEl.appendChild(span);
    }
  }

  function renderHotbar(selected) {
    hotbarEl.textContent = '';
    placeable.forEach((id, i) => {
      const count = inventory[id] || 0;
      const slot = document.createElement('div');
      slot.className = 'slot' + (i === selected ? ' active' : '') + (count === 0 ? ' empty' : '');
      const sw = document.createElement('div');
      sw.className = 'sw';
      sw.style.background = colorHex(blocks[id].top);
      if (count > 0) {
        const cnt = document.createElement('span');
        cnt.className = 'count';
        cnt.textContent = count;
        sw.appendChild(cnt);
      }
      const label = document.createElement('span');
      label.textContent = (i + 1) + ' ' + blocks[id].name;
      slot.appendChild(sw);
      slot.appendChild(label);
      hotbarEl.appendChild(slot);
    });
  }

  function updateInfo(selected, dt, force = false) {
    infoTimer += dt;
    if (!force && infoTimer < 0.1) return;
    infoTimer = 0;
    const p = player.pos;
    const text = `坐标 ${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}\n` +
      `当前方块: ${blocks[placeable[selected]].name}`;
    if (text !== lastInfo) {
      infoEl.textContent = text;
      lastInfo = text;
    }
  }

  function renderAll(selected) {
    renderHotbar(selected);
    renderHealth();
    renderHunger();
    renderXP();
    updateInfo(selected, 0, true);
  }

  return {
    renderXP,
    renderHunger,
    renderHealth,
    renderHotbar,
    updateInfo,
    renderAll,
  };
}
