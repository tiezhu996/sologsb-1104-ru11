import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSyncStore } from '../../stores/syncStore'

/** 外场模式横幅：全店资料已替换为离线快照，提示版本冻结并给出回传/回店入口。 */
export function FieldModeBanner() {
  const meta = useSyncStore((state) => state.meta)
  const refreshMeta = useSyncStore((state) => state.refreshMeta)
  const returnToShop = useSyncStore((state) => state.returnToShop)
  const exportReturnBundle = useSyncStore((state) => state.exportReturnBundle)
  const busy = useSyncStore((state) => state.busy)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void refreshMeta()
  }, [refreshMeta])

  if (!meta.fieldMode) return null

  const exportedAt = meta.fieldExportedAt ? new Date(meta.fieldExportedAt).toLocaleString('zh-CN') : ''

  return (
    <div className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4" data-testid="field-banner">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <span className="inline-flex items-center gap-2 rounded-full bg-sky-700 px-3 py-1 text-xs font-semibold text-white">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
          外场离线模式
        </span>
        <div className="text-sm text-sky-900">
          当前读取的是 <strong>导出当时冻结</strong> 的图鉴，资料修订停在 <strong>R{meta.headDataRev}</strong>
          {exportedAt ? <span className="text-sky-700">（导出于 {exportedAt}）</span> : null}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-sky-700">现场可记：构件测量值、拆装风险说明</span>
          <Link to="/sync" className="secondary-button !border-sky-200 !py-2 text-xs">对账台</Link>
          <button
            type="button"
            className="secondary-button !border-sky-200 !py-2 text-xs"
            data-testid="field-return-export"
            disabled={busy}
            onClick={() => void exportReturnBundle().then(() => setMessage('回传包已导出，回店后在对账台导入。')).catch((error: unknown) => setMessage(error instanceof Error ? error.message : '导出失败'))}
          >
            导出回传包
          </button>
          <button
            type="button"
            className="primary-button !bg-sky-800 !py-2 text-xs hover:!bg-sky-900"
            data-testid="field-restore"
            disabled={busy}
            onClick={() => {
              if (window.confirm('回店恢复将丢弃本机外场工作区，请确认现场记录已导出回传包。')) {
                void returnToShop().then(() => setMessage('已恢复店内资料。')).catch((error: unknown) => setMessage(error instanceof Error ? error.message : '恢复失败'))
              }
            }}
          >
            回店恢复店内资料
          </button>
        </div>
      </div>
      {message ? <p className="mt-3 text-xs text-sky-800" data-testid="field-banner-message">{message}</p> : null}
    </div>
  )
}
