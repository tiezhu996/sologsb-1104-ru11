import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BlankPanel } from '../components/common/BlankPanel'
import { StepRail } from '../components/common/StepRail'
import { SvgCanvas } from '../components/common/SvgCanvas'
import { useStepOrder } from '../hooks/useStepOrder'
import { useDiagramStore } from '../stores/diagramStore'
import { useFieldSyncStore } from '../stores/fieldSyncStore'
import { useJointStore } from '../stores/jointStore'

export default function StepBoard() {
  const { id: idParam } = useParams()
  const id = idParam ?? ''
  const joints = useJointStore((state) => state.joints)
  const loadAll = useJointStore((state) => state.loadAll)
  const diagrams = useDiagramStore((state) => state.diagrams)
  const selectedMemberId = useDiagramStore((state) => state.selectedMemberId)
  const loadDiagrams = useDiagramStore((state) => state.loadDiagrams)
  const setSelectedMember = useDiagramStore((state) => state.setSelectedMember)
  const riskNotes = useFieldSyncStore((state) => state.riskNotes)
  const loadSyncData = useFieldSyncStore((state) => state.loadSyncData)
  const addRiskNote = useFieldSyncStore((state) => state.addRiskNote)
  const { steps, totalDurationSec, currentStepIndex, move, setCurrentStep } = useStepOrder(id)
  const [riskDraft, setRiskDraft] = useState('')

  useEffect(() => {
    void loadAll()
    void loadSyncData()
    if (id) void loadDiagrams(id)
  }, [id, loadAll, loadDiagrams, loadSyncData])

  const joint = joints.find((item) => item.id === id)
  const currentStep = steps[currentStepIndex]
  const currentDiagram = diagrams.find((diagram) => diagram.stepId === currentStep?.id) ?? diagrams[0]
  const stepRiskNotes = currentStep ? riskNotes.filter((note) => note.stepId === currentStep.id) : []

  const submitRiskNote = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!currentStep || !riskDraft.trim()) return
    await addRiskNote(currentStep.id, riskDraft)
    setRiskDraft('')
  }

  return (
    <div className="space-y-7">
      <div>
        <Link to={`/joints/${id}`} className="inline-flex items-center gap-1.5 text-sm text-wood-700 hover:underline">
          <span aria-hidden="true">←</span> 返回类型详情
        </Link>
      </div>

      <section className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-[0.24em] text-wood-500">STEP SEQUENCE</p>
          <h1 className="text-3xl font-bold tracking-tight text-wood-900 sm:text-4xl">{joint?.name ?? '榫卯'} · 拆装步序编排</h1>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-600">
            拖动左侧步骤调整真实顺序，右侧同步查看每一步的示意图和风险提醒。
          </p>
        </div>
        <div className="rounded-xl border border-wood-100 bg-white px-5 py-3 text-sm text-stone-600 shadow-sm">
          {steps.length} 步 · 总停留 <strong className="text-wood-700">{totalDurationSec}</strong> 秒
        </div>
      </section>

      {steps.length === 0 ? (
        <BlankPanel title="当前类型尚无步骤" description="没有可编排的拆装动作，请先补充步骤数据。" />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
          <section className="panel max-h-[720px] overflow-y-auto p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-wood-900">步骤轨道</h2>
                <p className="mt-1 text-xs text-stone-500">拖动任意步骤到目标位置</p>
              </div>
              <span className="rounded-full bg-wood-50 px-3 py-1 text-xs text-wood-700">自动保存</span>
            </div>
            <StepRail
              steps={steps}
              currentIndex={currentStepIndex}
              onSelect={setCurrentStep}
              onMove={(from, to) => void move(from, to)}
            />
          </section>

          <section className="space-y-5">
            <div className="panel p-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-wood-700 text-lg font-bold text-white">
                  {currentStep?.seq ?? 0}
                </span>
                <div>
                  <h2 className="text-xl font-semibold text-wood-900">{currentStep?.action ?? '步骤'} · {currentStep?.direction ?? '方向'}</h2>
                  <p className="mt-1 text-xs text-stone-500">使用工具：{currentStep?.tool ?? '待补充'} · 停留 {currentStep?.holdSec ?? 0} 秒</p>
                </div>
              </div>
              <div className="mt-5 rounded-xl border border-amber-100 bg-amber-50/70 px-4 py-3">
                <p className="text-xs font-semibold text-amber-900">易损部位提醒</p>
                <p className="mt-1 text-sm leading-6 text-amber-900/80">{currentStep?.riskNote ?? '暂无提醒'}</p>
              </div>

              {currentStep ? (
                <div className="mt-4 rounded-xl border border-wood-100 bg-white px-4 py-4" data-testid="field-risk-panel">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-wood-900">外场新增风险说明</p>
                    <span className="rounded-full bg-wood-50 px-2 py-0.5 text-[11px] text-wood-700">{stepRiskNotes.length} 条</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-stone-500">外场记录随导出快照固定版本，回店导入后保留为待复核项，不直接改正文。</p>
                  {stepRiskNotes.length > 0 ? (
                    <ul className="mt-3 space-y-2">
                      {stepRiskNotes.map((note) => (
                        <li key={note.id} className="rounded-lg bg-amber-50/70 px-3 py-2 text-xs leading-5 text-amber-900" data-testid="field-risk-note">
                          {note.riskNote}
                          <span className="mt-0.5 block text-[10px] text-amber-700/70">{new Date(note.notedAt).toLocaleString('zh-CN')}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <form className="mt-3 flex gap-2" onSubmit={(event) => void submitRiskNote(event)}>
                    <input
                      className="input-field flex-1"
                      data-testid="field-risk-input"
                      value={riskDraft}
                      onChange={(event) => setRiskDraft(event.target.value)}
                      placeholder="例如：现场湿度偏高，第2步退出阻力明显增大"
                    />
                    <button type="submit" className="secondary-button shrink-0" data-testid="field-risk-submit" disabled={!riskDraft.trim()}>
                      记下风险
                    </button>
                  </form>
                </div>
              ) : null}
            </div>

            <SvgCanvas
              svgMarkup={currentDiagram?.svgMarkup ?? ''}
              title={currentDiagram?.title ?? '步骤预览'}
              hitAreas={currentDiagram?.hitAreas ?? []}
              selectedMemberId={selectedMemberId}
              onSelectMember={setSelectedMember}
              emptyMessage="该步骤暂未绑定示意图"
            />
          </section>
        </div>
      )}
    </div>
  )
}
