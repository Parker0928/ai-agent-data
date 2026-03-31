# AI-Agent-Data 项目说明（结构 · 核心 · 启动）

本文档汇总仓库的定位、目录与技术栈、后端模块与业务能力、前端路由与请求方式、基础设施与启动命令。与根目录 [README.md](../README.md) 互补：README 偏快速上手与本主题约定，本文偏架构与全景。

---

## 1. 仓库定位

基于 **Turborepo + npm workspaces** 的 monorepo：Vue 3 前端、NestJS API、Postgres（pgvector）、CI 与 Docker 编排同仓维护。Node **≥20**。

```text
.
├── apps/web/          # 前端：Vue 3 + TS + Vite + Tailwind v4
├── apps/api/          # 后端：NestJS（@nestjs/platform-express）+ TS
├── packages/config/   # 共享包占位（当前仅 package.json）
├── turbo.json
├── docker-compose.yml
└── .github/workflows/ # ci.yml、docker-release.yml
```

---

## 2. 前端 `apps/web`

| 项 | 说明 |
|----|------|
| 入口 | `src/main.ts`：`createApp` → `router` → `#app`，全局 `style.css` |
| 根组件 | `App.vue`：当前为 `<RouterView />`（无额外全局装饰层） |
| 路由 | `src/router/index.ts`：`/login`、`/register` 公开；`/` 下 `MainLayout`（需登录），子路由：`overview`、`chat`、`knowledge`、`market`、`history`、`analysis` |
| 布局 | `MainLayout.vue`：固定侧栏 `AppSidebar` + 右侧内容区 |
| 鉴权 | `composables/useAuth.ts` + `lib/apiFetch`：`localStorage` 存 `jwt_token`；路由前置 `fetchMe` |
| HTTP | `lib/apiClient.ts`：路径统一加 `/api`；开发期 Vite 代理 `/api` 与 `/auth`（`/auth` rewrite 到 `/api/auth`） |

**依赖要点**：Vue 3、Vue Router 4、Tailwind 4、`marked` + `dompurify`（对话 Markdown 等）。

**UI 约定**：Neo-Brutalist 语义类 `nb-card`、`nb-btn` 等见 README「Web 主题规范」。

---

## 3. 后端 `apps/api`

**入口** `src/main.ts`：Nest 工厂创建应用；**全局前缀 `api`**；`bodyParser` JSON 上限约 **18MB**（聊天附件）；CORS 放开。

| 模块 | 职责概要 |
|------|-----------|
| `DatabaseModule` | Postgres 连接与 schema 相关 |
| `AuthModule` | 登录 / 注册 / JWT、`GET /api/auth/me`；兼容无前缀 `/auth/*` |
| `KnowledgeModule` | 文档或 URL 入库、分块、embedding、向量检索（LangChain `OpenAIEmbeddings`） |
| `ChatModule` | 流式对话、会话历史、附件；RAG 拼接与系统提示词 |
| `OverviewModule` | 仪表盘类聚合 |
| `AnalysisModule` | 分析指标与洞察 API |
| `MarketModule` | 智能体市场 |
| `HistoryModule` | 历史会话管理 |
| `HealthController` | `GET /api/health`（Compose healthcheck） |

**核心能力**

1. **对话**：OpenAI 兼容 API（默认基座可配置为 MiniMax 等）；可结合检索片段；环境变量可调历史条数、温度、completion token 等（见 README 表格）。流式路径会过滤模型「思考」类标签（`stream-thinking.util`）。
2. **知识库**：多格式抽取（如 PDF、mammoth、cheerio、OCR 等）→ 分块 → 向量写入；受 `ENABLE_EMBEDDINGS` 等开关影响。
3. **结构化看板**：提示词约定可选 JSON 块 `chat_insight_v1`（`kpis` / `salesRows` / `summary` / `followUps`），前端解析展示（见 README「智能对话」一节）。

**测试**：`npm run test` → `tsx --test`（工作区 `@apps/api`）。

---

## 4. 数据与 Docker

- **数据库**：`pgvector/pgvector:pg16`，库名 `ai_agent_data`。容器内 API 通过服务名 `postgres` 连接。Compose 中 API 常注入 `DATABASE_URL` 覆盖本地 localhost。
- **端口习惯**：宿主机 **3020 → 容器 API 3000**；开发前端 **8080 → 容器 Vite 5173**；Postgres **5432**。

前端在生产/局域网场景下可能通过同源反代或 `VITE_API_BASE_URL`；`apiClient` 含同 host 的 3020/3000 等候选 fallback。

---

## 5. 启动方式

**本地（不启 Docker）**

```bash
npm install
npm run dev              # turbo 并行 web + api
npm run dev:web
npm run dev:api
```

需本机 Postgres 与 `apps/api/.env.development` 中 `DATABASE_URL` 一致。Vite 默认将 `/api` 代理到 `http://127.0.0.1:3000`（可用 `VITE_DEV_API_PROXY` 覆盖）。

**仅数据库**

```bash
npm run dev:db
```

**Docker 开发栈（见 README）**

```bash
docker compose --profile dev up -d postgres api web-dev
```

浏览器：<http://localhost:8080>。容器内 `VITE_DEV_API_PROXY=http://api:3000`。

**质量**

```bash
npm run lint
npm run build
npm run test
```

---

## 6. 与 README 的分工

- **README**：命令、环境文件路径、主题类名、Chat 调优变量、认证路由、Docker 多 profile、GitHub Actions。
- **本文档**：结构与模块地图、前后端协作方式、能力边界与启动全景，便于新人 onboarding 与评审。

文档随代码演进需手动更新；若模块或端口变更，请同步修改本节与 README。
