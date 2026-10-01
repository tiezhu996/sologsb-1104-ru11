export type DiagramView = '正视' | '俯视' | '轴测'

export interface HitArea {
  id: string
  memberId: string
  label: string
  points: string
}

export interface Diagram {
  id: string
  jointTypeId: string
  stepId: string
  title: string
  view: DiagramView
  svgMarkup: string
  hitAreas: HitArea[]
  schemaRev?: number
  /** 统一修订号：与所属榫卯的类型、构件、步序、家具保持一致 */
  dataRev?: number
}
