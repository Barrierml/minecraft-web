# Mini Minecraft

一个用 Three.js 写的 3D Minecraft 克隆。

## 🎮 在线游玩

**https://barrierml.github.io/minecraft-web/**

（直接打开即可玩，无需安装。首次加载需联网从 CDN 取 Three.js。）

## 功能

- **世界**：128×64×128 地图、昼夜循环、云、雨/雪/雷暴、高山/洞穴地形、生物群系（平原/沙漠/雪原）
- **生存**：9 格快捷栏、背包、随身/工作台合成、熔炉烧制、饥饿值、掉落伤害、矿石开采、水流与沙子下落
- **战斗**：木剑/石剑/铁剑、3 种怪物（僵尸/骷髅/苦力怕）、经验值、伤害飘字、音效
- **生物**：猪/羊/牛，可击杀掉肉；怪物夜间出没、白天日照燃烧
- **建造**：火把（照明）、门、梯子、箱子（存储）、玻璃、砖块、炉子（烧制）、木栅栏、水源
- **联机**：房间联机、远程玩家插值与头顶名称显示
- **存档**：localStorage 自动存档、世界种子、读档继续
- **画面**：Kenney 方块贴图、星空、粒子效果

## 运行方式

因为用了 ES Module（多文件 `import`），需要通过本地服务器打开（不能直接双击 index.html，浏览器会拦截跨文件 import）。

任选一种方式起服务器，然后浏览器访问 http://localhost:8000 ：

```bash
# 方式一：Python（几乎所有 Mac/Linux 自带）
python3 -m http.server 8000

# 方式二：Node
npx serve .

# 方式三：任何静态服务器皆可
```

> 注：首次打开需要联网，Three.js 从 CDN（unpkg）加载。

## 操作

- `WASD` 移动 · 鼠标 视角 · `空格` 跳 · `Ctrl` 冲刺
- 左键 打怪 / 破坏方块 · 右键 放置方块
- 数字键 / 滚轮 切换快捷栏 · 背包中点击物品可放入当前快捷格
- `E` 打开合成 · 右键工作台打开 3×3 合成 · 右键炉子烧制 · `Tab` 背包 · `Q` 吃食物 · `ESC` 释放鼠标

## 项目结构

```
index.html      当前入口：DOM 元素、CSS、importmap、引入 src/game.js
legacy/
  minecraft.html  历史单文件版本，不再同步维护
src/
  data.js       纯数据层：常量、方块/物品定义、噪声、世界数据与地形、网格构建
  game.js       当前装配入口：场景、UI、输入、联机桥接、主循环
  player.js     本地玩家状态、移动碰撞、饥饿/回血/受伤/经验
  combat.js     ECS 生物射线命中与稳定网络 id 查找
  world.js      方块世界运行时状态：功能方块、火把、地形重建、block edits
  inventory.js  库存与合成规则
  audio.js      Web Audio 合成音效
  daycycle.js   昼夜循环与天空/光照
  clouds.js     云层
  hand.js       第一人称手臂
  remotePlayers.js  联机远程玩家渲染代理
  save.js       新 localStorage 存档 schema
  net.js        PeerJS/WebRTC 传输层
  fx.js         星空和粒子系统
  ecs/          bitECS 实体运行时：drops、mobs、animals、快照与系统
```

`data.js` 无外部依赖（buildMesh 接收 THREE 作为参数）。ECS 目前使用 `bitecs@0.4.0` core 入口，动物、怪物和掉落物都已从 `game.js` 的对象数组迁出。
