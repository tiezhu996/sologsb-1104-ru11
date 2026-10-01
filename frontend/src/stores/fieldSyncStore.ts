import { create } from 'zustand'
import type { FieldImportBatch, FieldReviewItem, FieldRiskNote } from '../types/fieldSync'
import { bumpJointRevision, db } from '../utils/db'
import { buildFieldExport, parseFieldExport, reconcileFieldExport } from '../utils/fieldSync'
import { downloadJson } from '../utils/export'
import { useDiagramStore } from './diagramStore'
import { useJointStore } from './jointStore'
import { useStepStore } from './stepStore'

interface FieldSyncState {
  batches: FieldImportBatch[]
  reviews: FieldReviewItem[]
  riskNotes: FieldRiskNote[]
  loading: boolean
  importing: boolean
  importError: string | null
  loadSyncData: () => Promise<void>
  exportField: (jointId?: string) => Promise<void>
  addRiskNote: (stepId: string, riskNote: string) => Promise<FieldRiskNote>
  importFieldFile: (file: File) => Promise<{ batch: FieldImportBatch; duplicated: boolean }>
  resolveReview: (reviewId: string, action: 'accept' | 'reject') => Promise<void>
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

async function refreshAffectedStores(jointIds: string[]): Promise<void> {
  await useJointStore.getState().loadAll()
  const stepStore = useStepStore.getState()
  const diagramStore = useDiagramStore.getState()
  await Promise.all([
    ...jointIds.map((jointId) => stepStore.loadSteps(jointId)),
    ...jointIds.map((jointId) => diagramStore.loadDiagrams(jointId)),
  ])
}

export const useFieldSyncStore = create<FieldSyncState>((set, get) => ({
  batches: [],
  reviews: [],
  riskNotes: [],
  loading: false,
  importing: false,
  importError: null,

  loadSyncData: async () => {
    set({ loading: true })
    try {
      const [batches, reviews, riskNotes] = await Promise.all([
        db.fieldBatches.orderBy('importedAt').reverse().toArray(),
        db.fieldReviews.toArray(),
        db.fieldRiskNotes.orderBy('notedAt').reverse().toArray(),
      ])
      set({ batches, reviews, riskNotes })
    } finally {
      set({ loading: false })
    }
  },

  exportField: async (jointId) => {
    const [joints, members, steps, diagrams, riskNotes] = await Promise.all([
      db.joints.toArray(),
      db.members.toArray(),
      db.steps.toArray(),
      db.diagrams.toArray(),
      db.fieldRiskNotes.toArray(),
    ])
    const pack = buildFieldExport({
      joints,
      members,
      steps,
      diagrams,
      fieldRiskNotes: riskNotes,
      jointTypeId: jointId,
    })
    const scope = jointId
      ? joints.find((joint) => joint.id === jointId)?.name ?? jointId
      : '全部类型'
    downloadJson(`榫卯图鉴-外场回传-${scope}-${pack.exportedAt.slice(0, 10)}.json`, pack)
  },

  addRiskNote: async (stepId, riskNote) => {
    const note: FieldRiskNote = {
      id: createId('field-risk'),
      stepId,
      riskNote: riskNote.trim(),
      notedAt: new Date().toISOString(),
    }
    await db.fieldRiskNotes.add(note)
    set((state) => ({ riskNotes: [note, ...state.riskNotes] }))
    return note
  },

  importFieldFile: async (file) => {
    const rawText = await file.text()
    const pack = parseFieldExport(rawText) // 格式损坏直接抛出，不产生批次记录

    const recordFailure = async (error: unknown): Promise<never> => {
      const message = error instanceof Error ? error.message : String(error)
      const previous = await db.fieldBatches.get(pack.batchId)
      const failed: FieldImportBatch = {
        id: pack.batchId,
        fileName: file.name,
        exportedAt: pack.exportedAt,
        importedAt: new Date().toISOString(),
        attemptCount: (previous?.attemptCount ?? 0) + 1,
        lastError: message,
        status: 'failed',
        importedJointCount: 0,
        appliedChanges: 0,
        conflictCount: 0,
        brokenRefCount: 0,
        reviewItemIds: [],
        summary: [],
      }
      await db.fieldBatches.put(failed) // 重试始终覆盖同一条批次记录
      await get().loadSyncData()
      set({ importError: message })
      throw error
    }

    try {
      set({ importing: true, importError: null })

      // 已成功导入过的批次：幂等跳过，不重复落任何记录
      const existing = await db.fieldBatches.get(pack.batchId)
      if (existing && existing.status !== 'failed') {
        await get().loadSyncData()
        return { batch: existing, duplicated: true }
      }

      const [shopJoints, shopMembers, shopSteps, shopDiagrams] = await Promise.all([
        db.joints.toArray(),
        db.members.toArray(),
        db.steps.toArray(),
        db.diagrams.toArray(),
      ])

      const result = reconcileFieldExport({
        fieldExport: pack,
        shopJoints,
        shopMembers,
        shopSteps,
        shopDiagrams,
      })

      const affectedJointIds = Array.from(new Set([
        ...result.touchedJointIds,
        ...pack.joints.map((joint) => joint.id),
      ]))

      await db.transaction(
        'rw',
        [db.members, db.steps, db.fieldReviews, db.fieldBatches],
        async () => {
          for (const update of result.memberUpdates) {
            await db.members.update(update.memberId, update.dimensions)
          }
          if (result.reviewItems.length > 0) await db.fieldReviews.bulkPut(result.reviewItems)
        },
      )

      // 现场直接生效的尺寸：把相关榫卯的全部资料推进到同一新修订
      for (const jointId of result.bumpedJointIds) {
        await bumpJointRevision(jointId)
      }

      const brokenCount = result.reviewItems.filter(
        (item) => item.kind === 'broken-step' || item.kind === 'broken-diagram',
      ).length
      const status: FieldImportBatch['status'] = result.reviewItems.length > 0
        ? 'partial'
        : 'imported'
      const batch: FieldImportBatch = {
        id: pack.batchId,
        fileName: file.name,
        exportedAt: pack.exportedAt,
        importedAt: new Date().toISOString(),
        attemptCount: (existing?.attemptCount ?? 0) + 1,
        status,
        importedJointCount: pack.joints.length,
        appliedChanges: result.memberUpdates.length,
        conflictCount: result.reviewItems.filter((item) => item.kind === 'member-dimensions').length,
        brokenRefCount: brokenCount,
        reviewItemIds: result.reviewItems.map((item) => item.id),
        summary: [
          ...result.memberUpdates.map((update) => ({
            kind: 'member' as const,
            outcome: 'applied' as const,
            id: update.memberId,
          })),
          ...result.reviewItems.map((item) => ({
            kind: item.kind === 'member-dimensions' ? 'member' as const : item.kind,
            outcome: item.kind === 'broken-step' || item.kind === 'broken-diagram'
              ? 'broken' as const
              : 'conflict' as const,
            id: item.id,
          })),
        ],
      }
      await db.fieldBatches.put(batch)

      await get().loadSyncData()
      await refreshAffectedStores(affectedJointIds)
      return { batch, duplicated: false }
    } catch (error) {
      return recordFailure(error)
    } finally {
      set({ importing: false })
    }
  },

  resolveReview: async (reviewId, action) => {
    const review = await db.fieldReviews.get(reviewId)
    if (!review || review.status !== 'pending') return

    await db.transaction('rw', [db.members, db.steps, db.fieldReviews], async () => {
      if (action === 'accept') {
        if (review.kind === 'member-dimensions' && review.diffs) {
          const dimensions = review.diffs.reduce<Record<string, number>>((acc, diff) => {
            if (typeof diff.fieldValue === 'number') acc[diff.field] = diff.fieldValue
            return acc
          }, {})
          await db.members.update(review.memberId ?? '', dimensions)
        }
        if (review.kind === 'risk-note' && review.stepId && review.riskNote) {
          const step = await db.steps.get(review.stepId)
          if (step && !step.riskNote.includes(review.riskNote.riskNote)) {
            const separator = step.riskNote ? '；' : ''
            await db.steps.put({ ...step, riskNote: `${step.riskNote}${separator}${review.riskNote.riskNote}` })
          }
        }
      }
      // broken-step / broken-diagram 的采纳仅表示确认断点，原记录始终保留
      await db.fieldReviews.put({
        ...review,
        status: action === 'accept' ? 'accepted' : 'rejected',
        resolvedAt: new Date().toISOString(),
      })
    })

    // 采纳会改动店内资料，处理后把该榫卯全部资料对齐到同一修订；
    // 驳回与断点确认不改数据，店内原本就是同一修订。
    if (action === 'accept' && (review.kind === 'member-dimensions' || review.kind === 'risk-note')) {
      await bumpJointRevision(review.jointTypeId)
    }

    await get().loadSyncData()
    await refreshAffectedStores([review.jointTypeId])
  },
}))
