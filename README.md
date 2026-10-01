# 榫卯结构拆解图鉴

面向传统木作学习者与家具设计人员的纯前端单页应用。项目把榫卯类型、构件尺寸、配合公差、拆装步骤、内联 SVG 示意图与适用家具整理为一套可查询、可编排、可追溯的本地图鉴，所有数据均保存在当前浏览器中。

## Docker 一键启动

```bash
cp .env.example .env && docker compose up -d --build
```

服务启动后访问：`http://localhost:21804`

停止服务：

```bash
docker compose down
```

## 技术栈

| 类别 | 技术 |
| --- | --- |
| UI | React 18、TypeScript 5 |
| 构建 | Vite 5 |
| 样式 | Tailwind CSS 3 |
| 路由 | React Router 6 |
| 状态 | Zustand 4 |
| 本地数据 | Dexie 4、IndexedDB |
| 容器 | Docker 多阶段构建、Nginx |

## 访问地址

- 宿主机端口：`21804`
- 页面地址：`http://localhost:21804`
- 前端路由回退由 Nginx 的 `try_files` 规则处理。

## 本地开发方式

```bash
cd frontend
npm install
npm run dev
```

类型检查与生产构建：

```bash
cd frontend
npm run build
```

本地开发默认使用 Vite 的 `5173` 端口；应用数据由浏览器中的 Dexie 数据库维护，不需要后端服务。

## 目录结构

```text
.
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/common/   共享 SVG、步骤轨道、尺寸字段和标签
│   │   ├── hooks/               步序编排与 SVG 热区解析
│   │   ├── pages/               图鉴、详情、步序、绘制台与家具反查
│   │   ├── router/              前端路由
│   │   ├── stores/              Zustand 状态与数据落库
│   │   ├── types/               核心数据模型
│   │   ├── utils/               Dexie、尺寸换算与 JSON 导出
│   │   ├── App.tsx
│   │   ├── index.css
│   │   └── main.tsx
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml
├── .env.example
└── README.md
```

## 数据存储说明

应用使用 IndexedDB，数据库封装库为 Dexie 4，库名为 `gbmortise-db`。

- `version(1)`：建立 `joints`、`members`、`steps`、`diagrams`、`furniture` 五张表及查询索引。
- `version(2)`：执行升级迁移，为五张表回填 `schemaRev = 2` 字段。
- `version(3)`：外场回传。为五张表回填统一修订号 `dataRev`，新增 `fieldBatches`（导入批次）、`fieldReviews`（待复核项）、`fieldRiskNotes`（外场新增风险说明）三张表。
- 首次创建数据库时通过 Dexie `populate` 回调写入榫卯、构件、步骤、内联 SVG 与家具关联的种子数据。
- 新建记录、尺寸修改、SVG 保存和步骤拖拽调序都会实时写回 IndexedDB，刷新页面后仍可读取。
- 任一榫卯资料发生店内编辑或现场回传生效，都会把该榫卯的类型、构件、步骤、示意图、家具关联整体推进到同一个新 `dataRev`，保证详情、步序、家具反查读到同一修订。

## 外场回传对账

工坊师傅外场拆家具只带离线快照，回店后按快照中的版本与店内资料对账：

- 导出现场快照（详情页“导出现场快照”或外场回传页）固定当时的构件尺寸、拆装步骤、示意图版本与统一修订号；外场可在步序页追加风险说明。
- 回店在 `/field` 导入 JSON：同修订构件的现场测量直接生效；同一构件在店里已改过（修订号更大）时现场值不覆盖，双列尺寸进入待复核。
- 外场新增风险说明始终保留为待复核；步骤或示意图在店内已不存在时，现场原记录原样保留并指出断点（缺失步骤、示意图失步）。
- 导入按导出批次号幂等：重复文件不重复记账；导入失败会登记一条失败批次，重试只更新同一条记录。
- 待复核项处理（采纳/驳回）后，采纳尺寸或风险会把该榫卯五类资料对齐到同一新修订；详情页顶部徽标显示当前统一修订号，资料错位时给出提示。
- 核心对账逻辑位于 `src/utils/fieldSync.ts`，可用 `node scripts/verify-field-sync.mjs` 跑场景验证。

## 核心功能与路由表

| 路由 | 页面 | 核心功能 |
| --- | --- | --- |
| `/` | 入口重定向 | 自动进入榫卯图鉴 |
| `/joints` | 榫卯图鉴总览 | 按家族与难度分组，新建类型，显示构件数与步骤数，导出全部数据 |
| `/joints/:id` | 类型详情 | 查看尺寸表、公差校验、适用家具与步骤；导出当前类型 |
| `/joints/:id/steps` | 拆装步序编排 | 原生拖拽调序并落库，逐步预览内联 SVG 与风险提醒 |
| `/joints/:id/diagram` | 示意图绘制台 | 点击热区回填构件，编辑构件名称、尺寸与 SVG 源 |
| `/furniture` | 家具榫卯反查 | 按家具聚合使用部位与承力说明，新建家具关联 |
| `/field` | 外场回传对账 | 导出现场快照、导入对账、处理待复核项与查看批次记录 |
