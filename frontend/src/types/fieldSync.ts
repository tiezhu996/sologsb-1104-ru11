/**
 * 现场回传（外场离线图鉴 → 店内资料）的数据模型。
 *
 * 一次导出固定“当时”的榫卯快照：构件尺寸、拆装步骤、示意图各自带上
 * 导出时刻的统一修订号 dataRev；回店导入时按这批版本与店内资料对账。
 */
import type { Diagram, HitArea } from './diagram'
import type { Furniture } from './furniture'
import type { JointType } from './jointType'
import type { Member } from './member'
import type { DisassemblyStep } from './step'

/** 外场可改动并回传的构件尺寸字段 */
export type MemberDimensionKey = 'lengthMm' | 'widthMm' | 'thicknessMm' | 'toleranceMm'
export const MEMBER_DIMENSION_KEYS: MemberDimensionKey[] = ['lengthMm', 'widthMm', 'thicknessMm', 'toleranceMm']

/** 外场新增的风险说明 */
export interface FieldRiskNote {
  id: string
  stepId: string
  riskNote: string
  notedAt: string
}

export interface FieldMemberSnapshot {
  id: string
  jointTypeId: string
  name: Member['name']
  part: Member['part']
  grainDir: Member['grainDir']
  lengthMm: number
  widthMm: number
  thicknessMm: number
  toleranceMm: number
  note: string
  /** 导出时刻该构件所属榫卯的统一修订号 */
  dataRev: number
}

export interface FieldStepSnapshot {
  id: string
  jointTypeId: string
  seq: number
  action: DisassemblyStep['action']
  direction: DisassemblyStep['direction']
  tool: DisassemblyStep['tool']
  riskNote: string
  holdSec: number
  /** 导出时刻该步骤所属榫卯的统一修订号 */
  dataRev: number
}

export interface FieldDiagramSnapshot {
  id: string
  jointTypeId: string
  stepId: string
  title: string
  view: Diagram['view']
  svgMarkup: string
  hitAreas: HitArea[]
  /** 导出时刻该示意图所属榫卯的统一修订号 */
  dataRev: number
}

/**
 * 外场导出包。只承载外场需要核对的三类资料（构件尺寸、拆装步骤、示意图）
 * 与外场新增的风险说明；类型本身与家具关联不允许在外场改动。
 */
export interface FieldExport {
  format: 'gbmortise-field'
  formatVersion: 1
  /** 导出批次号：同一批次重复导入只生成一条回传记录 */
  batchId: string
  exportedAt: string
  exportedBy?: string
  joints: Array<Pick<JointType, 'id' | 'name' | 'dataRev'>>
  members: FieldMemberSnapshot[]
  steps: FieldStepSnapshot[]
  diagrams: FieldDiagramSnapshot[]
  fieldRiskNotes: FieldRiskNote[]
}

/** 断点类型：现场记录引用的步骤或示意图在店内已经不存在 */
export type BrokenRefKind = 'step-missing' | 'diagram-step-missing'

export interface BrokenRef {
  kind: BrokenRefKind
  /** diagram-step-missing 时为示意图 id，step-missing 时为步骤 id */
  sourceId: string
  sourceTitle: string
  jointTypeId: string
  missingStepId: string
  message: string
}

/** 字段级差异 */
export interface FieldDiff {
  field: string
  label: string
  fieldValue: number | string
  shopValue: number | string
}

export type ReviewStatus = 'pending' | 'accepted' | 'rejected' | 'obsolete'
export type FieldConflictKind = 'member-dimensions' | 'risk-note' | 'broken-step' | 'broken-diagram'

/**
 * 待复核项。
 * - member-dimensions：同一构件在店里已改（修订号更大），现场值不得覆盖店内值；
 * - risk-note：外场新增的风险说明，等待合入步骤；
 * - broken-step / broken-diagram：店内步骤/示意图已不存在，保留现场原记录并指出断点。
 */
export interface FieldReviewItem {
  id: string
  batchId: string
  kind: FieldConflictKind
  jointTypeId: string
  jointName: string
  memberId?: string
  memberName?: string
  stepId?: string
  diagramId?: string
  /** 现场记录原文（步骤/示意图已删除时仍保留） */
  fieldRecord?: FieldStepSnapshot | FieldDiagramSnapshot
  /** 逐项字段差异（构件尺寸冲突时使用） */
  diffs?: FieldDiff[]
  riskNote?: FieldRiskNote
  brokenRef?: BrokenRef
  status: ReviewStatus
  createdAt: string
  resolvedAt?: string
  note?: string
}

export type ImportBatchStatus = 'imported' | 'partial' | 'failed'
export type ImportItemOutcome = 'applied' | 'conflict' | 'broken' | 'duplicate-skipped'

export interface ImportBatchSummaryItem {
  kind: FieldConflictKind | 'member' | 'step' | 'diagram'
  outcome: ImportItemOutcome
  id: string
}

/** 一次导入批次的落库记录，重试同一批次只更新这一条 */
export interface FieldImportBatch {
  id: string // 即 batchId
  fileName?: string
  exportedAt: string
  importedAt: string
  attemptCount: number
  lastError?: string
  status: ImportBatchStatus
  importedJointCount: number
  appliedChanges: number
  conflictCount: number
  brokenRefCount: number
  reviewItemIds: string[]
  summary: ImportBatchSummaryItem[]
}

export type SyncableEntity = JointType | Member | DisassemblyStep | Diagram | Furniture
