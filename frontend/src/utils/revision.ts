import { db, getSyncMeta } from './db'
import type { Diagram } from '../types/diagram'
import type { Furniture } from '../types/furniture'
import type { JointType } from '../types/jointType'
import type { Member } from '../types/member'
import type { DisassemblyStep } from '../types/step'

export type VersionedEntity = JointType | Member | DisassemblyStep | Diagram | Furniture

function isJoint(entity: VersionedEntity): entity is JointType {
  return !('jointTypeId' in entity)
}

async function putEntity(entity: VersionedEntity): Promise<void> {
  if (isJoint(entity)) {
    await db.joints.put(entity)
  } else if ('hitAreas' in entity) {
    await db.diagrams.put(entity)
  } else if ('holdSec' in entity) {
    await db.steps.put(entity)
  } else if ('lengthMm' in entity) {
    await db.members.put(entity)
  } else {
    await db.furniture.put(entity)
  }
}

/**
 * 店内模式：写入实体并把店内资料水位推进到同一修订；
 * 外场模式：只落现场记录，版本冻结在导出修订上。
 */
export async function putWithRev<T extends VersionedEntity>(entity: T): Promise<{ entity: T; dataRev: number }> {
  const meta = await getSyncMeta()
  const dataRev = meta.headDataRev
  if (!meta.fieldMode) {
    const next = { ...meta, headDataRev: dataRev + 1 }
    const stamped = { ...entity, dataRev: next.headDataRev }
    await db.transaction('rw', [db.joints, db.members, db.steps, db.diagrams, db.furniture, db.syncMeta], async () => {
      await putEntity(stamped)
      await db.syncMeta.put(next)
    })
    return { entity: stamped, dataRev: next.headDataRev }
  }
  const stamped = { ...entity, dataRev }
  await putEntity(stamped)
  return { entity: stamped, dataRev }
}

/**
 * 店内模式批量写入共享同一修订（一次拖拽/一次保存不会跳多个修订）；
 * 外场模式只落现场记录，水位冻结。
 */
export async function bulkPutWithRev<T extends VersionedEntity>(entities: T[]): Promise<{ entities: T[]; dataRev: number }> {
  if (entities.length === 0) {
    const meta = await getSyncMeta()
    return { entities, dataRev: meta.headDataRev }
  }
  const meta = await getSyncMeta()
  if (meta.fieldMode) {
    const stamped = entities.map((entity) => ({ ...entity, dataRev: meta.headDataRev }))
    for (const entity of stamped) await putEntity(entity)
    return { entities: stamped, dataRev: meta.headDataRev }
  }
  const nextMeta = { ...meta, headDataRev: meta.headDataRev + 1 }
  const stamped = entities.map((entity) => ({ ...entity, dataRev: nextMeta.headDataRev }))
  await db.transaction('rw', [db.joints, db.members, db.steps, db.diagrams, db.furniture, db.syncMeta], async () => {
    for (const entity of stamped) await putEntity(entity)
    await db.syncMeta.put(nextMeta)
  })
  return { entities: stamped, dataRev: nextMeta.headDataRev }
}
