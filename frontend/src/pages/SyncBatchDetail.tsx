import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ReviewCard } from '../components/sync/ReviewCard'
import { useJointStore } from '../stores/jointStore'
import { useSyncStore } from '../stores/syncStore'
import { getRevisionState, type JointRevisionState } from '../utils/syncEngine'

export default function SyncBatchDetail() {
  const { batchId = '' } = useParams()
  const batch = useSyncStore((state) => state.currentBatch)
  const reviews = useSyncStore((state) => state.currentReviews)
  const loading = useSyncStore((state) => state.loading)
  const busy = useSyncStore((state) => state.busy)
  const openBatch = useSyncStore((state) => state.openBatch)
  const resolveBatch = useSyncStore((state) => state.resolveBatch)
  const refreshMeta = useSyncStore((state) => state.refreshMeta)
  const joints = useJointStore((state) => state.joints)
  const loadAll = useJointStore((state) => state.loadAll)
  const [error, setError] = useState<string | null>(null)
  const [revisionState, setRevisionState] = useState<JointRevisionState | null>(null)

  useEffect(() => {
    void openBatch(batchId)
    void refreshMeta().then(async () => {
      setRevisionState(await getRevisionState())
    })
    void loadAll(true)
  }, [batchId, openBatch, refreshMeta, loadAll])

  const jointName = (id: string): string => joints.find((joint) => joint.id === id)?.name ?? '已删除榫卯'
  const pending = reviews.filter((item) => item.status === 'pending')
  const resolved = reviews.filter((item) => item.status === 'resolved')

  const runBatch = async (decision: 'field' | 'shop') => {
    setError(null)
    try {
      await resolveBatch(decision)
      setRevisionState(await getRevisionState())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '批量处理失败')
    }
  }

  if (!batch && loading) {
    return <p className="py-16 text-center text-sm text-stone-500">正在读取批次…</p>
  }
  if (!batch) {
    return (
      <div className="space-y-5">
        <Link to="/sync" className="text-sm text-wood-700 hover:underline">← 返回对账台</Link>
        <div className="panel px-6 py-10 text-center text-sm text-stone-500">未找到该对账批次。</div>
      </div>
    )
  }

  return (
    <div className="space-y-6" data-testid="batch-detail">
      <div>
        <Link to="/sync" className="inline-flex items-center gap-1.5 text-sm text-wood-700 hover:underline">
          <span aria-hidden="true">←</span> 返回对账台
        </Link>
      </div>

      <section className="panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-wood-900">{batch.jointTypeIds.map(jointName).join('、')} · 现场回传对账</h1>
            <p className="mt-2 text-xs text-stone-500">批次 {batch.batchId} · 导出于 {new Date(batch.exportedAt).toLocaleString('zh-CN')} · {batch.exportedBy}</p>
          </div>
          {batch.status === 'reconciled' ? (
            <span className="rounded-full bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-800" data-testid="batch-closed">
              已结案 · 构件/步序/示意图统一在 R{batch.committedDataRev}
            </span>
          ) : (
            <span className="rounded-full bg-amber-50 px-4 py-1.5 text-sm font-medium text-amber-800" data-testid="batch-still-open">
              剩余 {pending.length} 项待复核
            </span>
          )}
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
          <SummaryCell label="自动合并" value={batch.summary.autoApplied} tone="emerald" />
          <SummaryCell label="尺寸冲突" value={batch.summary.memberConflicts} tone="amber" />
          <SummaryCell label="风险冲突" value={batch.summary.riskNoteConflicts} tone="amber" />
          <SummaryCell label="构件断点" value={batch.summary.memberOrphans} tone="rose" />
          <SummaryCell label="步骤/图断点" value={batch.summary.stepOrphans + batch.summary.diagramOrphans} tone="rose" />
          <SummaryCell label="店内版本漂移" value={batch.summary.drifts} tone="stone" />
        </dl>

        {batch.status === 'reconciled' && revisionState ? (
          <div className="mt-5 rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-xs leading-6 text-emerald-900" data-testid="commit-note">
            结案时间 {batch.committedAt ? new Date(batch.committedAt).toLocaleString('zh-CN') : ''}，
            该批榫卯的构件尺寸、拆装步序、示意图与家具反查现读取同一修订 <strong>R{batch.committedDataRev}</strong>
            （店内总水位 R{revisionState.headDataRev}）。
          </div>
        ) : null}

        {error ? <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-800">{error}</p> : null}

        {pending.length > 0 ? (
          <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-stone-100 pt-4">
            <button type="button" className="secondary-button text-xs" disabled={busy} data-testid="resolve-all-shop" onClick={() => void runBatch('shop')}>
              全部保留店内记录
            </button>
            <button type="button" className="primary-button text-xs" disabled={busy} data-testid="resolve-all-field" onClick={() => void runBatch('field')}>
              全部采用现场值（已删榫卯的断点除外）
            </button>
          </div>
        ) : null}
      </section>

      {pending.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-wood-900">待复核（{pending.length}）</h2>
          {pending.map((item) => (
            <ReviewCard key={item.id} item={item} jointName={jointName(item.jointTypeId)} />
          ))}
        </section>
      ) : null}

      {resolved.length > 0 ? (
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-stone-600">已处理（{resolved.length}）</h2>
          {resolved.map((item) => (
            <ReviewCard key={item.id} item={item} jointName={jointName(item.jointTypeId)} />
          ))}
        </section>
      ) : null}
    </div>
  )
}

function SummaryCell({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'rose' | 'stone' }) {
  const toneClass = {
    emerald: 'bg-emerald-50 text-emerald-800',
    amber: 'bg-amber-50 text-amber-800',
    rose: 'bg-rose-50 text-rose-800',
    stone: 'bg-stone-100 text-stone-600',
  }[tone]
  return (
    <div className={`rounded-xl px-3 py-2 ${toneClass}`}>
      <dd className="text-lg font-bold">{value}</dd>
      <dt className="mt-0.5">{label}</dt>
    </div>
  )
}
