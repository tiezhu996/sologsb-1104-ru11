/**
 * 现场回传纯逻辑：快照制作、对账、修订号推进与一致性读取。
 * 不依赖 Dexie / DOM，便于在 Node 下直接验证。
 */
import { MEMBER_DIMENSION_KEYS, type FieldDiff, type FieldExport, type FieldMemberSnapshot, type FieldRiskNote, type FieldReviewItem, type SyncableEntity } from '../types/fieldSync'
import type { Diagram } from '../types/diagram'
import type { Furniture } from '../types/furniture'
import type { JointType } from '../types/jointType'
import type { Member } from '../types/member'
import type { DisassemblyStep } from '../types/step'

export const CURRENT_DATA_REV = 3

function revOf(entity: SyncableEntity | undefined): number {
  return entity?.dataRev ?? 0
}

/** 同一榫卯当前的统一修订号：取该榫卯全部资料的最大修订号 */
export function jointRevision(
  joint: JointType | undefined,
  scoped: Array<SyncableEntity | undefined>,
): number {
  return scoped.reduce((max, entity) => Math.max(max, revOf(entity)), revOf(joint))
}

function createBatchId(exportedAt: string): string {
  const stamp = exportedAt.replace(/[-:.TZ]/g, '').slice(0, 14)
  return `field-${stamp}-${Math.random().toString(36).slice(2, 8)}`
}

export interface BuildExportInput {
  joints: JointType[]
  members: Member[]
  steps: DisassemblyStep[]
  diagrams: Diagram[]
  fieldRiskNotes: FieldRiskNote[]
  exportedAt?: string
  exportedBy?: string
  /** 指定榫卯 id 时只导出单个类型；不指定则导出全部 */
  jointTypeId?: string
}

/**
 * 制作外场导出包：把“当时”的构件尺寸、拆装步骤、示意图连同统一修订号
 * 一起固定下来。外场只带这份离线快照，回店后据此对账。
 */
export function buildFieldExport(input: BuildExportInput): FieldExport {
  const exportedAt = input.exportedAt ?? new Date().toISOString()
  const joints = input.jointTypeId
    ? input.joints.filter((joint) => joint.id === input.jointTypeId)
    : input.joints
  const ids = new Set(joints.map((joint) => joint.id))
  const members = input.members.filter((member) => ids.has(member.jointTypeId))
  const steps = input.steps.filter((step) => ids.has(step.jointTypeId))
  const diagrams = input.diagrams.filter((diagram) => ids.has(diagram.jointTypeId))
  const riskNotes = input.fieldRiskNotes.filter((note) => steps.some((step) => step.id === note.stepId))

  return {
    format: 'gbmortise-field',
    formatVersion: 1,
    batchId: createBatchId(exportedAt),
    exportedAt,
    exportedBy: input.exportedBy,
    joints: joints.map((joint) => ({
      id: joint.id,
      name: joint.name,
      dataRev: jointRevision(
        joint,
        [
          ...members.filter((member) => member.jointTypeId === joint.id),
          ...steps.filter((step) => step.jointTypeId === joint.id),
          ...diagrams.filter((diagram) => diagram.jointTypeId === joint.id),
        ],
      ),
    })),
    members: members.map((member) => ({
      id: member.id,
      jointTypeId: member.jointTypeId,
      name: member.name,
      part: member.part,
      grainDir: member.grainDir,
      lengthMm: member.lengthMm,
      widthMm: member.widthMm,
      thicknessMm: member.thicknessMm,
      toleranceMm: member.toleranceMm,
      note: member.note,
      dataRev: revOf(member),
    })),
    steps: steps.map((step) => ({
      id: step.id,
      jointTypeId: step.jointTypeId,
      seq: step.seq,
      action: step.action,
      direction: step.direction,
      tool: step.tool,
      riskNote: step.riskNote,
      holdSec: step.holdSec,
      dataRev: revOf(step),
    })),
    diagrams: diagrams.map((diagram) => ({
      id: diagram.id,
      jointTypeId: diagram.jointTypeId,
      stepId: diagram.stepId,
      title: diagram.title,
      view: diagram.view,
      svgMarkup: diagram.svgMarkup,
      hitAreas: diagram.hitAreas,
      dataRev: revOf(diagram),
    })),
    fieldRiskNotes: riskNotes,
  }
}

