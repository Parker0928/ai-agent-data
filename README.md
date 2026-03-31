# AI Agent Data Monorepo

基于 **Turborepo + npm workspaces** 的多应用仓库，已包含：
- `apps/web`：Vue 3 + TypeScript + Vite 前端
- `apps/api`：NestJS（Express 适配层）+ TypeScript 后端
- `.github/workflows`：CI 与 Docker 发布流程模板
- `docker-compose.yml`：Dev / Staging / Prod 多环境编排

**架构与模块全景**（结构 → 核心能力 → 启动与端口）：见 [docs/project-overview.md](docs/project-overview.md)。

## 目录结构

```text
.
├─ apps/
│  ├─ web/          # 前端应用
│  └─ api/          # 后端应用
├─ packages/        # 共享包预留（配置、UI、SDK 等）
├─ turbo.json
├─ docker-compose.yml
└─ .github/workflows/
```

## 本地开发

```bash
npm install
npm run dev          # 并行启动 web + api
```

或单独启动：

```bash
npm run dev:web
npm run dev:api
```

## 构建与质量检查

```bash
npm run lint
npm run build
npm run test
```

## Web 主题规范（Neo-Brutalist）

前端 `apps/web` 统一采用 Bauhaus / Neo-Brutalist 视觉语言。为保证后续页面风格一致，请优先使用全局语义类，而不是在页面里重复硬编码 `border-2 + shadow-[x]`：

- `nb-card`：标准卡片（白底、黑边、6px 硬阴影）
- `nb-card-lg`：强调卡片（白底、黑边、8px 硬阴影）
- `nb-btn`：标准按钮边框与交互反馈
- `nb-btn-primary` / `nb-btn-secondary` / `nb-btn-neutral`：按钮语义色
- `nb-pill`：统一标签胶囊
- `nb-pill-primary` / `nb-pill-secondary` / `nb-pill-tertiary`：标签语义色
- `nb-input`：统一输入框（黑边、圆角、硬阴影）

颜色语义约定：

- 蓝色（primary）：主操作、主导航、核心正向动作
- 红色（secondary / error）：风险操作、告警、负向状态
- 黄色（tertiary）：提示、重点信息、强调但非风险

建议：新增页面时先组合 `nb-*` 类，再补充业务特有类，避免主题风格漂移。

## 智能对话（Chat）调优

后端 `apps/api` 支持通过环境变量微调回复质量与行为（默认已较均衡）：

| 变量 | 说明 |
|------|------|
| `CHAT_HISTORY_MESSAGES` | 注入多轮上下文的最大条数（user+assistant 各算一条），默认 `20`，上限 `32` |
| `CHAT_TEMPERATURE_RAG` | **有**知识库片段时的温度，默认 `0.35`（更贴资料） |
| `CHAT_TEMPERATURE_GENERAL` | **无**检索片段时的温度，默认 `0.65`（更自然） |
| `CHAT_MAX_COMPLETION_TOKENS` | 单次回复上限 token，默认 `3072` |
| `MINIMAX_REASONING_SPLIT` | 设为 `false` 可关闭 MiniMax `reasoning_split`（若兼容异常可试） |

流式输出会过滤模型自带的「思考 / think」标签包裹片段，避免推理过程泄漏到界面与数据库。

### 智能对话「分析看板」结构化输出（可选）

当模型在回复末尾输出如下 JSON 代码块（` ```json ` … ` ``` `）时，前端会自动：

- 在气泡中隐藏该 JSON；**正文以 Markdown 渲染**（表格、标题、列表等）
- **仅当 JSON 内含有** `kpis` / `salesRows` / `summary` 之一时，才显示下方「结构化指标」白色看板（不会再用整段助手正文充当摘要，避免与气泡重复）
- 用 JSON 中的 `followUps`（若有）或页面默认追问，渲染气泡下方的追问 chips

约定字段（`schema` 建议固定为 `chat_insight_v1`）：

- `summary`：可选，摘要文案（优先于纯文本作为「分析摘要」）
- `kpis`：`{ label, value, delta, positive }[]`
- `salesRows`：`{ region, amount, ratio, trend }[]`，`trend` 仅 `上涨` / `下降` / `稳定`
- `followUps`：追问文案数组（否则使用页面默认追问）

## Docker 与多环境发布

## 认证接口（Auth）

后端已支持登录与注册（返回 JWT，前端会自动持久化）：

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/me`（需 `Authorization: Bearer <token>`）

注册规则：

- 邮箱：必须是合法邮箱格式
- 密码：长度 8~128
- 邮箱唯一：已注册邮箱会返回冲突错误

兼容路由（无 `/api` 前缀）也可用：

- `POST /auth/login`
- `POST /auth/register`

环境文件：
- `apps/web/.env.development | .env.staging | .env.production`
- `apps/api/.env.development | .env.staging | .env.production`

本地开发（Docker + 前端热更新 HMR）：

```bash
docker compose --profile dev up -d postgres api web-dev
```

前端访问地址仍为：

```text
http://localhost:8080
```

本地按环境启动（示例：staging）：

```bash
APP_ENV=staging docker compose --profile staging up --build
```

## GitHub Actions

- `ci.yml`：PR / push 时执行 install + lint + build + test
- `docker-release.yml`：推送到主干或手动触发时，构建并推送 dev/staging/prod 镜像到 GHCR
