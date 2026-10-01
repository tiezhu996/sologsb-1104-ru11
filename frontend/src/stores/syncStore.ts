import { create } from 'zustand'
import type { ReviewItem, SyncBatch, SyncMeta } from '../types/sync'
import { db } from '../utils/db'
import {
  buildFieldBundle,
  buildReturnBundleFile,
  checkJointConsistency,
  getRevisionState,
  importFieldBundle,
  listBatches,
  listReviewItems,
  loadFieldBundleOffline,
  preflightBundle,
  resolveAllReviews,
  resolveReviewItem,
  restoreShopStash,
} from '../utils/syncEngine'
import { downloadJson } from '../utils/export'

const DEFAULT_META_VIEW: Omit<SyncMeta, 'id' | 'shopStash' | 'fieldBase'> = {
  headDataRev: 1,
  jointRevs: {},
  fieldMode: false,
  fieldBatchId: null,
  fieldExportedAt: null,
  fieldExportedBy: null,
}

interface SyncState {
  meta: Omit<SyncMeta, 'id' | 'shopStash' | 'fieldBase'>
  batches: SyncBatch[]
  currentBatch: SyncBatch | null
  currentReviews: ReviewItem[]
  loading: boolean
  busy: boolean
  refreshMeta: () => Promise<void>
  refreshBatches: () => Promise<void>
  openBatch: (batchId: string) => Promise<void>
  exportOfflineBundle: (exportedBy: string) => Promise<void>
  exportReturnBundle: () => Promise<void>
  offlineLoad: (input: unknown) => Promise<void>
  returnToShop: () => Promise<void>
  importBundle: (input: unknown) => Promise<{ created: boolean; batch: SyncBatch }>
  resolveOne: (reviewId: string, decision: 'field' | 'shop') => Promise<{ closed: boolean; commitRev: number | null }>
  resolveBatch: (decision: 'field' | 'shop') => Promise<number>
  consistencyOf: (jointTypeId: string) => ReturnType<typeof checkJointConsistency>
  preflight: typeof preflightBundle
}

export const useSyncStore = create<SyncState>((set, get) => ({
  meta: { ...DEFAULT_META_VIEW },
  batches: [],
  currentBatch: null,
  currentReviews: [],
  loading: false,
  busy: false,

  refreshMeta: async () => {
    const state = await getRevisionState()
    const meta = await db.syncMeta.get('meta')
    set({
      meta: {
        headDataRev: state.headDataRev,
        jointRevs: state.jointRevs,
        fieldMode: state.fieldMode,
        fieldBatchId: meta?.fieldBatchId ?? null,
        fieldExportedAt: meta?.fieldExportedAt ?? null,
        fieldExportedBy: meta?.fieldExportedBy ?? null,
      },
    })
  },

  refreshBatches: async () => {
    set({ loading: true })
    try {
      const batches = await listBatches()
      set({ batches })
    } finally {
      set({ loading: false })
    }
  },

  openBatch: async (batchId) => {
    set({ loading: true })
    try {
      const [batch, reviews] = await Promise.all([
        db.syncBatches.get(batchId),
        listReviewItems(batchId),
      ])
      set({
        currentBatch: batch ?? null,
        currentReviews: reviews.sort((a, b) => {
          if (a.status !== b.status) return a.status === 'pending' ? -1 : 1
          return a.entityType.localeCompare(b.entityType)
        }),
      })
    } finally {
      set({ loading: false })
    }
  },

  exportOfflineBundle: async (exportedBy) => {
    set({ busy: true })
    try {
      const bundle = await buildFieldBundle(exportedBy)
      downloadJson(`榫卯外场离线包-${new Date(bundle.exportedAt).toISOString().slice(0, 10)}.json`, bundle)
      await get().refreshMeta()
    } finally {
      set({ busy: false })
    }
  },

  exportReturnBundle: async () => {
    set({ busy: true })
    try {
      const bundle = await buildReturnBundleFile()
      downloadJson(`榫卯现场回传-${new Date(bundle.exportedAt).toISOString().slice(0, 10)}.json`, bundle)
    } finally {
      set({ busy: false })
    }
  },

  offlineLoad: async (input) => {
    set({ busy: true })
    try {
      await loadFieldBundleOffline(input)
      await get().refreshMeta()
    } finally {
      set({ busy: false })
    }
  },

  returnToShop: async () => {
    set({ busy: true })
    try {
      await restoreShopStash()
      await get().refreshMeta()
    } finally {
      set({ busy: false })
    }
  },

  importBundle: async (input) => {
    set({ busy: true })
    try {
      const result = await importFieldBundle(input)
      await Promise.all([get().refreshMeta(), get().refreshBatches()])
      return result
    } finally {
      set({ busy: false })
    }
  },

  resolveOne: async (reviewId, decision) => {
    set({ busy: true })
    try {
      const result = await resolveReviewItem(reviewId, decision)
      if (get().currentBatch) await get().openBatch(get().currentBatch!.batchId)
      await get().refreshMeta()
      return result
    } finally {
      set({ busy: false })
    }
  },

  resolveBatch: async (decision) => {
    const batchId = get().currentBatch?.batchId
    if (!batchId) return 0
    set({ busy: true })
    try {
      const count = await resolveAllReviews(batchId, decision)
      await get().openBatch(batchId)
      await get().refreshMeta()
      return count
    } finally {
      set({ busy: false })
    }
  },

  consistencyOf: checkJointConsistency,
  preflight: preflightBundle,
}))
