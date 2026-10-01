import type { Diagram } from '../types/diagram'
import type { Member } from '../types/member'
import type { DisassemblyStep } from '../types/step'
import type {
  FieldBundle,
  MemberFieldDiff,
  ReviewFieldSnapshot,
  ReviewItem,
  RiskNoteDiff,
  SyncBatchSummary,
} from '../types/sync'

/** 外场允许回填的构件测量字段（固定冻结尺寸，现场只能量、不能改名）。 */
export const MEMBER_MEASURE_FIELDS = ['lengthMm', 'widthMm', 'thicknessMm', 'toleranceMm'] as const
export type MemberMeasureField = (typeof MEMBER_MEASURE_FIELDS)[number]

export const MEMBER_FIELD_LABELS: Record<MemberMeasureField, string> = {
  lengthMm: '长',
  widthMm: '宽',
  thicknessMm: '厚',
  toleranceMm: '登记公差',
}

export interface ShopSnapshot {
  joints: { id: string }[]
  members: Member[]
  steps: DisassemblyStep[]
  diagrams: Diagram[]
}

/** 去掉批次与时间戳后稳定的待复核项内容（导入时再补 batchId / createdAt）。 */
export type ReviewDraft = Omit<ReviewItem, 'id' | 'batchId' | 'status' | 'decision' | 'resolvedAt' | 'createdAt'>

export interface ReconciliationPlan {
  reviews: ReviewDraft[]
  autoApplyMembers: Member[]
  autoApplySteps: DisassemblyStep[]
  summary: SyncBatchSummary
}

export function emptySummary(): SyncBatchSummary {
  return {
    autoApplied: 0,
    memberConflicts: 0,
    riskNoteConflicts: 0,
    memberOrphans: 0,
    stepOrphans: 0,
    diagramOrphans: 0,
    drifts: 0,
  }
}

export function reviewItemId(batchId: string, entityType: ReviewDraft['entityType'], entityId: string): string {
  return `${batchId}:${entityType}:${entityId}`
}

function measureDiffs(base: Member, field: Member, shop: Member): MemberFieldDiff[] {
  return MEMBER_MEASURE_FIELDS
    .filter((key) => field[key] !== base[key])
    .map((key) => ({ fieldName: key, baseValue: base[key], fieldValue: field[key], shopValue: shop[key] }))
}

type BundleTables = FieldBundle['base']