const DIMENSION_LABELS: Record<string, string> = {
  lengthMm: '长',
  widthMm: '宽',
  thicknessMm: '厚',
  toleranceMm: '公差',
}

function dimensionDiffs(field: FieldMemberSnapshot, shop: Member): FieldDiff[] {
  return MEMBER_DIMENSION_KEYS.reduce<FieldDiff[]>((diffs, key) => {
    if (field[key] !== shop[key]) {
      diffs.push({
        field: key,
        label: DIMENSION_LABELS[key] ?? key,
        fieldValue: field[key],
        shopValue: shop[key],
      })
    }
    return diffs
  }, [])
}

/** 严格校验外场导出包，文件损坏/格式不符时抛出错误（整批导入失败） */
export function parseFieldExport(raw: string): FieldExport {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('文件不是有效的 JSON，无法读入外场回传')
  }
  const data = parsed as Partial<FieldExport>
  if (!parsed || typeof parsed !== 'object' || data.format !== 'gbmortise-field' || data.formatVersion !== 1) {
    throw new Error('不是榫卯图鉴的外场回传文件（缺少格式标识或版本不符）')
  }
  if (typeof data.batchId !== 'string' || !data.batchId) throw new Error('回传文件缺少导出批次号')
  if (typeof data.exportedAt !== 'string' || !data.exportedAt) throw new Error('回传文件缺少导出时间')
  for (const key of ['joints', 'members', 'steps', 'diagrams', 'fieldRiskNotes'] as const) {
    if (!Array.isArray(data[key])) throw new Error(`回传文件的 ${key} 段缺失或损坏`)
  }
  return data as FieldExport
}

export interface ReconcileInput {
  fieldExport: FieldExport
  shopJoints: JointType[]
  shopMembers: Member[]
  shopSteps: DisassemblyStep[]
  shopDiagrams: Diagram[]
  now?: string
}

export interface ReconcileResult {
  /** 可直接落库的构件尺寸（修订号相同且现场值不同） */
  memberUpdates: Array<{ memberId: string; dimensions: Pick<Member, 'lengthMm' | 'widthMm' | 'thicknessMm' | 'toleranceMm'> }>
  reviewItems: FieldReviewItem[]
  /** 导入后需要把统一修订号整体推进到下一版的榫卯 */
  bumpedJointIds: string[]
  touchedJointIds: string[]
}

function makeReviewId(batchId: string, kind: string, localId: string): string {
  return `review-${batchId}-${kind}-${localId}`
}

/**
 * 对账：
 * - 修订号相同、尺寸有出入：现场测量直接生效；
 * - 店内修订号更大（同构件在店里改过）：现场值不覆盖，列待复核；
 * - 现场修订号反而更新：店内资料陈旧，同样列待复核，交师傅裁定；
 * - 外场新增风险说明：保留为待复核，不直接改动步骤正文；
 * - 步骤或示意图在店内已不存在：保留现场原记录，指出断点。
 */
