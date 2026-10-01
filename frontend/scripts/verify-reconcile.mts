/**
 * 纯逻辑验证（零运行时依赖，npm run test:logic）：
 * 覆盖：尺寸三方对账、现场风险保留、双方改动冲突、步骤/示意图断点、版本漂移。
 */
import assert from 'node:assert/strict'
import { pendingCount, planReconciliation } from '../src/utils/reconcile.ts'
import type { Diagram } from '../src/types/diagram.ts'
import type { Member } from '../src/types/member.ts'
import type { DisassemblyStep } from '../src/types/step.ts'

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1', jointTypeId: 'j1', name: '榫头', part: '出榫件', grainDir: '顺纹',
    lengthMm: 100, widthMm: 40, thicknessMm: 20, toleranceMm: 0.1, note: '', dataRev: 1, ...overrides,
  }
}
function step(overrides: Partial<DisassemblyStep> = {}): DisassemblyStep {
  return {
    id: 's1', jointTypeId: 'j1', seq: 1, action: '拆卸', direction: '轴向', tool: '木槌',
    riskNote: '基线风险', holdSec: 5, dataRev: 1, ...overrides,
  }
}
function diagram(overrides: Partial<Diagram> = {}): Diagram {
  return {
    id: 'd1', jointTypeId: 'j1', stepId: 's1', title: '示意图', view: '轴测',
    svgMarkup: '<svg/>', hitAreas: [], dataRev: 1, ...overrides,
  }
}

function scenario(base: { members?: Member[]; steps?: DisassemblyStep[]; diagrams?: Diagram[] },
  field: typeof base, shop: { joints?: { id: string }[]; members?: Member[]; steps?: DisassemblyStep[]; diagrams?: Diagram[] }) {
  const joints = [{ id: 'j1' }]
  return planReconciliation(
    { joints: [], members: base.members ?? [], steps: base.steps ?? [], diagrams: base.diagrams ?? [], furniture: [] },
    { joints: [], members: field.members ?? [], steps: field.steps ?? [], diagrams: field.diagrams ?? [], furniture: [] },
    {
      joints: shop.joints ?? joints,
      members: shop.members ?? [],
      steps: shop.steps ?? [],
      diagrams: shop.diagrams ?? [],
    },
  )
}

// 1) 店内未改、现场量出新尺寸 → 自动采用现场值
{
  const base = member()
  const fieldMember = member({ lengthMm: 110 })
  const shopMember = member()
  const plan = scenario({ members: [base] }, { members: [fieldMember] }, { members: [shopMember] })
  assert.equal(plan.reviews.length, 0)
  assert.equal(plan.summary.autoApplied, 1)
  assert.equal(plan.autoApplyMembers[0]?.lengthMm, 110)
}

// 2) 店内已改 + 现场也改 → 冲突待复核，现场值不得直接覆盖
{
  const base = member()
  const plan = scenario(
    { members: [base] },
    { members: [member({ lengthMm: 110 })] },
    { members: [member({ lengthMm: 105, dataRev: 5 })] },
  )
  assert.equal(plan.reviews.length, 1)
  assert.equal(plan.reviews[0]?.kind, 'member-conflict')
  assert.equal(plan.summary.memberConflicts, 1)
  assert.equal(pendingCount(plan.summary), 1)
  const diff = plan.reviews[0]?.fieldDiff
  assert.ok(Array.isArray(diff) && diff[0]?.fieldName === 'lengthMm')
  assert.deepEqual([diff[0].baseValue, diff[0].fieldValue, diff[0].shopValue], [100, 110, 105])
}

// 3) 店内改过尺寸、现场没动该字段 → 仅记录漂移，不进待复核
{
  const plan = scenario(
    { members: [member()] },
    { members: [member()] },
    { members: [member({ lengthMm: 105, dataRev: 9 })] },
  )
  assert.equal(plan.reviews.length, 0)
  assert.equal(plan.summary.drifts, 1)
}

// 4) 现场新增风险说明、店内没动该步骤 → 自动保留
{
  const plan = scenario(
    { steps: [step()] },
    { steps: [step({ riskNote: '现场发现：肩部易崩口' })] },
    { steps: [step()] },
  )
  assert.equal(plan.reviews.length, 0)
  assert.equal(plan.autoApplySteps[0]?.riskNote, '现场发现：肩部易崩口')
}

// 5) 店内也改了风险说明 → 冲突待复核
{
  const plan = scenario(
    { steps: [step()] },
    { steps: [step({ riskNote: '现场版' })] },
    { steps: [step({ riskNote: '店内版', dataRev: 6 })] },
  )
  assert.equal(plan.reviews.length, 1)
  assert.equal(plan.reviews[0]?.kind, 'risk-note-conflict')
  assert.equal(plan.summary.riskNoteConflicts, 1)
}

// 6) 步骤已在店内删除 → 断点保留；绑定步骤也没了的示意图 → 双重断点
{
  const plan = scenario(
    { steps: [step()], diagrams: [diagram()] },
    { steps: [step()], diagrams: [diagram()] },
    { steps: [], diagrams: [] },
  )
  const kinds = plan.reviews.map((review) => review.kind).sort()
  assert.deepEqual(kinds, ['diagram-orphan', 'step-orphan'])
  const diagramReview = plan.reviews.find((review) => review.kind === 'diagram-orphan')
  assert.match(diagramReview?.breakpointNote ?? '', /双重断点/)
  assert.equal(plan.summary.stepOrphans, 1)
  assert.equal(plan.summary.diagramOrphans, 1)
}

// 7) 示意图删除但步骤仍在 → 普通断点，提示不含“双重”
{
  const plan = scenario(
    { steps: [step()], diagrams: [diagram()] },
    { steps: [step()], diagrams: [diagram()] },
    { steps: [step()], diagrams: [] },
  )
  const diagramReview = plan.reviews.find((review) => review.kind === 'diagram-orphan')
  assert.ok(diagramReview)
  assert.doesNotMatch(diagramReview?.breakpointNote ?? '', /双重断点/)
}

// 8) 构件所属榫卯已在店内删除 → member-orphan 且禁止采用现场值
{
  const plan = scenario(
    { members: [member()] },
    { members: [member({ lengthMm: 120 })] },
    { joints: [], members: [] },
  )
  assert.equal(plan.reviews[0]?.kind, 'member-orphan')
  assert.equal(plan.reviews[0]?.jointExists, false)
  assert.equal(plan.reviews[0]?.shopSnapshot, null)
}

console.log('reconcile 纯逻辑验证全部通过 ✔ (8 组场景)')
