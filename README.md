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
│   │   ├── stores/              Zustand 状态与数据落库（含外场对账 store）
│   │   ├── types/               核心数据模型（含 sync 对账模型）
│   │   ├── utils/               Dexie、尺寸换算、JSON 导出、三方对账与同步引擎
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
- `version(3)`：为五张表回填单调递增的资料修订 `dataRev`，并新增 `syncBatches`（对账批次）、`reviewItems`（待复核项）、`syncMeta`（修订水位与外场封存）三张表。
- 首次创建数据库时通过 Dexie `populate` 回调写入榫卯、构件、步骤、内联 SVG 与家具关联的种子数据。
- 新建记录、尺寸修改、SVG 保存和步骤拖拽调序都会实时写回 IndexedDB，刷新页面后仍可读取。

## 外场回传对账

外场只带离线图鉴，回店再把现场测量与拆装记录导回店内资料，整条链路在“外场对账”页（`/sync`）完成：

1. **导出冻结**：出工前导出外场离线包，包内同时携带导出当时的基线快照与现场工作区，构件尺寸、拆装步骤、示意图的 `dataRev` 随包固定。
2. **外场记录**：在外场设备“装载为外场工作区”，店内资料整体封存（`syncMeta.shopStash`），现场只能改构件测量值与拆装风险说明，修订水位冻结不递增；完工后导出同批次的回传包。
3. **回店对账**：恢复店内资料后导入回传包，按 base（导出基线）/field（现场）/shop（店内当前）三方比对——
   - 店内未动过的构件，现场测量值直接落库；现场新增的风险说明自动保留；
   - 同一构件在店里也改过，现场值**不会覆盖**店内值，生成“待复核”项三方并排；
   - 步骤或示意图已在店内删除时，现场原记录保留在待复核项中并标明断点（绑定步骤同时消失为双重断点），可选择仅保留或重新挂接。
4. **幂等导入**：批次主键即 `batchId`，对账在单事务内完成，失败整体回滚；重复导入/重试只返回原批次，始终只有一条记录。
5. **同修订结案**：待复核项全部处理完后，该批榫卯的构件、步骤、示意图在同一事务内统一敲到同一个 `dataRev`，详情页、步序页、家具反查页显示同一“同修订 Rn”徽标。

逻辑与引擎验证（纯 Node，不依赖浏览器）：

```bash
cd frontend
npm run test:logic    # 三方对账纯逻辑：冲突/自动合并/断点/漂移
npm run test:engine   # fake-indexeddb 端到端：幂等导入、结案同修订、外场冻结/恢复
```

## 核心功能与路由表

| 路由 | 页面 | 核心功能 |
| --- | --- | --- |
| `/` | 入口重定向 | 自动进入榫卯图鉴 |
| `/joints` | 榫卯图鉴总览 | 按家族与难度分组，新建类型，显示构件数与步骤数，导出全部数据 |
| `/joints/:id` | 类型详情 | 查看尺寸表、公差校验、适用家具与步骤；导出当前类型 |
| `/joints/:id/steps` | 拆装步序编排 | 原生拖拽调序并落库，逐步预览内联 SVG 与风险提醒 |
| `/joints/:id/diagram` | 示意图绘制台 | 点击热区回填构件，编辑构件名称、尺寸与 SVG 源 |
| `/furniture` | 家具榫卯反查 | 按家具聚合使用部位与承力说明，新建家具关联，显示同修订徽标 |
| `/sync` | 外场回传对账台 | 导出离线包、装载外场工作区、导入回传包对账、查看批次 |
| `/sync/batches/:batchId` | 批次对账详情 | 三方并排处理待复核项（冲突/断点），结案统一修订 |
