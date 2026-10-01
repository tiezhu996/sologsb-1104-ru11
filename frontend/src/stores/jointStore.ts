import { create } from 'zustand'
import type { Furniture, FurnitureName } from '../types/furniture'
import type { JointType } from '../types/jointType'
import type { Member } from '../types/member'
import { bumpJointRevision, db, ensureSeedData } from '../utils/db'

export type JointDraft = Omit<JointType, 'id' | 'schemaRev'>
export type FurnitureDraft = Omit<Furniture, 'id' | 'schemaRev'>

interface JointState {
  joints: JointType[]
  members: Member[]
  furniture: Furniture[]
  stepCounts: Record<string, number>
  selectedJointId: string | null
  loading: boolean
  loadAll: () => Promise<void>
  addJoint: (draft: JointDraft) => Promise<JointType>
  addFurniture: (draft: FurnitureDraft) => Promise<Furniture>
  setSelectedJoint: (id: string) => void
  updateMemberDimensions: (
    memberId: string,
    dimensions: Pick<Member, 'lengthMm' | 'widthMm' | 'thicknessMm' | 'toleranceMm'>,
  ) => Promise<void>
  renameMember: (memberId: string, name: Member['name']) => Promise<void>
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export const useJointStore = create<JointState>((set, get) => ({
  joints: [],
  members: [],
  furniture: [],
  stepCounts: {},
  selectedJointId: null,
  loading: false,

  loadAll: async () => {
    if (get().loading) return
    set({ loading: true })
    try {
      await ensureSeedData()
      const [joints, members, furniture, steps] = await Promise.all([
        db.joints.toArray(),
        db.members.toArray(),
        db.furniture.toArray(),
        db.steps.toArray(),
      ])
      const stepCounts = steps.reduce<Record<string, number>>((counts, step) => {
        counts[step.jointTypeId] = (counts[step.jointTypeId] ?? 0) + 1
        return counts
      }, {})
      const selectedJointId = get().selectedJointId
      set({
        joints: joints.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
        members,
        furniture,
        stepCounts,
        selectedJointId: selectedJointId && joints.some((joint) => joint.id === selectedJointId)
          ? selectedJointId
          : joints[0]?.id ?? null,
      })
    } finally {
      set({ loading: false })
    }
  },

  addJoint: async (draft) => {
    const joint: JointType = { ...draft, id: createId('joint'), schemaRev: 2, dataRev: 3 }
    await db.joints.add(joint)
    set((state) => ({
      joints: [...state.joints, joint].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
      selectedJointId: joint.id,
      stepCounts: { ...state.stepCounts, [joint.id]: 0 },
    }))
    return joint
  },

  addFurniture: async (draft) => {
    const furniture: Furniture = { ...draft, id: createId('furniture'), schemaRev: 2, dataRev: 3 }
    await db.furniture.add(furniture)
    set((state) => ({ furniture: [...state.furniture, furniture] }))
    // 新增家具关联属于该榫卯资料变更，全部资料对齐到新的统一修订
    const nextRev = await bumpJointRevision(furniture.jointTypeId)
    set((state) => ({
      furniture: state.furniture.map((item) => (
        item.jointTypeId === furniture.jointTypeId ? { ...item, dataRev: nextRev } : item
      )),
      joints: state.joints.map((joint) => (
        joint.id === furniture.jointTypeId ? { ...joint, dataRev: nextRev } : joint
      )),
      members: state.members.map((member) => (
        member.jointTypeId === furniture.jointTypeId ? { ...member, dataRev: nextRev } : member
      )),
    }))
    return furniture
  },

  setSelectedJoint: (id) => set({ selectedJointId: id }),

  updateMemberDimensions: async (memberId, dimensions) => {
    const target = await db.members.get(memberId)
    await db.members.update(memberId, dimensions)
    if (target) {
      // 店内改尺寸：推进统一修订，外场若仍带旧修订回传将进入待复核
      const nextRev = await bumpJointRevision(target.jointTypeId)
      set((state) => ({
        members: state.members.map((member) => (
          member.jointTypeId === target.jointTypeId ? { ...member, dataRev: nextRev } : member
        )).map((member) => (
          member.id === memberId ? { ...member, ...dimensions } : member
        )),
        joints: state.joints.map((joint) => (
          joint.id === target.jointTypeId ? { ...joint, dataRev: nextRev } : joint
        )),
        furniture: state.furniture.map((item) => (
          item.jointTypeId === target.jointTypeId ? { ...item, dataRev: nextRev } : item
        )),
      }))
      return
    }
    set((state) => ({
      members: state.members.map((member) => (
        member.id === memberId ? { ...member, ...dimensions } : member
      )),
    }))
  },

  renameMember: async (memberId, name) => {
    const target = await db.members.get(memberId)
    await db.members.update(memberId, { name })
    if (target) {
      const nextRev = await bumpJointRevision(target.jointTypeId)
      set((state) => ({
        members: state.members.map((member) => (
          member.jointTypeId === target.jointTypeId ? { ...member, dataRev: nextRev } : member
        )).map((member) => (
          member.id === memberId ? { ...member, name } : member
        )),
        joints: state.joints.map((joint) => (
          joint.id === target.jointTypeId ? { ...joint, dataRev: nextRev } : joint
        )),
        furniture: state.furniture.map((item) => (
          item.jointTypeId === target.jointTypeId ? { ...item, dataRev: nextRev } : item
        )),
      }))
      return
    }
    set((state) => ({
      members: state.members.map((member) => (
        member.id === memberId ? { ...member, name } : member
      )),
    }))
  },
}))

export type { FurnitureName }
