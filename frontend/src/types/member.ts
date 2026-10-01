export type MemberName = '榫头' | '榫眼' | '大边' | '抹头'
export type MemberPart = '出榫件' | '受榫件'
export type GrainDirection = '顺纹' | '横纹'

export interface Member {
  id: string
  jointTypeId: string
  name: MemberName
  part: MemberPart
  grainDir: GrainDirection
  lengthMm: number
  widthMm: number
  thicknessMm: number
  toleranceMm: number
  note: string
  schemaRev?: number
  /** 统一修订号：与所属榫卯的类型、步序、示意图、家具保持一致 */
  dataRev?: number
}
