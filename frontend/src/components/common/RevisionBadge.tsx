interface RevisionBadgeProps {
  /** 该榫卯最近一次对账结案敲定的修订水位。 */
  committedRev?: number
  /** 当前店内资料总水位（未结案的榫卯用它判断是否落后）。 */
  headDataRev?: number
  compact?: boolean
}

/**
 * 同一修订徽标：结案后的榫卯在详情、步序、家具反查显示同一个修订号；
 * 编号落在当前水位之后表示结案后店内又有改动。
 */
export function RevisionBadge({ committedRev, headDataRev, compact }: RevisionBadgeProps) {
  if (committedRev === undefined) {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] text-stone-500 ${compact ? '' : ''}`}
        data-testid="rev-badge"
      >
        未对账
      </span>
    )
  }
  const stale = headDataRev !== undefined && headDataRev > committedRev
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${
        stale ? 'border border-amber-200 bg-amber-50 text-amber-800' : 'border border-emerald-200 bg-emerald-50 text-emerald-800'
      }`}
      data-testid="rev-badge"
      title={stale ? `结案修订 R${committedRev}，店内水位 R${headDataRev}，结案后有新改动` : `构件、步序、示意图统一在修订 R${committedRev}`}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m5 12 5 5L20 7" />
      </svg>
      同修订 R{committedRev}
      {stale ? ` · 水位 R${headDataRev}` : ''}
    </span>
  )
}
