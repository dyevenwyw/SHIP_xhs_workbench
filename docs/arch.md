# 架构说明

本文档描述 `SHIP_xhs_workbench` 的整体架构，面向贡献者与进阶使用者。

## 1. 总览

单机部署的本地工具：浏览器前端 + 本地 Express 后端 + 内嵌的抓取 CLI（OpenCLI）。
数据与配置均落在本地磁盘，通过 `config/` 目录下的 JSON 管理。

```
┌────────────┐   /api (REST)   ┌────────────────────────────┐
│ Web (React) │ ─────────────▶ │ Server (Express)            │
└────────────┘                 │  routes / library / skills  │
                               │  opencli.js (调度)           │
                               └──────────┬─────────────────┘
                                          │ 串行调用 + 随机间隔
                              ┌───────────▼─────────────────┐
                              │ vendor/opencli (OpenCLI)     │
                              └───────────┬─────────────────┘
                                          ▼
                                      目标站点
```

## 2. 目录职责

| 目录 | 职责 |
|------|------|
| `server/src/routes/` | 业务接口：调研 / 分析 / 文案 / 发布 / 参数 / 素材 |
| `server/src/opencli.js` | 抓取调度核心：全局串行队列 + 5~20s 随机间隔 + 风控信号检测与全局停止 |
| `server/src/llm.js` | OpenAI 兼容流式调用（SSE 逐 token），含超时与瞬时错误重试 |
| `server/src/library.js` | 素材库：入库、索引、去重、封面查找 |
| `server/src/skills.js` + `server/skills-core/` | 文案方法论（提示词）的加载与按名调用 |
| `server/src/config.js` + `paths.js` | 配置读写与路径管理（支持环境变量覆盖） |
| `web/src/` | React 前端：单页流式工作流（调研→选题→文案→素材） |

## 3. 关键设计

### 3.1 串行抓取调度（`opencli.js`）
为保证对目标站点友好并降低风控风险，所有抓取请求：
- 由**全局 Promise 队列**串行执行，同一时刻仅一个请求在途；
- 每次请求间隔在 `[minIntervalMs, maxIntervalMs]` 内**随机化**（默认 5~20s）；
- 响应/输出命中 `riskKeywords`（如 `安全限制`）时，触发**全局风控停止**，需人工在界面点击重置。

### 3.2 LLM 调用（`llm.js`）
- 仅支持 OpenAI 兼容的 `/chat/completions`；
- 流式返回支持 `onToken` 逐 token 回调（前端逐字展示）；
- 仅对连接/5xx/429/超时等瞬时故障重试，开始读取响应体后不再重试，避免重复产出。

### 3.3 方法论的动态加载（`skills-core`）
`server/skills-core/*.md` 为文案生成提示词模板，由后端在启动时扫描加载，前端按名称选用。增删一个文件即可新增/下线一种文案风格，无需改动业务代码。

## 4. 配置与路径

- 路径集中在 `server/src/paths.js`，可通过同名环境变量覆盖关键项（如 `OPENCLI_MAIN`）。
- 运行时配置在 `config/*.json`，由 `config.js` 提供默认兜底与合并。

## 5. 数据存储

运行时数据写入 `data/` 与 `output/`（均为 `.gitignore` 排除项）：
- `data/library/`：素材库（笔记 JSON、OCR 文本、图片）
- `data/library/index.json`：素材索引
- `data/drafts/`、`data/analysis/`：草稿与分析结果
- `output/`：生成的报告与图片

首次启动由 `server/src/bootstrap.js` 自动创建所需目录。