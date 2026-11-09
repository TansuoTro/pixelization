# Minecraft Sprite Sheet Studio

**纯浏览器 / 纯 TypeScript 的 Minecraft 图集（Sprite Sheet）生成器。** 没有后端、没有 Python、没有 serverless function —— `npm run build` 产出一个静态 `dist/`，直接部署到 Netlify 即可。

一次 Prompt 让模型在**同一张图**里画出 4×4 / 5×5 / 4×6 等多个独立物品，随后浏览器内完成网格检测、按格切分、逐格重采样到 16/32/64、MedianCut 量化、透明背景处理、拼版预览与 ZIP 导出。

> 仓库内的 `backend/`（旧 Python FastAPI 版）与 `frontend/`（旧 React+后端版）保留作为算法参考，**不参与构建、不参与部署**。

---

## 快速开始

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # -> dist/
npm run preview    # 本地预览构建产物
npm run selftest   # 纯离线算法自检（不请求任何 API）
```

## 部署到 Netlify

`netlify.toml` 已配置好：

```toml
[build]
  command = "npm run build"
  publish = "dist"
```

直接在 Netlify 里连这个仓库即可，无需任何环境变量、无需构建插件。

### 关于 CORS（重要）

**请求一直是由用户浏览器自己发出的** —— 本项目没有后端、没有 serverless function，Key 只存在浏览器 localStorage，每次请求都从浏览器直接发出。`/proxy/*` 只是 Netlify 的**静态边缘 rewrite**（CDN 转发），不是服务端计算。

CORS 是浏览器强制的安全策略，不是架构选择：当 JS 从 `xxx.netlify.app` 请求 `api.code-tab.com` 时，请求其实已经发出，但只有**目标服务器在响应里返回 `Access-Control-Allow-Origin`**，浏览器才把响应交给 JS；否则 JS 只看到 `Failed to fetch`。

| 方案 | 谁能用 | 说明 |
| --- | --- | --- |
| **直连绝对地址** `https://api.code-tab.com/v1` | 端点**自己返回 CORS 头**时 | 最省事，不需要任何 rewrite。很多第三方中转站支持；OpenAI 官方、火山方舟通常不支持 |
| **同源相对路径** `/proxy/codetab` | 任何情况 | 浏览器请求变成同源，由 Netlify 边缘 rewrite 转发到目标；仍是纯静态站点、仍是浏览器发起 |

前端无法绕过 CORS（`mode: "no-cors"` 只能拿到 opaque 响应读不到 JSON，JSONP 也发不了带 `Authorization` 的 POST）。所以**只有端点自己开 CORS，或走同源转发**两条路。设置面板里有「测试直连是否可用」按钮（仅在你点击时发一次 `GET /models`，不做生成调用），一键判断该端点属于哪种情况。

本项目用静态边缘 rewrite 做同源转发：

| 同源路径（设置里填这个） | 转发目标 |
| --- | --- |
| `/proxy/openai` → 请求 `/proxy/openai/images/generations` | `https://api.openai.com/v1/images/generations` |
| `/proxy/ark` → 请求 `/proxy/ark/images/generations` | `https://ark.cn-beijing.volces.com/api/v3/images/generations` |
| `/proxy/codetab` → 请求 `/proxy/codetab/images/generations` | `https://api.code-tab.com/v1/images/generations` |

**加自己的中转端点**（例如 `https://api.code-tab.com`）：照下面格式在 `netlify.toml` 加一条，然后在设置里把地址填成对应的 `/proxy/xxx` 相对路径：

```toml
[[redirects]]
  from = "/proxy/codetab/*"
  to = "https://api.code-tab.com/v1/:splat"
  status = 200
  force = true
```

本地开发还要在 `vite.config.ts` 的 `server.proxy` 里加等价的一条，否则 `npm run dev` 时代理不生效。

### ⚠️ `_redirects` 与 `netlify.toml` 的顺序陷阱（最常见的坑）

Netlify 官方规则：**`_redirects` 里的规则永远先于 `netlify.toml` 里的规则处理**。所以 `public/_redirects` 里如果存在 `/*  /index.html  200` 这种兜底，它会**抢在 `/proxy/*` 转发之前**命中，把 API 请求变成 HTML 首页 —— 表现就是：

```
Unexpected token '<', "<!doctype ..." is not valid JSON
```

本项目因此**只在 `netlify.toml` 里放重定向规则**，`public/_redirects` 保持无规则（仅注释）。另外加了一条 `/proxy/*` → 404 JSON 的守卫：任何没匹配到转发的代理路径会返回一条明确的 JSON 错误信息，而不是悄悄回落到首页。

> 改完 `netlify.toml` 必须**重新部署**才生效；本地改完 `vite.config.ts` 必须**重启 `npm run dev`**。

### `Failed to fetch` 排查

这个报错是浏览器**网络层就失败**（没有 HTTP 状态码），几乎总是 CORS，不是 key 或模型名错误。按顺序检查：

1. **设置里的端点是不是填了绝对 `https://` 地址？** 页面在 `xxx.netlify.app`，直连 `api.code-tab.com` 属于跨域，浏览器会拒绝并报 `Failed to fetch`。改成同源相对路径 `/proxy/codetab`（设置面板里有快捷按钮，填绝对地址时会给出黄色警告）。
2. **`netlify.toml` 的改动是否真的部署了？** rewrite 只在部署后生效；改完要重新部署。本地则必须**重启** `npm run dev` 让 vite proxy 重新加载配置。
3. **路径是否对得上？** `from = "/proxy/codetab/*"` 且 `force = true`，SPA fallback `/*` 必须放在最后一条。
4. DevTools → Network 看该请求：若显示 `(blocked: CORS)` / 无响应，就是第 1 或第 2 条；若有 4xx/5xx 状态码，则已经打通，是 key / model / 参数问题。
5. 应用现在会把裸的 `Failed to fetch` 翻译成具体的诊断文字并显示出来。

`vite.config.ts` 里配了等价的 dev proxy，所以本地 `npm run dev` 也能用。浏览器仍然自己发 `Authorization` 头，Key 不经过构建、不落到日志。

如果你填的是自己的、已经允许 CORS 的自定义端点，直接填完整 URL 即可；若端点不支持 CORS，可在 `netlify.toml` 里照上方格式加一条 rewrite，然后把地址填成对应的 `/proxy/xxx` 相对路径。

---

## 设置里能配什么

点右上角「设置」，配置保存在**本机浏览器 localStorage**（不上传服务器）：

| Provider | 必填 | 说明 |
| --- | --- | --- |
| **OpenAI / GPT Image** | 只填 `sk` | 内置端点 `/proxy/openai` 与默认模型；支持 GPT Image 原生能力 |
| **SeeDream（火山方舟）** | 只填 `sk` | 内置端点 `/proxy/ark`，默认 `doubao-seedream-*`；可设 `output_format` / `watermark` |
| **自定义端点（OAI 格式兼容）** | 地址 + `sk` + **model** | 用 OpenAI 兼容格式请求；model 必须自己填 |

- **模型名始终可以自由编辑**，包括自定义端点。内置候选（GPT Image 1 / 1.5 / 2 / 2.5 / Sunburst 等）只是快捷填充，不是权威列表。
- 「**拉取模型列表（/models）**」按钮会调用所选端点的 `GET /models`，用你填的 sk 拉取真实模型 ID 供选择。部分中转/网关不开放该接口，会给出提示，直接手填模型名即可。
- SeeDream 默认请求 `response_format=b64_json`，避免返回图片 URL 造成跨域 Canvas 污染。
- 参考图：OpenAI 走 `/images/edits`（multipart），SeeDream 走 `image` 字段；可在「高级」里整体关闭。

### 火山方舟 API 依据

`POST https://ark.cn-beijing.volces.com/api/v3/images/generations`，头 `Authorization: Bearer <ARK_API_KEY>`，字段：

```json
{
  "model": "doubao-seedream-4-0-250828",
  "prompt": "...",
  "size": "2K",
  "response_format": "b64_json",
  "output_format": "png",
  "watermark": false,
  "sequential_image_generation": "disabled"
}
```

响应 `data[0].b64_json` 或 `data[0].url`。参考图生图用 `image` 字段（URL 或 data URL）。
文档：<https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh>

---

## 功能

### 1. 图集 Prompt（固定基础约束 + 可调部分）

- **固定**：对齐网格 FORMAT 规则、ART STYLE、LIGHTING、MATERIAL LANGUAGE（铜/铁/钢/钛/钨色系）、BACKGROUND、以及 IMPORTANT（禁文字/编号/水印/合并遗漏）。自定义 Prompt 也会强制追加这些基础规则。
- **可调**：物品清单、网格行列、风格预设（原版物品 / GTCEu 工业 / Faithful / 方块图集 / 机器六面 / 动画帧 / 自定义）、背景色、附加指令、完全自定义覆盖。
- **精准位置关系**：Prompt 里给每个格子写明 `CELL r2c3 (#7, row 2, column 3) -> "Steel gear"`，外加一张 ASCII 网格编号图。
- 支持**参考图**（上传 / 拖放 / `Ctrl+V`），影响强度 LOW/MEDIUM/HIGH 与补充说明都写进 Prompt，同时重述严格网格规则防止参考图构图带偏布局。

### 2. 后处理（先切分，再逐格采样；全程实时可调，不再请求 API）

1. **背景检测**：GPT Image / SeeDream 常输出白底而非真透明。按四角取色或指定色键（白/黑/品红/绿）+ 容差，再用**边界连通泛洪**（8 连通）只保留连到图边的背景 —— 精灵内部的同色高光不会被误删。
2. **网格检测**：背景投影剖面 → 在每个预期边界 ±30% 窗口内找最宽「白色间隔」平台的中心；不可靠时回退均匀切分。图上有实时网格叠层。
3. **逐格处理**：裁切 → 去背 → 裁到内容包围盒（可选留白）→ 补成正方形 → 重采样 → 二值 Alpha → MedianCut 量化。
4. **6 种采样方法**：Nearest / Bilinear / Bicubic / Lanczos / Box / Hamming，均为纯 TS 可分离卷积（预乘 Alpha，避免透明黑边；下采样时按缩放比扩展卷积核做低通抗锯齿）。
5. **可调参数**：目标 16/32/64、采样方法、调色板色数、Alpha 阈值、量化开关、二值 Alpha、背景模式+容差、格子内缩、裁切留白、自动网格检测、item/block 整格模式。

### 3. 全局 vs 单格 PIN 覆盖

- 点任意格子 → **Pin independent params** 给它复制一份自己的参数，图标出现 **PIN 标记**。
- 之后**全局怎么调都不影响它**；只改它的参数，也只有它变。
- 点 PIN 标记或「取消固定」→ 重新跟随全局。
- 「保存此精灵」导出的是该格子按自己参数跑出的最终 PNG；「下载全部 (.zip)」同样遵守各格独立参数，manifest 带 `[PINNED]` 标记。
- 网格检测 / 网格几何是整张图集的结构参数，保持全局；其余参数都可单格覆盖。

### 4. 其余

- 原始图集 PNG 下载、检测网格叠层、标注拼版预览（含空格 / PIN 标记）、空格与遗漏检测。
- 内置像素编辑器（画笔 / 橡皮 / 吸管 / 调色板 / 网格 / 撤销重做 / 1:1 PNG 导出）。
- **载入已有图集**：完全离线路径，跳过 AI，只跑分割与后处理。
- 纯静态、无后端、无数据库；所有图像运算都在浏览器 Canvas/ImageData 上完成。

---

## 项目结构

```
index.html  netlify.toml  vite.config.ts  package.json
public/_redirects
scripts/selftest.ts          # 离线算法自检
src/
  App.tsx  main.tsx  index.css  types.ts
  config/   options.ts  settings.ts        # 常量 + localStorage 设置
  services/ prompts.ts  providers.ts      # Prompt 模板 + 三个 Provider 客户端
  core/     image.ts  background.ts  grid.ts  resample.ts
            quantize.ts  sheet.ts          # 纯 TS 图像管道
  components/ SettingsModal.tsx  SheetStudio.tsx
            ui.tsx  PixelEditor.tsx
backend/  frontend/                        # 旧版实现，仅作参考，不参与构建
```

## 安全说明

API Key 只存在 localStorage，并随每次请求直接发往所选端点。请勿在公用设备使用，建议使用权限受限、可随时吊销的 Key。设置面板里可一键「清除本机保存」。

## 验证

```bash
npm run typecheck   # 严格 TS 类型检查
npm run selftest    # 离线算法自检（合成图集，无任何网络/API 请求）
npm run build       # 生产构建
```
