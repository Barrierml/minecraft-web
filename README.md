# Mini Minecraft

一个用 Three.js 写的 3D Minecraft 克隆。

## 🎮 在线游玩

**https://barrierml.github.io/minecraft-web/**

（直接打开即可玩，无需安装。首次加载需联网从 CDN 取 Three.js。）

## 功能

- **世界**：昼夜循环、云、洞穴地形、生物群系（平原/沙漠/雪原）
- **生存**：合成系统、饥饿值、矿石开采、物品栏
- **战斗**：3 种怪物（僵尸/骷髅/苦力怕）、经验值、伤害飘字、音效
- **生物**：猪/羊/牛，可击杀掉肉；怪物夜间出没、白天日照燃烧
- **建造**：火把（照明）、门、梯子、箱子（存储）
- **存档**：localStorage 自动存档、世界种子、读档继续
- **画面**：程序生成纹理、星空、粒子效果

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
- 数字键 / 滚轮 切换方块
- `E` 打开合成 · `Q` 吃食物 · `ESC` 释放鼠标

## 项目结构

```
index.html      游戏外壳：DOM 元素、CSS、importmap、引入 game.js
src/
  data.js       纯数据层：常量、方块/物品定义、噪声、世界数据与地形、网格构建
  game.js       游戏逻辑：场景、玩家、怪物、掉落物、合成、UI、主循环
```

`data.js` 无外部依赖（buildMesh 接收 THREE 作为参数）；`game.js` import data.js 与 three。
后续会继续把 game.js 细分为 scene/player/mobs/crafting/ui 等模块。
