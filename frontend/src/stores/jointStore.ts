import { create } from 'zustand'
import type { Furniture, FurnitureName } from '../types/furniture'
import type { JointType } from '../types/jointType'
import type { Member } from '../types/member'
import { db, ensureSeedData } from '../utils/db'
import { putWithRev } from '../utils/revision'

export type JointDraft = Omit<JointType, 'id' | 'schemaRev' | 'dataRev'>
export type FurnitureDraft = Omit<Furniture, 'id' | 'schemaRev' | 'dataRev'>

interface JointState {
  joints: JointType[]
  members: Member[]
  furniture: Furniture[]
  stepCounts: Record<string, number>
  selectedJointId: string | null
  loading: boolean
  loadAll: (force?: boolean) => Promise<void>
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

  loadAll: async (force = false) => {
    if (get().loading && !force) return
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
    const { entity: joint } = await putWithRev({ ...draft, id: createId('joint'), schemaRev: 2 } as JointType)
    set((state) => ({
      joints: [...state.joints, joint].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
      selectedJointId: joint.id,
      stepCounts: { ...state.stepCounts, [joint.id]: 0 },
    }))
    return joint
  },

  addFurniture: async (draft) => {
    const { entity: furniture } = await putWithRev({ ...draft, id: createId('furniture'), schemaRev: 2 } as Furniture)
    set((state) => ({ furniture: [...state.furniture, furniture] }))
    return furniture
  },

  setSelectedJoint: (id) => set({ selectedJointId: id }),

  updateMemberDimensions: async (memberId, dimensions) => {
    const current = get().members.find((member) => member.id === memberId)
    if (!current) return
    const { entity: updated } = await putWithRev({ ...current, ...dimensions })
    set((state) => ({
      members: state.members.map((member) => (
        member.id === memberId ? updated : member
      )),
    }))
  },

  renameMember: async (memberId, name) => {
    const current = get().members.find((member) => member.id === memberId)
    if (!current) return
    const { entity: updated } = await putWithRev({ ...current, name })
    set((state) => ({
      members: state.members.map((member) => (
        member.id === memberId ? updated : member
      )),
    }))
  },
}))

export type { FurnitureName }
