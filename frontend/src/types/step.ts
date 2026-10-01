export type StepAction = '拆卸' | '装配'
export type StepDirection = '轴向' | '侧向' | '斜向'
export type StepTool = '木槌' | '鱼线' | '撬板'

export interface DisassemblyStep {
  id: string
  jointTypeId: string
  seq: number
  action: StepAction
  direction: StepDirection
  tool: StepTool
  riskNote: string
  holdSec: number
  schemaRev?: number
  /** 统一修订号：与所属榫卯的类型、构件、示意图、家具保持一致 */
  dataRev?: number
}
