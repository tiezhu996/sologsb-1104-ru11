import { useEffect, useRef, useState } from 'react'
import { useFieldSyncStore } from '../stores/fieldSyncStore'
import { useJointStore } from '../stores/jointStore'
import type { FieldImportBatch, FieldReviewItem } from '../types/fieldSync'

const STATUS_LABEL: Record<FieldImportBatch['status'], string> = {
  imported: '已全部入账',
  partial: '部分待复核',
  failed: '导入失败',
}

const STATUS_STYLE: Record<FieldImportBatch['status'], string> = {
  imported: 'bg-emerald-50 text-emerald-800',
  partial: 'bg-amber-50 text-amber-900',
  failed: 'bg-rose-50 text-rose-800',
}

const REVIEW_STATUS_LABEL: Record<FieldReviewItem['status'], string> = {
  pending: '待复核',
  accepted: '已采纳',
  rejected: '已驳回',
  obsolete: '已过时',
}

const KIND_LABEL: Record<FieldReviewItem['kind'], string> = {
  'member-dimensions': '构件尺寸冲突',
  'risk-note': '外场风险说明',
  'broken-step': '步骤断点',
  'broken-diagram': '示意图断点',
}

export default function FieldSyncPage() {
  const joints = useJointStore((state) => state.joints)
  const loadAll = useJointStore((state) => state.loadAll)
  const {
    batches,
    reviews,
    loading,
    importing,
    importError,
    loadSyncData,
    exportField,
    importFieldFile,
    resolveReview,
  } = useFieldSyncStore()
  const [jointId, setJointId] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadAll()
    void loadSyncData()
  }, [loadAll, loadSyncData])

  const pendingCount = reviews.filter((item) => item.status === 'pending').length

  const handleImport = async (file: File | undefined) => {
    if (!file) return
    setFeedback(null)
    try {
      const { batch, duplicated } = await importFieldFile(file)
      if (duplicated) {
        setFeedback(`批次 ${batch.id} 已导入过，本次为重复文件，已跳过且未重复记账。`)
      } else if (batch.status === 'imported') {
        setFeedback(`批次 ${batch.id} 对账完成：${batch.appliedChanges} 项现场尺寸直接生效，无待复核项。`)
      } else {
        setFeedback(`批次 ${batch.id} 已记账：${batch.appliedChanges} 项生效，${batch.conflictCount + batch.brokenRefCount} 项待复核。`)
      }
    } catch {
      // 错误信息已写入失败批次与 importError
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const sortedReviews = [...reviews].sort((a, b) => {
    if ((a.status === 'pending') !== (b.status === 'pending')) return a.status === 'pending' ? -1 : 1
    return b.createdAt.localeCompare(a.createdAt)
  })

  return (
    <div className="space-y-7">
      <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-[0.24em] text-wood-500">FIELD RECONCILE</p>
          <h1 className="text-3xl font-bold tracking-tight text-wood-900 sm:text-4xl">外场回传对账</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-600">
            外场只带固定修订的离线快照（构件尺寸、拆装步骤、示意图版本）；回店后按这批版本与店内资料对账。
            店内改过的构件不被现场值覆盖，转待复核；步骤或示意图已缺失时保留现场原记录并指出断点。
          </p>
        </div>
        <div className="rounded-xl border border-wood-100 bg-white px-5 py-3 text-sm text-stone-600 shadow-sm">
          待复核 <strong className="text-wood-700" data-testid="count-pending-review">{pendingCount}</strong> 项 ·
          批次 <strong className="text-wood-700">{batches.length}</strong> 条
        </div>
      </section>

      <section className="panel grid gap-5 p-5 sm:p-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-wood-900">① 导出现场离线快照</h2>
            <p className="mt-1 text-xs leading-5 text-stone-500">
              导出文件固定当时的构件尺寸、拆装步骤与示意图版本（统一修订号），供工坊师傅在外场离线查阅与测量。
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium text-stone-700">选择榫卯类型</span>
              <select className="input-field" data-testid="field-export-joint-select" value={jointId} onChange={(event) => setJointId(event.target.value)}>
                <option value="">全部类型</option>
                {joints.map((joint) => <option key={joint.id} value={joint.id}>{joint.name}</option>)}
              </select>
            </label>
            <button type="button" className="secondary-button" data-testid="field-export" onClick={() => void exportField(jointId || undefined)}>
              导出外场快照
            </button>
          </div>
        </div>

        <div className="space-y-4 lg:border-l lg:border-wood-100 lg:pl-6">
          <div>
            <h2 className="text-lg font-semibold text-wood-900">② 回店导入对账</h2>
            <p className="mt-1 text-xs leading-5 text-stone-500">
              同一批次重复导入只生成一条记录；导入失败可重试，仍只更新同一批次。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="block w-full text-sm text-stone-600 file:mr-3 file:rounded-lg file:border-0 file:bg-wood-700 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-wood-800"
              data-testid="field-import-file"
              disabled={importing}
              onChange={(event) => void handleImport(event.target.files?.[0])}
            />
          </div>
          {importing ? <p className="text-xs text-stone-500">正在对账…</p> : null}
          {importError ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-800" data-testid="field-import-error">
              导入失败（已登记为失败批次，可重试）：{importError}
            </p>
          ) : null}
          {feedback ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs leading-5 text-emerald-800" data-testid="field-import-feedback">{feedback}</p>
          ) : null}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-wood-900">待复核项</h2>
            <p className="mt-1 text-sm text-stone-500">处理完成后，采纳项会让该榫卯的详情、步序与家具反查读到同一新修订。</p>
          </div>
        </div>
        {loading ? (
          <p className="py-8 text-center text-sm text-stone-500">正在读取回传记录…</p>
        ) : sortedReviews.length === 0 ? (
          <div className="panel px-6 py-10 text-center text-sm text-stone-500" data-testid="field-review-empty">
            暂无待复核项。导入外场回传文件后，尺寸冲突、风险说明与断点会列在这里。
          </div>
        ) : (
          <div className="grid gap-4">
            {sortedReviews.map((item) => (
              <ReviewCard key={item.id} item={item} onResolve={(action) => void resolveReview(item.id, action)} resolving={false} />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-semibold text-wood-900">导入批次记录</h2>
          <p className="mt-1 text-sm text-stone-500">以导出批次号去重；失败重试不会新增第二条。</p>
        </div>
        {batches.length === 0 ? (
          <p className="rounded-xl border border-dashed border-wood-100 px-6 py-8 text-center text-sm text-stone-500">尚无导入批次。</p>
        ) : (
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left text-sm">
              <thead className="bg-wood-50 text-xs text-wood-700">
                <tr>
                  <th className="px-4 py-3 font-semibold">批次号</th>
                  <th className="px-4 py-3 font-semibold">文件 / 导出时间</th>
                  <th className="px-4 py-3 font-semibold">状态</th>
                  <th className="px-4 py-3 font-semibold">尝试</th>
                  <th className="px-4 py-3 font-semibold">生效 / 冲突 / 断点</th>
                  <th className="px-4 py-3 font-semibold">最后错误</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {batches.map((batch) => (
                  <tr key={batch.id} data-testid="field-batch-row">
                    <td className="px-4 py-3 align-top">
                      <strong className="block break-all text-xs text-stone-900">{batch.id}</strong>
                      <span className="mt-1 block text-[11px] text-stone-400">导入于 {new Date(batch.importedAt).toLocaleString('zh-CN')}</span>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-stone-600">
                      <span className="block break-all">{batch.fileName ?? '—'}</span>
                      <span className="mt-1 block text-stone-400">导出于 {new Date(batch.exportedAt).toLocaleString('zh-CN')}</span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLE[batch.status]}`}>
                        {STATUS_LABEL[batch.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top text-xs text-stone-600">{batch.attemptCount}</td>
                    <td className="px-4 py-3 align-top text-xs text-stone-600">
                      {batch.appliedChanges} / {batch.conflictCount} / {batch.brokenRefCount}
                    </td>
                    <td className="max-w-56 px-4 py-3 align-top text-[11px] leading-5 text-rose-700">{batch.lastError ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

interface ReviewCardProps {
  item: FieldReviewItem
  onResolve: (action: 'accept' | 'reject') => void
  resolving: boolean
}

function ReviewCard({ item, onResolve }: ReviewCardProps) {
  const pending = item.status === 'pending'
  return (
    <article className={`panel p-5 ${pending ? 'border-amber-200' : 'opacity-80'}`} data-testid="field-review-row" data-kind={item.kind}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-wood-50 px-2.5 py-1 text-xs font-medium text-wood-700">{KIND_LABEL[item.kind]}</span>
            <span className="text-xs text-stone-500">{item.jointName}</span>
            {item.memberName ? <span className="text-xs text-stone-500">· {item.memberName}</span> : null}
          </div>
          {item.brokenRef ? (
            <p className="mt-3 max-w-3xl text-sm leading-6 text-stone-700" data-testid="field-review-broken-message">
              <strong className="text-rose-800">断点：</strong>{item.brokenRef.message}
            </p>
          ) : null}
          {item.kind === 'risk-note' && item.riskNote ? (
            <p className="mt-3 max-w-3xl rounded-lg bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
              外场新增风险说明：{item.riskNote.riskNote}
              <span className="mt-1 block text-[11px] text-amber-700/80">记录于 {new Date(item.riskNote.notedAt).toLocaleString('zh-CN')}</span>
            </p>
          ) : null}
          {item.note ? <p className="mt-2 text-xs leading-5 text-stone-500">{item.note}</p> : null}
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-medium ${
          pending ? 'bg-amber-50 text-amber-900' : 'bg-stone-100 text-stone-600'
        }`}>{REVIEW_STATUS_LABEL[item.status]}</span>
      </div>

      {item.diffs && item.diffs.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-xl border border-stone-100">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="bg-stone-50 text-stone-500">
              <tr>
                <th className="px-3 py-2 font-medium">字段</th>
                <th className="px-3 py-2 font-medium text-wood-700">现场测量值（不覆盖）</th>
                <th className="px-3 py-2 font-medium text-emerald-800">店内现值</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {item.diffs.map((diff) => (
                <tr key={diff.field} data-testid="field-review-diff">
                  <td className="px-3 py-2 font-medium text-stone-700">{diff.label}</td>
                  <td className="px-3 py-2 text-wood-700">{String(diff.fieldValue)}</td>
                  <td className="px-3 py-2 text-emerald-800">{String(diff.shopValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {item.fieldRecord ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-wood-700">查看保留的现场原记录</summary>
          <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-stone-950 p-3 text-[11px] leading-5 text-stone-100">
            {JSON.stringify(item.fieldRecord, null, 2)}
          </pre>
        </details>
      ) : null}

      {pending ? (
        <div className="mt-4 flex justify-end gap-3">
          <button type="button" className="secondary-button" data-testid="field-review-reject" onClick={() => onResolve('reject')}>
            驳回 / 维持店内
          </button>
          <button type="button" className="primary-button" data-testid="field-review-accept" onClick={() => onResolve('accept')}>
            {item.kind === 'broken-step' || item.kind === 'broken-diagram' ? '确认断点并留档' : '采纳现场值'}
          </button>
        </div>
      ) : null}
    </article>
  )
}
