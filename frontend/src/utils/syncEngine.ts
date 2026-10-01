import { db, getSyncMeta } from './db'
import { planReconciliation, reviewItemId } from './reconcile'
import type { Diagram } from '../types/diagram'
import type { Furniture } from '../types/furniture'
import type { JointType } from '../types/jointType'
import type { Member } from '../types/member'
import type { DisassemblyStep } from '../types/step'
import type { FieldBundle, ReviewItem, SyncBatch, SyncMeta } from '../types/sync'

export const BUNDLE_KIND = 'gbmortise-field-bundle'
const BUNDLE_FORMAT = 1

function encodeSnapshot(payload: unknown): string {
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
}

function decodeSnapshot<T>(encoded: string): T {
  return JSON.parse(decodeURIComponent(escape(atob(encoded)))) as T
}

export function createBatchId(): string {
  return `batch-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 每次导出固定当时的构件尺寸、拆装步骤和示意图版本（dataRev 随包冻结）。 */
export async function buildFieldBundle(exportedBy: string): Promise<FieldBundle> {
  const meta = await getSyncMeta()
  if (meta.fieldMode) throw new Error('外场模式下请使用“导出回传包”，不能重复导出离线图鉴。')
  const [joints, members, steps, diagrams, furniture] = await Promise.all([
    db.joints.toArray(),
    db.members.toArray(),
    db.steps.toArray(),
    db.diagrams.toArray(),
    db.furniture.toArray(),
  ])
  const snapshot = {
    joints: structuredClone(joints),
    members: structuredClone(members),
    steps: structuredClone(steps),
    diagrams: structuredClone(diagrams),
    furniture: structuredClone(furniture),
  }
  return {
    kind: BUNDLE_KIND,
    formatVersion: BUNDLE_FORMAT,
    batchId: createBatchId(),
    exportedAt: new Date().toISOString(),
    exportedBy: exportedBy.trim() || '外场师傅',
    base: snapshot,
    field: structuredClone(snapshot),
    headDataRev: meta.headDataRev,
  }
}

/** 外场改完后回传：基线与批次号不变，只更新现场记录。 */
export async function buildReturnBundleFile(): Promise<FieldBundle> {
  const meta = await getSyncMeta()
  if (!meta.fieldMode || !meta.fieldBase || !meta.fieldBatchId) {
    throw new Error('当前不在外场模式，没有可回传的现场记录。')
  }
  const base = decodeSnapshot<FieldBundle['base']>(meta.fieldBase)
  const [joints, members, steps, diagrams, furniture] = await Promise.all([
    db.joints.toArray(),
    db.members.toArray(),
    db.steps.toArray(),
    db.diagrams.toArray(),
    db.furniture.toArray(),
  ])
  return {
    kind: BUNDLE_KIND,
    formatVersion: BUNDLE_FORMAT,
    batchId: meta.fieldBatchId,
    exportedAt: meta.fieldExportedAt ?? new Date().toISOString(),
    exportedBy: meta.fieldExportedBy ?? '外场师傅',
    base,
    field: {
      joints: structuredClone(joints),
      members: structuredClone(members),
      steps: structuredClone(steps),
      diagrams: structuredClone(diagrams),
      furniture: structuredClone(furniture),
    },
    headDataRev: meta.headDataRev,
  }
}

export function parseFieldBundle(input: unknown): FieldBundle {
  if (typeof input !== 'object' || input === null) throw new Error('文件不是有效的 JSON 对象。')
  const bundle = input as Partial<FieldBundle>
  if (bundle.kind !== BUNDLE_KIND) throw new Error('不是榫卯外场离线包（缺少批次标识）。')
  if (bundle.formatVersion !== BUNDLE_FORMAT) throw new Error('离线包版本不兼容，请用当前图鉴重新导出。')
  if (typeof bundle.batchId !== 'string' || !bundle.batchId) throw new Error('离线包缺少批次号。')
  for (const section of ['base', 'field'] as const) {
    const tables = bundle[section]
    if (!tables || typeof tables !== 'object') throw new Error(`离线包缺少“${section}”快照。`)
    for (const tableName of ['joints', 'members', 'steps', 'diagrams', 'furniture'] as const) {
      const rows = tables[tableName]
      if (!Array.isArray(rows)) throw new Error(`离线包“${section}.${tableName}”结构损坏。`)
      if (rows.some((row) => typeof row?.id !== 'string' || typeof row?.dataRev !== 'number')) {
        throw new Error(`离线包“${section}.${tableName}”含缺少版本号的记录。`)
      }
    }
  }
  return bundle as FieldBundle
}

interface ImportResult {
  batch: SyncBatch
  created: boolean
}

const ENTITY_TABLES = [db.joints, db.members, db.steps, db.diagrams, db.furniture] as const

/**
 * 幂等导入：同 batchId 重试只返回原批次，不会产生第二条记录或二次自动合并。
 * 整个对账在单个事务内完成，任一步失败整体回滚。
 */
export async function importFieldBundle(input: unknown): Promise<ImportResult> {
  const bundle = parseFieldBundle(input)
  let result: ImportResult | null = null

  await db.transaction(
    'rw',
    [db.joints, db.members, db.steps, db.diagrams, db.furniture, db.syncBatches, db.reviewItems, db.syncMeta],
    async () => {
      const meta = await getSyncMeta()
      if (meta.fieldMode) throw new Error('当前是外场模式，请先回店恢复店内资料，再做对账导入。')

      const existing = await db.syncBatches.get(bundle.batchId)
      if (existing) {
        result = { batch: existing, created: false }
        return
      }

      const [shopJoints, shopMembers, shopSteps, shopDiagrams] = await Promise.all([
        db.joints.toArray(),
        db.members.toArray(),
        db.steps.toArray(),
        db.diagrams.toArray(),
      ])
      const plan = planReconciliation(bundle.base, bundle.field, {
        joints: shopJoints.map((joint) => ({ id: joint.id })),
        members: shopMembers,
        steps: shopSteps,
        diagrams: shopDiagrams,
      })

      const hasAutoApply = plan.autoApplyMembers.length + plan.autoApplySteps.length > 0
      const importRev = hasAutoApply ? meta.headDataRev + 1 : meta.headDataRev
      const touchedJointIds = bundle.base.joints.map((joint) => joint.id)
      const now = new Date().toISOString()
      const pending = plan.reviews.length

      if (hasAutoApply) {
        for (const member of plan.autoApplyMembers) await db.members.put({ ...member, dataRev: importRev })
        for (const step of plan.autoApplySteps) await db.steps.put({ ...step, dataRev: importRev })
      }

      if (pending > 0) {
        await db.reviewItems.bulkAdd(
          plan.reviews.map((draft) => ({
            ...draft,
            id: reviewItemId(bundle.batchId, draft.entityType, draft.entityId),
            batchId: bundle.batchId,
            status: 'pending' as const,
            decision: null,
            resolvedAt: null,
            createdAt: now,
          })),
        )
      }

      const reconciledNow = pending === 0
      const jointRevs = { ...meta.jointRevs }
      if (reconciledNow) {
        // 直接结案：该批榫卯的构件/步序/示意图统一敲到同一修订
        const [jointMembers, jointSteps, jointDiagrams] = [
          await db.members.where('jointTypeId').anyOf(touchedJointIds).toArray(),
          await db.steps.where('jointTypeId').anyOf(touchedJointIds).toArray(),
          await db.diagrams.where('jointTypeId').anyOf(touchedJointIds).toArray(),
        ]
        await db.members.bulkPut(jointMembers.map((member) => ({ ...member, dataRev: importRev })))
        await db.steps.bulkPut(jointSteps.map((step) => ({ ...step, dataRev: importRev })))
        await db.diagrams.bulkPut(jointDiagrams.map((diagram) => ({ ...diagram, dataRev: importRev })))
        for (const jointId of touchedJointIds) jointRevs[jointId] = importRev
      }
      await db.syncMeta.put({
        ...meta,
        headDataRev: importRev,
        jointRevs,
      })

      const batch: SyncBatch = {
        id: bundle.batchId,
        batchId: bundle.batchId,
        exportedAt: bundle.exportedAt,
        importedAt: now,
        exportedBy: bundle.exportedBy,
        jointTypeIds: touchedJointIds,
        status: reconciledNow ? 'reconciled' : 'open',
        failureReason: null,
        summary: plan.summary,
        committedDataRev: reconciledNow ? importRev : null,
        committedAt: reconciledNow ? now : null,
        attempts: 1,
      }
      await db.syncBatches.put(batch)
      result = { batch, created: true }
    },
  )

  if (!result) throw new Error('导入未完成，请重试。')
  return result
}

/** 导入前置校验（事务外）：让 UI 在真正写入前给出可读的失败原因，且不产生任何记录。 */
export function preflightBundle(input: unknown): { ok: true; bundle: FieldBundle } | { ok: false; reason: string } {
  try {
    return { ok: true, bundle: parseFieldBundle(input) }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '离线包无法解析。' }
  }
}

async function maxStepSeq(jointTypeId: string): Promise<number> {
  const rows = await db.steps.where('jointTypeId').equals(jointTypeId).toArray()
  return rows.reduce((max, step) => Math.max(max, step.seq), 0)
}

function applyFieldDecision(review: ReviewItem): { table: 'members' | 'steps' | 'diagrams'; record: Member | DisassemblyStep | Diagram } {
  const fieldEntity = review.fieldSnapshot
  if (!review.jointExists) {
    throw new Error('所属榫卯已在店内删除，无法恢复现场记录，请选择“仅保留断点记录”。')
  }

  if (review.kind === 'risk-note-conflict' && review.entityType === 'step') {
    return { table: 'steps', record: { ...(fieldEntity as DisassemblyStep) } }
  }
  if (review.kind === 'member-conflict' && review.entityType === 'member') {
    return { table: 'members', record: { ...(fieldEntity as Member) } }
  }
  if (review.kind === 'step-orphan') {
    return { table: 'steps', record: { ...(fieldEntity as DisassemblyStep) } }
  }
  if (review.kind === 'diagram-orphan') {
    return { table: 'diagrams', record: { ...(fieldEntity as Diagram) } }
  }
  if (review.kind === 'member-orphan') {
    return { table: 'members', record: { ...(fieldEntity as Member) } }
  }
  throw new Error('该待复核项类型不支持采用现场值。')
}

interface CloseContext {
  batch: SyncBatch
  meta: SyncMeta
  commitRev: number
}

/** 结案：最后一项复核处理完时，把该批榫卯的构件/步骤/示意图统一敲到同一修订。 */
async function closeBatchIfDone(batchId: string): Promise<CloseContext | null> {
  const remaining = await db.reviewItems.where('batchId').equals(batchId).filter((item) => item.status === 'pending').count()
  if (remaining > 0) return null

  const batch = await db.syncBatches.get(batchId)
  if (!batch) throw new Error('对账批次不存在。')
  const meta = await getSyncMeta()
  const commitRev = meta.headDataRev + 1
  const now = new Date().toISOString()

  const [members, steps, diagrams] = await Promise.all([
    db.members.where('jointTypeId').anyOf(batch.jointTypeIds).toArray(),
    db.steps.where('jointTypeId').anyOf(batch.jointTypeIds).toArray(),
    db.diagrams.where('jointTypeId').anyOf(batch.jointTypeIds).toArray(),
  ])
  await db.members.bulkPut(members.map((member) => ({ ...member, dataRev: commitRev })))
  await db.steps.bulkPut(steps.map((step) => ({ ...step, dataRev: commitRev })))
  await db.diagrams.bulkPut(diagrams.map((diagram) => ({ ...diagram, dataRev: commitRev })))

  const jointRevs = { ...meta.jointRevs }
  for (const jointId of batch.jointTypeIds) jointRevs[jointId] = commitRev
  await db.syncMeta.put({ ...meta, headDataRev: commitRev, jointRevs })
  await db.syncBatches.put({
    ...batch,
    status: 'reconciled',
    committedDataRev: commitRev,
    committedAt: now,
  })
  return { batch: { ...batch, status: 'reconciled', committedDataRev: commitRev, committedAt: now }, meta: { ...meta, headDataRev: commitRev, jointRevs }, commitRev }
}

export interface ResolveResult {
  closed: boolean
  commitRev: number | null
}

/** 处理单条待复核：采用现场值或保留店内值/断点。结案修订在同事务内统一敲定。 */
export async function resolveReviewItem(reviewId: string, decision: 'field' | 'shop'): Promise<ResolveResult> {
  let resolveResult: ResolveResult = { closed: false, commitRev: null }

  await db.transaction(
    'rw',
    [db.joints, db.members, db.steps, db.diagrams, db.furniture, db.syncBatches, db.reviewItems, db.syncMeta],
    async () => {
      const review = await db.reviewItems.get(reviewId)
      if (!review) throw new Error('待复核项不存在。')
      if (review.status === 'resolved') return

      const meta = await getSyncMeta()
      if (meta.fieldMode) throw new Error('外场模式下不能处理店内待复核项。')

      if (decision === 'field') {
        const { table, record } = applyFieldDecision(review)
        let stamped: Member | DisassemblyStep | Diagram = { ...record, dataRev: meta.headDataRev }
        if (table === 'steps' && review.kind === 'step-orphan') {
          // 断点步骤重新挂回时排在当前步序末尾，避免与店内新步序抢号。
          stamped = { ...(stamped as DisassemblyStep), seq: (await maxStepSeq(record.jointTypeId)) + 1 }
        }
        if (table === 'members') await db.members.put(stamped as Member)
        else if (table === 'steps') await db.steps.put(stamped as DisassemblyStep)
        else await db.diagrams.put(stamped as Diagram)
      }

      await db.reviewItems.put({
        ...review,
        status: 'resolved',
        decision,
        resolvedAt: new Date().toISOString(),
      })

      const closed = await closeBatchIfDone(review.batchId)
      if (closed) resolveResult = { closed: true, commitRev: closed.commitRev }
    },
  )

  return resolveResult
}

/** 一键处理整批：可采用现场值的采用现场值；所属榫卯已删的断点只能保留。 */
export async function resolveAllReviews(batchId: string, decision: 'field' | 'shop'): Promise<number> {
  let applied = 0
  await db.transaction(
    'rw',
    [db.joints, db.members, db.steps, db.diagrams, db.furniture, db.syncBatches, db.reviewItems, db.syncMeta],
    async () => {
      const meta = await getSyncMeta()
      if (meta.fieldMode) throw new Error('外场模式下不能处理店内待复核项。')
      const pendingReviews = await db.reviewItems.where('batchId').equals(batchId).filter((item) => item.status === 'pending').toArray()

      for (const review of pendingReviews) {
        const canRestore = review.jointExists
        const effectiveDecision = decision === 'field' && canRestore ? 'field' : 'shop'
        if (effectiveDecision === 'field') {
          const { table, record } = applyFieldDecision(review)
          let stamped: Member | DisassemblyStep | Diagram = { ...record, dataRev: meta.headDataRev }
          if (table === 'steps' && review.kind === 'step-orphan') {
            stamped = { ...(stamped as DisassemblyStep), seq: (await maxStepSeq(record.jointTypeId)) + 1 }
          }
          if (table === 'members') await db.members.put(stamped as Member)
          else if (table === 'steps') await db.steps.put(stamped as DisassemblyStep)
          else await db.diagrams.put(stamped as Diagram)
        }
        await db.reviewItems.put({
          ...review,
          status: 'resolved',
          decision: effectiveDecision,
          resolvedAt: new Date().toISOString(),
        })
        applied += 1
      }

      await closeBatchIfDone(batchId)
    },
  )
  return applied
}

// —— 外场模式：装载离线包 / 回店恢复 ——

interface ShopStash {
  joints: JointType[]
  members: Member[]
  steps: DisassemblyStep[]
  diagrams: Diagram[]
  furniture: Furniture[]
}

/** 外场装载：店内五表整体封存，替换成离线包现场工作区；版本冻结、不递增。 */
export async function loadFieldBundleOffline(input: unknown): Promise<FieldBundle> {
  const bundle = parseFieldBundle(input)
  await db.transaction('rw', [...ENTITY_TABLES, db.syncMeta], async () => {
    const meta = await getSyncMeta()
    if (meta.fieldMode && meta.fieldBatchId !== bundle.batchId) {
      throw new Error('已在另一批外场记录中，请先回店恢复店内资料。')
    }
    if (meta.fieldMode) return // 同一批次重复装载：幂等，不重复封存

    const stash: ShopStash = {
      joints: await db.joints.toArray(),
      members: await db.members.toArray(),
      steps: await db.steps.toArray(),
      diagrams: await db.diagrams.toArray(),
      furniture: await db.furniture.toArray(),
    }
    await Promise.all(ENTITY_TABLES.map((table) => table.clear()))
    await db.joints.bulkAdd(structuredClone(bundle.field.joints))
    await db.members.bulkAdd(structuredClone(bundle.field.members))
    await db.steps.bulkAdd(structuredClone(bundle.field.steps))
    await db.diagrams.bulkAdd(structuredClone(bundle.field.diagrams))
    await db.furniture.bulkAdd(structuredClone(bundle.field.furniture))
    await db.syncMeta.put({
      ...meta,
      fieldMode: true,
      shopStash: encodeSnapshot(stash),
      fieldBase: encodeSnapshot(bundle.base),
      fieldBatchId: bundle.batchId,
      fieldExportedAt: bundle.exportedAt,
      fieldExportedBy: bundle.exportedBy,
      headDataRev: bundle.headDataRev,
    })
  })
  return bundle
}

/** 回店：丢弃现场工作区，恢复封存的店内资料。 */
export async function restoreShopStash(): Promise<void> {
  await db.transaction('rw', [...ENTITY_TABLES, db.syncMeta], async () => {
    const meta = await getSyncMeta()
    if (!meta.fieldMode || !meta.shopStash) throw new Error('当前不在外场模式。')
    const stash = decodeSnapshot<ShopStash>(meta.shopStash)
    await Promise.all(ENTITY_TABLES.map((table) => table.clear()))
    await db.joints.bulkAdd(stash.joints)
    await db.members.bulkAdd(stash.members)
    await db.steps.bulkAdd(stash.steps)
    await db.diagrams.bulkAdd(stash.diagrams)
    await db.furniture.bulkAdd(stash.furniture)
    await db.syncMeta.put({
      ...meta,
      fieldMode: false,
      shopStash: null,
      fieldBase: null,
      fieldBatchId: null,
      fieldExportedAt: null,
      fieldExportedBy: null,
    })
  })
}

export async function listBatches(): Promise<SyncBatch[]> {
  return db.syncBatches.orderBy('importedAt').reverse().toArray()
}

export async function listReviewItems(batchId: string): Promise<ReviewItem[]> {
  return db.reviewItems.where('batchId').equals(batchId).toArray()
}

export interface JointRevisionState {
  headDataRev: number
  jointRevs: Record<string, number>
  fieldMode: boolean
}

export async function getRevisionState(): Promise<JointRevisionState> {
  const meta = await getSyncMeta()
  return { headDataRev: meta.headDataRev, jointRevs: meta.jointRevs, fieldMode: meta.fieldMode }
}

/** 一致性：某榫卯结案后，其构件/步骤/示意图应全部停在同一修订。 */
export async function checkJointConsistency(jointTypeId: string): Promise<{
  committedRev: number | null
  consistent: boolean
  revs: Array<{ entityType: 'member' | 'step' | 'diagram'; id: string; dataRev: number }>
}> {
  const meta = await getSyncMeta()
  const committedRev = meta.jointRevs[jointTypeId] ?? null
  const [members, steps, diagrams] = await Promise.all([
    db.members.where('jointTypeId').equals(jointTypeId).toArray(),
    db.steps.where('jointTypeId').equals(jointTypeId).toArray(),
    db.diagrams.where('jointTypeId').equals(jointTypeId).toArray(),
  ])
  const revs = [
    ...members.map((item) => ({ entityType: 'member' as const, id: item.id, dataRev: item.dataRev })),
    ...steps.map((item) => ({ entityType: 'step' as const, id: item.id, dataRev: item.dataRev })),
    ...diagrams.map((item) => ({ entityType: 'diagram' as const, id: item.id, dataRev: item.dataRev })),
  ]
  const consistent = committedRev !== null && revs.every((item) => item.dataRev === committedRev)
  return { committedRev, consistent, revs }
}
