import { useSyncStore } from '../../stores/syncStore'
import type { ReviewItem } from '../../types/sync'
import { isRiskNoteDiff, MEMBER_FIELD_LABELS } from '../../utils/reconcile'

interface ReviewCardProps {
  item: ReviewItem
  jointName: string
}

const KIND_LABEL: Record<ReviewItem['kind'], string> = {
  'member-conflict': '构件尺寸冲突',
  'risk-note-conflict': '风险说明冲突',
  'step-orphan': '步骤断点',
  'diagram-orphan': '示意图断点',
  'member-orphan': '构件断点',
}

function entityTitle(item: ReviewItem): string {
  if (item.entityType === 'member') return (item.fieldSnapshot as { name: string }).name
  if (item.entityType === 'step') {
    const step = item.fieldSnapshot as { seq: number; action: string; direction: string }
    return `第 ${step.seq} 步 · ${step.action} · ${step.direction}`
  }
  return (item.fieldSnapshot as { title: string }).title
}

function StatusPill({ item }: { item: ReviewItem }) {
  if (item.status === 'pending') {
    return <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800" data-testid="review-pending">待复核</span>
  }
  return (
    <span className="rounded-full bg-stone-100 px-2.5 py-1 text-[11px] font-medium text-stone-600" data-testid="review-resolved">
      已{item.decision === 'field' ? '采用现场值' : '保留店内记录'}
    </span>
  )
}

function CompareColumn({ label, tone, children }: { label: string; tone: 'stone' | 'sky' | 'wood'; children: React.ReactNode }) {
  const toneClass = tone === 'sky'
    ? 'border-sky-200 bg-sky-50/60'
    : tone === 'wood'
      ? 'border-wood-100 bg-wood-50/60'
      : 'border-stone-200 bg-stone-50/70'
  return (
    <div className={`rounded-xl border p-3 text-xs leading-6 ${toneClass}`}>
      <p className="mb-1.5 font-semibold text-stone-700">{label}</p>
      {children}
    </div>
  )
}

export function ReviewCard({ item, jointName }: ReviewCardProps) {
  const resolveOne = useSyncStore((state) => state.resolveOne)
  const busy = useSyncStore((state) => state.busy)
  const isOrphan = item.shopSnapshot === null

  const memberField = item.entityType === 'member' ? (item.fieldSnapshot as { name: string; part?: string }) : null

  return (
    <article className="panel p-5" data-testid="review-card">
      <header className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          isOrphan ? 'bg-rose-50 text-rose-800' : 'bg-amber-50 text-amber-800'
        }`}>
          {KIND_LABEL[item.kind]}
        </span>
        <h3 className="text-base font-semibold text-wood-900">{entityTitle(item)}</h3>
        <span className="text-xs text-stone-500">{jointName}</span>
        <span className="ml-auto"><StatusPill item={item} /></span>
      </header>

      {item.breakpointNote ? (
        <p className="mt-3 rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-xs leading-6 text-rose-900" data-testid="breakpoint-note">
          断点：{item.breakpointNote}
        </p>
      ) : null}

      {item.entityType === 'member' && Array.isArray(item.fieldDiff) && item.fieldDiff.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <CompareColumn label={`导出基线（R${item.baseSnapshot.dataRev}）`} tone="stone">
            {item.fieldDiff.map((diff) => (
              <p key={diff.fieldName}><span className="text-stone-500">{MEMBER_FIELD_LABELS[diff.fieldName]}：</span>{diff.baseValue} mm</p>
            ))}
          </CompareColumn>
          <CompareColumn label={`外场现场（R${item.fieldSnapshot.dataRev}）`} tone="sky">
            {item.fieldDiff.map((diff) => (
              <p key={diff.fieldName} className="font-semibold text-sky-900"><span className="text-sky-700">{MEMBER_FIELD_LABELS[diff.fieldName]}：</span>{diff.fieldValue} mm</p>
            ))}
          </CompareColumn>
          <CompareColumn label={`店内已改（R${item.shopSnapshot?.dataRev}）`} tone="wood">
            {item.fieldDiff.map((diff) => (
              <p key={diff.fieldName} className="font-semibold text-wood-900"><span className="text-wood-700">{MEMBER_FIELD_LABELS[diff.fieldName]}：</span>{diff.shopValue} mm</p>
            ))}
          </CompareColumn>
        </div>
      ) : null}

      {item.entityType === 'step' && isRiskNoteDiff(item.fieldDiff) ? (
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <CompareColumn label="导出基线风险说明" tone="stone"><p className="text-stone-600">{item.fieldDiff.base || '（无）'}</p></CompareColumn>
          <CompareColumn label="外场新增风险说明" tone="sky"><p className="text-sky-900">{item.fieldDiff.field || '（清空）'}</p></CompareColumn>
          <CompareColumn label="店内修改后的风险说明" tone="wood"><p className="text-wood-900">{item.fieldDiff.shop || '（清空）'}</p></CompareColumn>
        </div>
      ) : null}

      {isOrphan ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <CompareColumn label="导出基线记录" tone="stone">
            {item.entityType === 'step'
              ? <p className="text-stone-600">{(item.baseSnapshot as { riskNote?: string }).riskNote}</p>
              : item.entityType === 'member'
                ? <p className="text-stone-600">{memberField?.part} · {(item.baseSnapshot as { lengthMm: number }).lengthMm} mm</p>
                : <p className="text-stone-600">{(item.baseSnapshot as { view?: string }).view}视图 · 含 {(item.baseSnapshot as { hitAreas?: unknown[] }).hitAreas?.length ?? 0} 个热区</p>}
          </CompareColumn>
          <CompareColumn label="外场带回的原记录（已保留）" tone="sky">
            {item.entityType === 'step'
              ? <p className="text-sky-900">{(item.fieldSnapshot as { riskNote?: string }).riskNote}</p>
              : item.entityType === 'member'
                ? <p className="text-sky-900">{(item.fieldSnapshot as { lengthMm: number }).lengthMm} × {(item.fieldSnapshot as { widthMm: number }).widthMm} × {(item.fieldSnapshot as { thicknessMm: number }).thicknessMm} mm</p>
                : <p className="text-sky-900">{(item.fieldSnapshot as { title: string }).title} · 现场 SVG 与热区随包保留</p>}
          </CompareColumn>
        </div>
      ) : null}

      {item.status === 'pending' ? (
        <footer className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="secondary-button text-xs"
            data-testid="decision-shop"
            disabled={busy}
            onClick={() => void resolveOne(item.id, 'shop').catch(() => undefined)}
          >
            {isOrphan ? '仅保留断点记录，不恢复' : '保留店内值'}
          </button>
          <button
            type="button"
            className="primary-button text-xs"
            data-testid="decision-field"
            disabled={busy || !item.jointExists}
            title={!item.jointExists ? '所属榫卯已删除，无法挂接恢复' : undefined}
            onClick={() => void resolveOne(item.id, 'field').catch(() => undefined)}
          >
            {isOrphan ? '采用现场记录并重新挂接' : '采用现场值'}
          </button>
        </footer>
      ) : (
        <footer className="mt-4 text-right text-[11px] text-stone-400">
          {item.resolvedAt ? `处理于 ${new Date(item.resolvedAt).toLocaleString('zh-CN')}` : null}
        </footer>
      )}
    </article>
  )
}
