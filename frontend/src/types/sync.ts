import type { Diagram } from './diagram'
import type { Furniture } from './furniture'
import type { JointType } from './jointType'
import type { Member } from './member'
import type { DisassemblyStep } from './step'

/** 外场导出的五类资料，全部冻结在导出当时的修订上。 */
export interface FieldBundle {
  kind: 'gbmortise-field-bundle'
  formatVersion: 1
  /** 每次导出固定：导入/重试以此判幂等，同批只会生成一条记录。 */
  batchId: string
  exportedAt: string
  exportedBy: string
  /** 导出时刻的店内资料全量快照，也是外场对账的基线。 */
  base: {
    joints: JointType[]
    members: Member[]
    steps: DisassemblyStep[]
    diagrams: Diagram[]
    furniture: Furniture[]
  }
  /** 外场现场记录：仅允许测量值（构件尺寸/公差）与拆装风险说明被改动。 */
  field: {
    joints: JointType[]
    members: Member[]
    steps: DisassemblyStep[]
    diagrams: Diagram[]
    furniture: Furniture[]
  }
  /** 导出时店内的资料修订水位。 */
  headDataRev: number
}

/** 待复核项类别。 */
export type ReviewKind =
  | 'member-conflict'
  | 'risk-note-conflict'
  | 'step-orphan'
  | 'diagram-orphan'
  | 'member-orphan'

export type ReviewEntityType = 'member' | 'step' | 'diagram'
export type ReviewStatus = 'pending' | 'resolved'

/** 三方对比中出现差异的字段。 */
export interface MemberFieldDiff {
  fieldName: 'lengthMm' | 'widthMm' | 'thicknessMm' | 'toleranceMm'
  baseValue: number
  fieldValue: number
  shopValue: number
}

export interface RiskNoteDiff {
  base: string
  field: string
  shop: string
}

export type ReviewFieldSnapshot = MemberFieldDiff[] | RiskNoteDiff | null

export interface ReviewItem {
  /** `batchId:entityType:entityId`，确定性主键，保证重试不重复。 */
  id: string
  batchId: string
  kind: ReviewKind
  entityType: ReviewEntityType
  entityId: string
  jointTypeId: string
  /** 外场带回的原始记录快照：目标被删时也保留。 */
  fieldSnapshot: Member | DisassemblyStep | Diagram
  /** 导出基线快照，用于三方并排展示。 */
  baseSnapshot: Member | DisassemblyStep | Diagram
  /** 导入当时的店内快照（目标不存在时为 null，即断点）。 */
  shopSnapshot: Member | DisassemblyStep | Diagram | null
  /** 外场所属榫卯在店内是否仍存在。 */
  jointExists: boolean
  fieldDiff: ReviewFieldSnapshot
  /** 断点说明：引用的步骤/示意图/榫卯已在店内消失。 */
  breakpointNote: string | null
  status: ReviewStatus
  /** 复核决定：采用现场值 / 保留店内值。 */
  decision: 'field' | 'shop' | null
  resolvedAt: string | null
  createdAt: string
}

export interface SyncBatchSummary {
  autoApplied: number
  memberConflicts: number
  riskNoteConflicts: number
  memberOrphans: number
  stepOrphans: number
  diagramOrphans: number
  drifts: number
}

/** 一次现场回传批次：导入失败重试仍只生成一条。 */
export interface SyncBatch {
  id: string
  batchId: string
  exportedAt: string
  importedAt: string
  exportedBy: string
  jointTypeIds: string[]
  status: 'open' | 'reconciled' | 'failed'
  failureReason: string | null
  summary: SyncBatchSummary
  /** 结案（最后一个待复核项处理完）时统一敲定的修订水位。 */
  committedDataRev: number | null
  committedAt: string | null
  attempts: number
}

export interface SyncMeta {
  id: 'meta'
  headDataRev: number
  /** 各榫卯结案水位：详情、步序、家具反查据此读到同一修订。 */
  jointRevs: Record<string, number>
  fieldMode: boolean
  /** 进入外场前的店内资料快照（base64 包裹的 JSON）。 */
  shopStash: string | null
  /** 当前装载的外场包基线（base64 包裹的 JSON）。 */
  fieldBase: string | null
  fieldBatchId: string | null
  fieldExportedAt: string | null
  fieldExportedBy: string | null
}