export function planReconciliation(
  base: BundleTables,
  field: BundleTables,
  shop: ShopSnapshot,
): ReconciliationPlan {
  const reviews: ReviewDraft[] = []
  const autoApplyMembers: Member[] = []
  const autoApplySteps: DisassemblyStep[] = []
  const summary = emptySummary()

  const shopJointIds = new Set(shop.joints.map((joint) => joint.id))
  const shopMembers = new Map(shop.members.map((member) => [member.id, member]))
  const shopSteps = new Map(shop.steps.map((step) => [step.id, step]))
  const shopDiagrams = new Map(shop.diagrams.map((diagram) => [diagram.id, diagram]))

  // —— 构件尺寸：店内改过 → 现场值不得覆盖，进待复核 ——
  for (const fieldMember of field.members) {
    const baseMember = base.members.find((member) => member.id === fieldMember.id)
    if (!baseMember) continue
    const shopMember = shopMembers.get(fieldMember.id) ?? null
    const jointExists = shopJointIds.has(fieldMember.jointTypeId)

    if (!shopMember) {
      summary.memberOrphans += 1
      reviews.push({
        kind: 'member-orphan',
        entityType: 'member',
        entityId: fieldMember.id,
        jointTypeId: fieldMember.jointTypeId,
        fieldSnapshot: fieldMember,
        baseSnapshot: baseMember,
        shopSnapshot: null,
        jointExists,
        fieldDiff: null,
        breakpointNote: jointExists
          ? '该构件已在店内资料中删除，现场测量值随记录保留。'
          : '所属榫卯类型已在店内删除，现场构件记录无法挂接，随批保留。',
      })
      continue
    }

    const diffs = measureDiffs(baseMember, fieldMember, shopMember)
    const fieldChanged = diffs.length > 0
    const shopChanged = shopMember.dataRev !== baseMember.dataRev

    if (fieldChanged && shopChanged) {
      summary.memberConflicts += 1
      reviews.push({
        kind: 'member-conflict',
        entityType: 'member',
        entityId: fieldMember.id,
        jointTypeId: fieldMember.jointTypeId,
        fieldSnapshot: fieldMember,
        baseSnapshot: baseMember,
        shopSnapshot: shopMember,
        jointExists,
        fieldDiff: diffs,
        breakpointNote: null,
      })
    } else if (fieldChanged) {
      // 店内未动过该构件：现场测量直接落库
      summary.autoApplied += 1
      const measured = Object.fromEntries(diffs.map((diff) => [diff.fieldName, diff.fieldValue]))
      autoApplyMembers.push({ ...shopMember, ...measured })
    } else if (shopChanged) {
      summary.drifts += 1
    }
  }

  // —— 拆装步骤：现场风险说明可保留；双方都改过风险说明才冲突 ——
  for (const fieldStep of field.steps) {
    const baseStep = base.steps.find((step) => step.id === fieldStep.id)
    if (!baseStep) continue
    const shopStep = shopSteps.get(fieldStep.id) ?? null
    const jointExists = shopJointIds.has(fieldStep.jointTypeId)
    const riskChanged = fieldStep.riskNote !== baseStep.riskNote

    if (!shopStep) {
      summary.stepOrphans += 1
      reviews.push({
        kind: 'step-orphan',
        entityType: 'step',
        entityId: fieldStep.id,
        jointTypeId: fieldStep.jointTypeId,
        fieldSnapshot: fieldStep,
        baseSnapshot: baseStep,
        shopSnapshot: null,
        jointExists,
        fieldDiff: null,
        breakpointNote: '该拆装步骤已在店内删除（如调序后并步），现场记录保留并标记断点。',
      })
      continue
    }

    if (riskChanged && shopStep.riskNote !== baseStep.riskNote) {
      summary.riskNoteConflicts += 1
      const diff: RiskNoteDiff = {
        base: baseStep.riskNote,
        field: fieldStep.riskNote,
        shop: shopStep.riskNote,
      }
      reviews.push({
        kind: 'risk-note-conflict',
        entityType: 'step',
        entityId: fieldStep.id,
        jointTypeId: fieldStep.jointTypeId,
        fieldSnapshot: fieldStep,
        baseSnapshot: baseStep,
        shopSnapshot: shopStep,
        jointExists,
        fieldDiff: diff,
        breakpointNote: null,
      })
    } else if (riskChanged) {
      // 店内未改这条风险说明（调序等不影响文案的改动不算冲突）：现场新增风险直接保留
      summary.autoApplied += 1
      autoApplySteps.push({ ...shopStep, riskNote: fieldStep.riskNote })
    } else if (shopStep.dataRev !== baseStep.dataRev) {
      summary.drifts += 1
    }
  }

  // —— 示意图：现场冻结不编辑；店内已删除则保留原记录并指出断点 ——
  for (const fieldDiagram of field.diagrams) {
    const baseDiagram = base.diagrams.find((diagram) => diagram.id === fieldDiagram.id)
    if (!baseDiagram) continue
    const shopDiagram = shopDiagrams.get(fieldDiagram.id) ?? null

    if (!shopDiagram) {
      const boundStepExists = shop.steps.some((step) => step.id === fieldDiagram.stepId)
      summary.diagramOrphans += 1
      reviews.push({
        kind: 'diagram-orphan',
        entityType: 'diagram',
        entityId: fieldDiagram.id,
        jointTypeId: fieldDiagram.jointTypeId,
        fieldSnapshot: fieldDiagram,
        baseSnapshot: baseDiagram,
        shopSnapshot: null,
        jointExists: shopJointIds.has(fieldDiagram.jointTypeId),
        fieldDiff: null,
        breakpointNote: boundStepExists
          ? '该示意图已在店内删除，现场 SVG 与热区原样保留。'
          : '示意图及其绑定步骤均已在店内删除，形成双重断点；现场 SVG 与热区原样保留。',
      })
    } else if (shopDiagram.dataRev !== baseDiagram.dataRev) {
      summary.drifts += 1
    }
  }

  return { reviews, autoApplyMembers, autoApplySteps, summary }
}

/** 待复核项计数：冲突与断点都需师傅逐项处理。 */
export function pendingCount(summary: SyncBatchSummary): number {
  return summary.memberConflicts + summary.riskNoteConflicts + summary.memberOrphans + summary.stepOrphans + summary.diagramOrphans
}

export function isRiskNoteDiff(diff: ReviewFieldSnapshot): diff is RiskNoteDiff {
  return diff !== null && !Array.isArray(diff)
}
