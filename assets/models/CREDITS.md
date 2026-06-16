# 3D 模型素材来源与授权 (3D Model Credits)

本目录的所有 3D 模型均为 **CC0 (公共领域)** 授权，可自由商用、修改、再分发。
格式为 **glTF Binary (.glb)**，低多边形（low-poly），适合 Three.js / WebGL 加载。

## 来源
- **poly.pizza** (https://poly.pizza) — Kenney 运营的 CC0 3D 模型库
- 原作者：**Quaternius** (https://quaternius.com) — CC0 低多边形游戏素材

## 目录
- `weapons-items/` — 55 个模型：武器与道具
  （剑/斧/锤/匕首/弓/弩/盾/法杖/药水/钥匙/金币/宝箱/书/宝石等）
  来源 bundle: Ultimate RPG Items Bundle
- `monsters/` — 45 个模型：怪物与生物
  （蝙蝠/蜘蛛/史莱姆方块/骷髅/幽灵/鱼/鲨鱼/青蛙/蛇等）
  来源 bundle: Ultimate Monsters Bundle
- `survival/` — 43 个模型：生存/环境道具（Kenney Survival Kit）

每个目录下的 `_index.png` 是该批模型的缩略图索引（文件名前 8 位 = GLB 文件名）。

## 用途规划（贴图升级后续）
- 用 weapons-items 里的剑/镐替换当前"肤色长方体手"，做出真实武器手感
- 用 monsters 里的低多边形怪替换当前 BoxGeometry 拼的方块怪
- GLB 用 Three.js 的 GLTFLoader 加载（已通过 CDN importmap 可引入）

## 注意
GLB 内嵌节点名为通用 "RootNode"（Quaternius 导出惯例），
具体模型靠 `_index.png` 缩略图辨认，文件名为 poly.pizza 的模型 ID。
