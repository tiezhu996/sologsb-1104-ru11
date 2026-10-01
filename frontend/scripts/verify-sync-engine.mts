/**
 * 同步引擎端到端验证（fake-indexeddb，npm run test:engine）：
 * 导出冻结 → 外场改动 + 店内并行改动 → 幂等导入 → 待复核 → 结案同修订；
 * 另含外场装载/回店恢复与版本冻结。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import { db, ensureSeedData } from '../src/utils/db.ts'
import { putWithRev } from '../src/utils/revision.ts'
import {
  buildFieldBundle,
  checkJointConsistency,
  getRevisionState,
  importFieldBundle,
  listBatches,
  listReviewItems,
  loadFieldBundleOffline,
  resolveReviewItem,
  restoreShopStash,
} from '../src/utils/syncEngine.ts'
import type { FieldBundle } from '../src/types/sync.ts'

const JOINT = 'joint-dovetail'
const M_A = 'member-dt-tenon'
const M_B = 'member-dt-socket'
const S1 = 'step-dt-1'
const S2 = 'step-dt-2'
const D1 = 'diagram-dovetail'

async function reset(): Promise<void> {
  await db.table('syncMeta').clear()
  await Promise.all([db.joints.clear(), db.members.clear(), db.steps.clear(), db.diagrams.clear(), db.furniture.clear(), db.syncBatches.clear(), db.reviewItems.clear()])
}

// —— 场景一：完整对账链路 ——
{
  await reset()
  await ensureSeedData()

  const bundle: FieldBundle = await buildFieldBundle('外场张三')
  assert.ok(bundle.batchId.startsWith('batch-'))
  assert.equal(bundle.headDataRev, 1)

  // 外场：A、B 两个构件都重新量过；第 1 步补记风险说明
  const fieldA = bundle.field.members.find((m) => m.id === M_A)!
  const fieldB = bundle.field.members.find((m) => m.id === M_B)!
  fieldA.lengthMm = 200
  fieldB.lengthMm = 210
  const fieldS1 = bundle.field.steps.find((s) => s.id === S1)!
  fieldS1.riskNote = '外场新增：先垫软木，肩角易崩。'

  // 店内并行：A 也被改过（形成尺寸冲突）；删除第 2 步与示意图（形成断点）
  const shopA = (await db.members.get(M_A))!
  await putWithRev({ ...shopA, lengthMm: 130 })
  await db.steps.delete(S2)
  await db.diagrams.delete(D1)

  const first = await importFieldBundle(bundle)
  assert.equal(first.created, true)
  assert.equal(first.batch.status, 'open')

  // 导入失败重试 / 重复导入：仍只有一条批次、一组待复核
  const second = await importFieldBundle(bundle)
  assert.equal(second.created, false)
  const batches = await listBatches()
  assert.equal(batches.length, 1)
  const reviews = await listReviewItems(bundle.batchId)
  assert.equal(reviews.length, 3, '应恰为 尺寸冲突 + 步骤断点 + 示意图断点 三项')
  const kinds = reviews.map((r) => r.kind).sort()
  assert.deepEqual(kinds, ['diagram-orphan', 'member-conflict', 'step-orphan'])

  // 自动合并：B 的现场测量与 S1 的现场风险说明已直接落库，且没有盖掉店内 A 的值
  const shopAAfter = (await db.members.get(M_A))!
  assert.equal(shopAAfter.lengthMm, 130, '店内改过的构件不得被现场值覆盖')
  const shopBAfter = (await db.members.get(M_B))!
  assert.equal(shopBAfter.lengthMm, 210, '店内未动的构件采用现场测量')
  const shopS1After = (await db.steps.get(S1))!
  assert.equal(shopS1After.riskNote, '外场新增：先垫软木，肩角易崩。')

  // 断点：现场记录被保留，店内记录仍缺失
  assert.equal(await db.steps.get(S2), undefined)
  assert.equal(await db.diagrams.get(D1), undefined)
  const stepBreak = reviews.find((r) => r.kind === 'step-orphan')!
  assert.ok(stepBreak.breakpointNote)
  assert.equal(stepBreak.shopSnapshot, null)
  assert.equal((stepBreak.fieldSnapshot as { seq: number }).seq, 2)

  // 逐项复核：A 采用现场值；步骤断点保留不恢复；示意图断点采用现场记录重新挂接
  const memberConflict = reviews.find((r) => r.kind === 'member-conflict')!
  const diagramOrphan = reviews.find((r) => r.kind === 'diagram-orphan')!
  const r1 = await resolveReviewItem(memberConflict.id, 'field')
  assert.equal(r1.closed, false)
  const r2 = await resolveReviewItem(stepBreak.id, 'shop')
  assert.equal(r2.closed, false)
  const r3 = await resolveReviewItem(diagramOrphan.id, 'field')
  assert.equal(r3.closed, true, '最后一项处理完应结案')
  assert.equal((await db.members.get(M_A))!.lengthMm, 200)
  assert.equal(await db.steps.get(S2), undefined, '选择保留断点则不恢复步骤')
  const restoredDiagram = await db.diagrams.get(D1)
  assert.ok(restoredDiagram, '示意图按现场记录恢复')

  // 结案：该榫卯构件/步序/示意图统一在同一修订
  const [finalBatch] = await listBatches()
  assert.equal(finalBatch.status, 'reconciled')
  const commitRev = finalBatch.committedDataRev!
  assert.ok(commitRev > 1)
  const consistency = await checkJointConsistency(JOINT)
  assert.equal(consistency.committedRev, commitRev)
  assert.equal(consistency.consistent, true, '详情、步序、示意图应读到同一修订')
  const revState = await getRevisionState()
  assert.equal(revState.jointRevs[JOINT], commitRev)
}

// —— 场景二：无待复核时导入即结案 ——
{
  await reset()
  await ensureSeedData()
  const bundle = await buildFieldBundle('外场李四')
  const fieldB = bundle.field.members.find((m) => m.id === M_B)!
  fieldB.widthMm = 99
  const result = await importFieldBundle(bundle)
  assert.equal(result.batch.status, 'reconciled')
  assert.equal(result.batch.summary.autoApplied, 1)
  assert.equal((await db.members.get(M_B))!.widthMm, 99)
  const consistency = await checkJointConsistency(JOINT)
  assert.equal(consistency.consistent, true)
}

// —— 场景三：外场装载版本冻结，回店恢复无损 ——
{
  await reset()
  await ensureSeedData()
  const beforeA = (await db.members.get(M_A))!
  const bundle = await buildFieldBundle('外场王五')

  await loadFieldBundleOffline(bundle)
  let state = await getRevisionState()
  assert.equal(state.fieldMode, true)
  const loadedA = (await db.members.get(M_A))!
  assert.equal(loadedA.lengthMm, beforeA.lengthMm)

  // 外场改动：版本冻结不推进水位
  const revBefore = (await getRevisionState()).headDataRev
  await putWithRev({ ...loadedA, lengthMm: 333 })
  state = await getRevisionState()
  assert.equal(state.headDataRev, revBefore, '外场改动不得推进修订水位')
  assert.equal((await db.members.get(M_A))!.lengthMm, 333)

  // 回店恢复：现场工作区丢弃，店内值原样回来
  await restoreShopStash()
  state = await getRevisionState()
  assert.equal(state.fieldMode, false)
  assert.equal((await db.members.get(M_A))!.lengthMm, beforeA.lengthMm)
}

// —— 场景四：损坏文件导入失败不留记录 ——
{
  await reset()
  await ensureSeedData()
  await assert.rejects(() => importFieldBundle({ kind: 'wrong' }), /批次标识/)
  assert.equal((await listBatches()).length, 0)
}

console.log('同步引擎端到端验证全部通过 ✔ (4 组场景)')
