export type FurnitureName = '圈椅' | '条案' | '架子床' | '官帽椅' | '方桌' | '柜架'

export interface Furniture {
  id: string
  jointTypeId: string
  name: FurnitureName
  era: string
  position: string
  loadNote: string
  schemaRev?: number
  /** 统一修订号：与所挂接榫卯的类型、构件、步序、示意图保持一致 */
  dataRev?: number
}
