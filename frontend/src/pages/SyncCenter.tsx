import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { FieldModeBanner } from '../components/common/FieldModeBanner'
import { useJointStore } from '../stores/jointStore'
import { useSyncStore } from '../stores/syncStore'
import type { FieldBundle } from '../types/sync'
import { readJsonFile } from '../utils/fileInput'

function formatTime(value: string): string {
  return new Date(value).toLocaleString('zh-CN')
}

export default function SyncCenter() {
  const meta = useSyncStore((state) => state.meta)
  const batches = useSyncStore((state) => state.batches)
  const loading = useSyncStore((state) => state.loading)
  const busy = useSyncStore((state) => state.busy)
  const refreshMeta = useSyncStore((state) => state.refreshMeta)
  const refreshBatches = useSyncStore((state) => state.refreshBatches)
  const exportOfflineBundle = useSyncStore((state) => state.exportOfflineBundle)
  const offlineLoad = useSyncStore((state) => state.offlineLoad)
  const importBundle = useSyncStore((state) => state.importBundle)
  const preflight = useSyncStore((state) => state.preflight)
  const joints = useJointStore((state) => state.joints)
  const loadAll = useJointStore((state) => state.loadAll)

  const [exporter, setExporter] = useState('工坊师傅')
  const [offlineBundle, setOfflineBundle] = useState<FieldBundle | null>(null)
  const [returnBundle, setReturnBundle] = useState<FieldBundle | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)
  const offlineInputRef = useRef<HTMLInputElement>(null)
  const returnInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void refreshMeta()
    void refreshBatches()
    void loadAll()
  }, [refreshMeta, refreshBatches, loadAll])

  const jointName = (id: string): string => joints.find((joint) => joint.id === id)?.name ?? '已删除榫卯'

  const pickOffline = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setNotice(null)
    try {
      const parsed = await readJsonFile(file)
      const check = preflight(parsed)
      if (!check.ok) {
        setNotice({ tone: 'err', text: check.reason })
        setOfflineBundle(null)
        return
      }
      setOfflineBundle(check.bundle)
      setNotice({ tone: 'ok', text: `离线包校验通过：批次 ${check.bundle.batchId}，导出时间 ${formatTime(check.bundle.exportedAt)}。` })
    } catch (error) {
      setNotice({ tone: 'err', text: error instanceof Error ? error.message : '读取失败' })
    }
  }

  const pickReturn = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setNotice(null)
    try {
      const parsed = await readJsonFile(file)
      const check = preflight(parsed)
      if (!check.ok) {
        setNotice({ tone: 'err', text: check.reason })
        setReturnBundle(null)
        return
      }
      setReturnBundle(check.bundle)
      setNotice({ tone: 'ok', text: `回传包校验通过：批次 ${check.bundle.batchId}，等待对账导入。` })
    } catch (error) {
      setNotice({ tone: 'err', text: error instanceof Error ? error.message : '读取失败' })
    }
  }

  const handleOfflineLoad = async () => {
    if (!offlineBundle) return
    try {
      await offlineLoad(offlineBundle)
      setOfflineBundle(null)
      setNotice({ tone: 'ok', text: '离线图鉴已装载，可在外场记录测量值与风险说明。' })
    } catch (error) {
      setNotice({ tone: 'err', text: error instanceof Error ? error.message : '装载失败' })
    }
  }

  const handleImport = async () => {
    if (!returnBundle) return
    try {
      const result = await importBundle(returnBundle)
      setReturnBundle(null)
      await loadAll(true)
      const pending = result.batch.status === 'open'
      setNotice({
        tone: 'ok',
        text: result.created
          ? pending
            ? `已生成对账批次 ${result.batch.batchId}，有 ${result.batch.summary.memberConflicts + result.batch.summary.riskNoteConflicts + result.batch.summary.memberOrphans + result.batch.summary.stepOrphans + result.batch.summary.diagramOrphans} 项待复核。`
            : `对账完成，批次 ${result.batch.batchId} 已直接结案到修订 R${result.batch.committedDataRev}。`
          : `该批次已存在（${result.batch.batchId}），重复导入不会生成第二条记录。`,
      })
    } catch (error) {
      setNotice({ tone: 'err', text: error instanceof Error ? error.message : '导入失败，可重试且不会产生重复记录。' })
    }
  }

  return (
    <div className="space-y-7" data-testid="sync-center">
      <FieldModeBanner />

      <section>
        <p className="mb-2 text-xs font-semibold tracking-[0.24em] text-wood-500">FIELD ROUND TRIP</p>
        <h1 className="text-3xl font-bold tracking-tight text-wood-900 sm:text-4xl">外场回传对账台</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-stone-600">
          出工前导出冻结离线图鉴，外场只记录构件测量值与拆装风险说明；回店导入回传包后，按导出时的版本与店内资料对账：
          店内改过的构件不会被现场值覆盖，转为待复核；已删除的步骤与示意图保留原记录并标记断点。
        </p>
      </section>

      {notice ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            notice.tone === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'
          }`}
          data-testid="sync-notice"
        >
          {notice.text}
        </div>
      ) : null}

      <div className="rounded-2xl border border-wood-100 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-stone-600">
          <span>店内资料总水位 <strong className="text-wood-800" data-testid="head-rev">R{meta.headDataRev}</strong></span>
          <span>对账批次 <strong className="text-wood-800">{batches.length}</strong> 条</span>
          <span>未结批次 <strong className="text-amber-700" data-testid="open-count">{batches.filter((batch) => batch.status === 'open').length}</strong> 条</span>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* 出工：导出 + 装载 */}
        <section className="panel space-y-4 p-6" data-testid="panel-export">
          <div>
            <h2 className="text-lg font-semibold text-wood-900">① 出工：导出离线图鉴</h2>
            <p className="mt-1 text-xs leading-5 text-stone-500">
              每次导出固定当时的构件尺寸、拆装步骤和示意图版本（修订号随包冻结），回店凭该批版本对账。
            </p>
          </div>
          <label className="space-y-1.5 text-sm">
            <span className="font-medium text-stone-700">外场负责人</span>
            <input className="input-field" value={exporter} onChange={(event) => setExporter(event.target.value)} placeholder="例如：工坊师傅" />
          </label>
          <button
            type="button"
            className="primary-button w-full"
            data-testid="export-offline"
            disabled={busy || meta.fieldMode}
            onClick={() => void exportOfflineBundle(exporter).catch((error: unknown) => setNotice({ tone: 'err', text: error instanceof Error ? error.message : '导出失败' }))}
          >
            导出外场离线包（含全量冻结基线）
          </button>
          {meta.fieldMode ? <p className="text-xs text-amber-700">外场模式下不能重复导出，回店恢复后再导出下一批。</p> : null}

          <div className="border-t border-stone-100 pt-4">
            <h3 className="text-sm font-semibold text-wood-900">在外场设备上装载</h3>
            <p className="mt-1 text-xs leading-5 text-stone-500">选择刚导出的离线包，店内资料会自动封存并替换为外场工作区。</p>
            <input ref={offlineInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void pickOffline(event)} />
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className="secondary-button" disabled={busy || meta.fieldMode} onClick={() => offlineInputRef.current?.click()}>选择离线包</button>
              <button type="button" className="primary-button" data-testid="offline-load" disabled={busy || !offlineBundle || meta.fieldMode} onClick={() => void handleOfflineLoad()}>
                装载为外场工作区
              </button>
            </div>
          </div>
        </section>

        {/* 回店：导入对账 */}
        <section className="panel space-y-4 p-6" data-testid="panel-import">
          <div>
            <h2 className="text-lg font-semibold text-wood-900">② 回店：导入现场回传包</h2>
            <p className="mt-1 text-xs leading-5 text-stone-500">
              现场新增的风险说明在店内未改动时自动保留；尺寸冲突进待复核；步骤或示意图已删除则保留快照并指出断点。
              同一批次重复导入只生成一条记录。
            </p>
          </div>
          <input ref={returnInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void pickReturn(event)} />
          <button type="button" className="secondary-button w-full" disabled={busy || meta.fieldMode} onClick={() => returnInputRef.current?.click()}>
            选择现场回传包
          </button>
          {returnBundle ? (
            <div className="rounded-xl border border-wood-100 bg-wood-50/60 p-3 text-xs leading-6 text-stone-600" data-testid="return-preview">
              <div>批次：{returnBundle.batchId}</div>
              <div>导出：{formatTime(returnBundle.exportedAt)} · {returnBundle.exportedBy}</div>
              <div>导出修订：R{returnBundle.headDataRev}</div>
              <div>涉及榫卯：{returnBundle.base.joints.map((joint) => joint.name).join('、')}</div>
            </div>
          ) : null}
          <button
            type="button"
            className="primary-button w-full"
            data-testid="import-return"
            disabled={busy || !returnBundle || meta.fieldMode}
            onClick={() => void handleImport()}
          >
            开始对账导入
          </button>
          {meta.fieldMode ? <p className="text-xs text-amber-700">请先“回店恢复店内资料”，再导入回传包对账。</p> : null}
        </section>
      </div>

      {/* 批次列表 */}
      <section className="space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold text-wood-900">③ 对账批次与待复核</h2>
            <p className="mt-1 text-sm text-stone-500">待复核全部处理完后，该批构件、步序、示意图统一敲到同一修订。</p>
          </div>
        </div>
        {loading && batches.length === 0 ? (
          <p className="py-8 text-center text-sm text-stone-500">正在读取对账记录…</p>
        ) : batches.length === 0 ? (
          <div className="panel px-6 py-10 text-center text-sm text-stone-500">还没有现场回传批次。</div>
        ) : (
          <div className="panel divide-y divide-stone-100">
            {batches.map((batch) => {
              const pending =
                batch.summary.memberConflicts + batch.summary.riskNoteConflicts +
                batch.summary.memberOrphans + batch.summary.stepOrphans + batch.summary.diagramOrphans
              const breakpoints = batch.summary.memberOrphans + batch.summary.stepOrphans + batch.summary.diagramOrphans
              return (
                <Link
                  key={batch.batchId}
                  to={`/sync/batches/${batch.batchId}`}
                  className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4 transition hover:bg-wood-50/60"
                  data-testid="batch-row"
                >
                  <div className="min-w-48">
                    <strong className="block text-sm text-stone-900">{batch.jointTypeIds.map(jointName).join('、')}</strong>
                    <span className="mt-0.5 block text-[11px] text-stone-400">{batch.batchId}</span>
                  </div>
                  <span className="text-xs text-stone-500">导出于 {formatTime(batch.exportedAt)}</span>
                  <span className="text-xs text-stone-500">自动合并 {batch.summary.autoApplied}</span>
                  {breakpoints > 0 ? <span className="text-xs text-rose-700">断点 {breakpoints}</span> : null}
                  {batch.status === 'open' ? (
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800" data-testid="batch-open">{pending} 项待复核</span>
                  ) : (
                    <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800" data-testid="batch-reconciled">
                      已结案 · 同修订 R{batch.committedDataRev}
                    </span>
                  )}
                  <span className="ml-auto text-xs font-semibold text-wood-700">查看详情 →</span>
                </Link>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