export function reconcileFieldExport(input: ReconcileInput): ReconcileResult {
  const { fieldExport: pack } = input
  const now = input.now ?? new Date().toISOString()
  const reviewItems: FieldReviewItem[] = []
  const memberUpdates: ReconcileResult['memberUpdates'] = []
  const bumpedJointIds = new Set<string>()
  const touchedJointIds = new Set<string>()

  const jointName = (jointTypeId: string): string =>
    input.shopJoints.find((joint) => joint.id === jointTypeId)?.name
    ?? pack.joints.find((joint) => joint.id === jointTypeId)?.name
    ?? '未知榫卯'

  // 1. 构件尺寸对账
  for (const fieldMember of pack.members) {
    const shop = input.shopMembers.find((member) => member.id === fieldMember.id)
    if (!shop) continue // 店内已无此构件，随所属步骤/示意图断点一并保留，不单独建项
    touchedJointIds.add(shop.jointTypeId)
    const diffs = dimensionDiffs(fieldMember, shop)
    if (diffs.length === 0) continue

    if (fieldMember.dataRev === (shop.dataRev ?? 0)) {
      memberUpdates.push({
        memberId: shop.id,
        dimensions: {
          lengthMm: fieldMember.lengthMm,
          widthMm: fieldMember.widthMm,
          thicknessMm: fieldMember.thicknessMm,
          toleranceMm: fieldMember.toleranceMm,
        },
      })
      bumpedJointIds.add(shop.jointTypeId)
    } else {
      reviewItems.push({
        id: makeReviewId(pack.batchId, 'member', shop.id),
        batchId: pack.batchId,
        kind: 'member-dimensions',
        jointTypeId: shop.jointTypeId,
        jointName: jointName(shop.jointTypeId),
        memberId: shop.id,
        memberName: shop.name,
        diffs,
        fieldRecord: undefined,
        status: 'pending',
        createdAt: now,
        note: fieldMember.dataRev > (shop.dataRev ?? 0)
          ? `现场修订 r${fieldMember.dataRev} 新于店内 r${shop.dataRev ?? 0}，店内资料可能陈旧`
          : `店内已修订至 r${shop.dataRev ?? 0}，现场基于 r${fieldMember.dataRev} 测量，现场值未覆盖店内值`,
      })
    }
  }

  // 2. 外场新增风险说明：始终保留为待复核项
  for (const note of pack.fieldRiskNotes) {
    const shopStep = input.shopSteps.find((step) => step.id === note.stepId)
    if (!shopStep) {
      const fieldStep = pack.steps.find((step) => step.id === note.stepId)
      reviewItems.push({
        id: makeReviewId(pack.batchId, 'risk-missing-step', note.id),
        batchId: pack.batchId,
        kind: 'broken-step',
        jointTypeId: fieldStep?.jointTypeId ?? '',
        jointName: jointName(fieldStep?.jointTypeId ?? ''),
        stepId: note.stepId,
        fieldRecord: fieldStep,
        riskNote: note,
        status: 'pending',
        createdAt: now,
        brokenRef: {
          kind: 'step-missing',
          sourceId: note.stepId,
          sourceTitle: fieldStep ? `第 ${fieldStep.seq} 步 · ${fieldStep.action}` : '已缺失的步骤',
          jointTypeId: fieldStep?.jointTypeId ?? '',
          missingStepId: note.stepId,
          message: `店内已无该步骤，外场新增风险说明随原步骤记录保留：${note.riskNote}`,
        },
      })
      if (fieldStep) touchedJointIds.add(fieldStep.jointTypeId)
      continue
    }
    touchedJointIds.add(shopStep.jointTypeId)
    if (shopStep.riskNote.includes(note.riskNote)) continue // 同文风险已合入，幂等跳过
    reviewItems.push({
      id: makeReviewId(pack.batchId, 'risk', note.id),
      batchId: pack.batchId,
      kind: 'risk-note',
      jointTypeId: shopStep.jointTypeId,
      jointName: jointName(shopStep.jointTypeId),
      stepId: shopStep.id,
      riskNote: note,
      status: 'pending',
      createdAt: now,
    })
  }

  // 3. 步骤断点：导出包里有、店内已不存在的步骤，保留原记录
  for (const fieldStep of pack.steps) {
    touchedJointIds.add(fieldStep.jointTypeId)
    if (input.shopSteps.some((step) => step.id === fieldStep.id)) continue
    const already = pack.fieldRiskNotes.some((note) => note.stepId === fieldStep.id)
    if (already) continue // 已随风险说明建过断点项
    reviewItems.push({
      id: makeReviewId(pack.batchId, 'step', fieldStep.id),
      batchId: pack.batchId,
      kind: 'broken-step',
      jointTypeId: fieldStep.jointTypeId,
      jointName: jointName(fieldStep.jointTypeId),
      stepId: fieldStep.id,
      fieldRecord: fieldStep,
      status: 'pending',
      createdAt: now,
      brokenRef: {
        kind: 'step-missing',
        sourceId: fieldStep.id,
        sourceTitle: `第 ${fieldStep.seq} 步 · ${fieldStep.action}${fieldStep.direction}`,
        jointTypeId: fieldStep.jointTypeId,
        missingStepId: fieldStep.id,
        message: `店内已无第 ${fieldStep.seq} 步（${fieldStep.action}·${fieldStep.tool}），现场记录原样保留待核`,
      },
    })
  }

  // 4. 示意图断点：示意图在但绑定步骤已删，或整图已删
  for (const fieldDiagram of pack.diagrams) {
    touchedJointIds.add(fieldDiagram.jointTypeId)
    const shopDiagram = input.shopDiagrams.find((diagram) => diagram.id === fieldDiagram.id)
    if (shopDiagram) {
      const stepExists = input.shopSteps.some((step) => step.id === shopDiagram.stepId)
      if (stepExists) continue
      reviewItems.push({
        id: makeReviewId(pack.batchId, 'diagram-step', fieldDiagram.id),
        batchId: pack.batchId,
        kind: 'broken-diagram',
        jointTypeId: fieldDiagram.jointTypeId,
        jointName: jointName(fieldDiagram.jointTypeId),
        diagramId: fieldDiagram.id,
        stepId: shopDiagram.stepId,
        fieldRecord: fieldDiagram,
        status: 'pending',
        createdAt: now,
        brokenRef: {
          kind: 'diagram-step-missing',
          sourceId: fieldDiagram.id,
          sourceTitle: fieldDiagram.title,
          jointTypeId: fieldDiagram.jointTypeId,
          missingStepId: shopDiagram.stepId,
          message: `示意图“${fieldDiagram.title}”仍在，但绑定的步骤 ${shopDiagram.stepId} 已删除，图示步骤衔接断开`,
        },
      })
      continue
    }
    const stepExists = input.shopSteps.some((step) => step.id === fieldDiagram.stepId)
    reviewItems.push({
      id: makeReviewId(pack.batchId, 'diagram', fieldDiagram.id),
      batchId: pack.batchId,
      kind: 'broken-diagram',
      jointTypeId: fieldDiagram.jointTypeId,
      jointName: jointName(fieldDiagram.jointTypeId),
      diagramId: fieldDiagram.id,
      stepId: fieldDiagram.stepId,
      fieldRecord: fieldDiagram,
      status: 'pending',
      createdAt: now,
      brokenRef: {
        kind: 'diagram-step-missing',
        sourceId: fieldDiagram.id,
        sourceTitle: fieldDiagram.title,
        jointTypeId: fieldDiagram.jointTypeId,
        missingStepId: stepExists ? fieldDiagram.stepId : fieldDiagram.stepId,
        message: stepExists
          ? `店内已删除示意图“${fieldDiagram.title}”，现场版本原样保留待核`
          : `示意图“${fieldDiagram.title}”及其绑定步骤 ${fieldDiagram.stepId} 均已不在店内，现场记录原样保留`,
      },
    })
  }

  return {
    memberUpdates,
    reviewItems,
    bumpedJointIds: Array.from(bumpedJointIds),
    touchedJointIds: Array.from(touchedJointIds),
  }
}

/**
 * 把榫卯下的全部资料推进到同一修订号。
 * 店内编辑（尺寸、调序、示意图、家具、类型）与现场回传生效后都必须调用，
 * 这样详情、步序、家具反查读到的才是同一修订。
 */
export function nextRevision(current: number): number {
  return Math.max(CURRENT_DATA_REV, current + 1)
}

export function stampRevision<T extends SyncableEntity>(entities: T[], rev: number): T[] {
  return entities.map((entity) => ({ ...entity, dataRev: rev }))
}

/** 一致性读取：某榫卯五类资料必须落在同一修订号，否则视为资料错位 */
export interface RevisionBundle {
  rev: number
  consistent: boolean
  revisions: number[]
}

export function readJointRevision(
  joint: JointType | undefined,
  members: Member[],
  steps: DisassemblyStep[],
  diagrams: Diagram[],
  furniture: Furniture[],
): RevisionBundle {
  const revisions = [joint, ...members, ...steps, ...diagrams, ...furniture].map((entity) => revOf(entity))
  const rev = joint?.dataRev ?? 0
  const consistent = revisions.every((value) => value === rev)
  return { rev, consistent, revisions }
}
