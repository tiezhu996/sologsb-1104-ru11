/* 现场回传核心逻辑的场景验证（Node + esbuild，直连 src 纯函数） */
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const result = await build({
  entryPoints: ['src/utils/fieldSync.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  logLevel: 'silent',
})
writeFileSync('/tmp/fieldsync.bundle.mjs', result.outputFiles[0].text)
const mod = await import(pathToFileURL('/tmp/fieldsync.bundle.mjs').href)
const { buildFieldExport, reconcileFieldExport, parseFieldExport, readJointRevision } = mod

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name} ${detail}`) }
}

const now = '2026-10-01T08:00:00.000Z'
const baseJoint = { id: 'j1', name: '燕尾榫', dataRev: 3 }
const memberA = { id: 'm1', jointTypeId: 'j1', name: '榫头', part: '出榫件', grainDir: '顺纹', lengthMm: 128, widthMm: 54, thicknessMm: 28, toleranceMm: 0.15, note: '', dataRev: 3 }
const memberB = { id: 'm2', jointTypeId: 'j1', name: '榫眼', part: '受榫件', grainDir: '横纹', lengthMm: 126, widthMm: 52, thicknessMm: 30, toleranceMm: 0.18, note: '', dataRev: 3 }
const step1 = { id: 's1', jointTypeId: 'j1', seq: 1, action: '拆卸', direction: '轴向', tool: '木槌', riskNote: '正文风险', holdSec: 6, dataRev: 3 }
const step2 = { id: 's2', jointTypeId: 'j1', seq: 2, action: '拆卸', direction: '侧向', tool: '鱼线', riskNote: '', holdSec: 8, dataRev: 3 }
const diagram1 = { id: 'd1', jointTypeId: 'j1', stepId: 's1', title: '示意图一', view: '轴测', svgMarkup: '<svg/>', hitAreas: [], dataRev: 3 }
const furniture1 = { id: 'f1', jointTypeId: 'j1', name: '条案', era: '明式', position: '端部', loadNote: '受力', dataRev: 3 }

// --- 场景 1：导出固定当时版本 ---
console.log('场景1：导出快照固定修订号')
const pack = buildFieldExport({
  joints: [baseJoint],
  members: [memberA, memberB],
  steps: [step1, step2],
  diagrams: [diagram1],
  fieldRiskNotes: [],
  exportedAt: now,
})
check('导出包含批次号', typeof pack.batchId === 'string' && pack.batchId.startsWith('field-'))
check('构件携带当时修订号 r3', pack.members.every((m) => m.dataRev === 3))
check('榫卯条目标记统一修订 r3', pack.joints[0].dataRev === 3)
const reparsed = parseFieldExport(JSON.stringify(pack))
check('快照可被严格解析', reparsed.batchId === pack.batchId)
try {
  parseFieldExport('{ "format": "other" }')
  check('格式不符时报错', false)
} catch (error) { check('格式不符时报错', /外场回传文件/.test(error.message)) }
try {
  parseFieldExport('{bad json')
  check('损坏 JSON 报错', true)
} catch { check('损坏 JSON 报错', true) }

// --- 场景 2：同修订下现场尺寸直接生效；店内改过则列待复核且不覆盖 ---
console.log('场景2：尺寸对账')
{
  const fieldPack = JSON.parse(JSON.stringify(pack))
  fieldPack.members[0].lengthMm = 135 // 现场改了 m1
  fieldPack.members[1].widthMm = 60   // 现场改了 m2
  // 店内：m1 未动（r3），m2 已被店里改到 r4，且店内宽度是 55
  const shopMemberB = { ...memberB, widthMm: 55, dataRev: 4 }
  const r = reconcileFieldExport({
    fieldExport: fieldPack,
    shopJoints: [baseJoint],
    shopMembers: [{ ...memberA }, shopMemberB],
    shopSteps: [step1, step2],
    shopDiagrams: [diagram1],
    now,
  })
  check('m1 同修订现场值进入直接生效', r.memberUpdates.length === 1 && r.memberUpdates[0].memberId === 'm1' && r.memberUpdates[0].dimensions.lengthMm === 135)
  const memberReview = r.reviewItems.find((item) => item.kind === 'member-dimensions')
  check('m2 店内改过 → 待复核', memberReview && memberReview.memberId === 'm2' && memberReview.status === 'pending')
  check('待复核保留现场值 60 与店内值 55 双列', memberReview.diffs.some((d) => d.field === 'widthMm' && d.fieldValue === 60 && d.shopValue === 55))
  check('现场值没有出现在直接生效列表', !r.memberUpdates.some((u) => u.memberId === 'm2'))
}

// --- 场景 3：现场修订反而更新（店内陈旧）也列待复核 ---
console.log('场景3：现场修订更新时')
{
  const fieldPack = JSON.parse(JSON.stringify(pack))
  fieldPack.members[0].lengthMm = 140
  fieldPack.members[0].dataRev = 5
  const r = reconcileFieldExport({
    fieldExport: fieldPack,
    shopJoints: [baseJoint],
    shopMembers: [{ ...memberA }],
    shopSteps: [step1, step2],
    shopDiagrams: [diagram1],
    now,
  })
  const review = r.reviewItems.find((item) => item.kind === 'member-dimensions')
  check('同样不直接覆盖，转待复核', review && review.memberId === 'm1')
  check('备注指明店内可能陈旧', /店内资料可能陈旧/.test(review.note ?? ''))
}

// --- 场景 4：外场新增风险说明保留为待复核 ---
console.log('场景4：外场风险说明')
{
  const fieldPack = JSON.parse(JSON.stringify(pack))
  fieldPack.fieldRiskNotes = [
    { id: 'risk-1', stepId: 's1', riskNote: '现场湿度高，退出阻力大', notedAt: now },
    { id: 'risk-2', stepId: 's2', riskNote: '第二条风险', notedAt: now },
  ]
  const r = reconcileFieldExport({
    fieldExport: fieldPack,
    shopJoints: [baseJoint],
    shopMembers: [memberA, memberB],
    shopSteps: [{ ...step1, riskNote: '正文风险；现场湿度高，退出阻力大' }, step2], // 第一条正文已含同文
    shopDiagrams: [diagram1],
    now,
  })
  const riskReviews = r.reviewItems.filter((item) => item.kind === 'risk-note')
  check('新风险列为待复核', riskReviews.length === 1 && riskReviews[0].stepId === 's2')
  check('同文风险幂等跳过', !riskReviews.some((item) => item.stepId === 's1'))
}

// --- 场景 5：步骤 / 示意图断点保留原记录 ---
console.log('场景5：断点')
{
  const fieldPack = JSON.parse(JSON.stringify(pack))
  // 店内删除了步骤 s2；示意图 d1 仍在但绑定步骤 s1（存在）—— 再造一个 d2 绑 s2
  fieldPack.steps.push({ ...step2 })
  fieldPack.diagrams.push({ id: 'd2', jointTypeId: 'j1', stepId: 's2', title: '示意图二', view: '正视', svgMarkup: '<svg>d2</svg>', hitAreas: [], dataRev: 3 })
  const shopDiagramD2 = { id: 'd2', jointTypeId: 'j1', stepId: 's2', title: '示意图二（店内）', view: '正视', svgMarkup: '<svg>shop</svg>', hitAreas: [], dataRev: 4 }
  const r = reconcileFieldExport({
    fieldExport: fieldPack,
    shopJoints: [baseJoint],
    shopMembers: [memberA, memberB],
    shopSteps: [step1], // s2 缺失
    shopDiagrams: [diagram1, shopDiagramD2], // d2 还在但绑的步骤没了
    now,
  })
  const brokenStep = r.reviewItems.find((item) => item.kind === 'broken-step' && item.stepId === 's2')
  check('缺失步骤保留现场原记录', brokenStep && brokenStep.fieldRecord && brokenStep.fieldRecord.id === 's2')
  check('断点消息指出具体步骤', /店内已无第 2 步/.test(brokenStep.brokenRef.message))
  const brokenDiagram = r.reviewItems.find((item) => item.kind === 'broken-diagram' && item.diagramId === 'd2')
  check('示意图绑定步骤删除 → 示意图断点', brokenDiagram && /步骤/.test(brokenDiagram.brokenRef.message))

  // 整图被删的情形
  const r2 = reconcileFieldExport({
    fieldExport: fieldPack,
    shopJoints: [baseJoint],
    shopMembers: [memberA, memberB],
    shopSteps: [step1, step2],
    shopDiagrams: [diagram1], // d2 整图被删，但 s2 还在
    now,
  })
  const gone = r2.reviewItems.find((item) => item.kind === 'broken-diagram' && item.diagramId === 'd2')
  check('整图被删时现场版本原样保留', gone && gone.fieldRecord.svgMarkup === '<svg>d2</svg>' && /已删除示意图/.test(gone.brokenRef.message))
}

// --- 场景 6：修订一致性读取 ---
console.log('场景6：处理完待复核后读到同一修订')
{
  const aligned = readJointRevision(
    { ...baseJoint, dataRev: 4 },
    [memberA, memberB].map((m) => ({ ...m, dataRev: 4 })),
    [step1, step2].map((s) => ({ ...s, dataRev: 4 })),
    [diagram1].map((d) => ({ ...d, dataRev: 4 })),
    [furniture1].map((f) => ({ ...f, dataRev: 4 })),
  )
  check('五类资料同修订 → consistent', aligned.consistent && aligned.rev === 4)
  const misaligned = readJointRevision(
    { ...baseJoint, dataRev: 4 },
    [{ ...memberA, dataRev: 3 }, memberB],
    [step1, step2],
    [diagram1],
    [furniture1],
  )
  check('存在旧修订 → 不一致被识别', !misaligned.consistent)
}

// --- 场景 7：重复对账幂等（同批次重试结果确定性） ---
console.log('场景7：同批次重复对账结果确定')
{
  const fieldPack = JSON.parse(JSON.stringify(pack))
  fieldPack.members[0].lengthMm = 135
  fieldPack.fieldRiskNotes = [{ id: 'risk-x', stepId: 's2', riskNote: '再一条', notedAt: now }]
  const args = {
    fieldExport: fieldPack,
    shopJoints: [baseJoint],
    shopMembers: [{ ...memberA }, { ...memberB }],
    shopSteps: [step1, step2],
    shopDiagrams: [diagram1],
    now,
  }
  const r1 = reconcileFieldExport(args)
  const r2 = reconcileFieldExport(JSON.parse(JSON.stringify(args)))
  check('重复对账产出相同数量的待复核', r1.reviewItems.length === r2.reviewItems.length)
  check('待复核 id 由批次号决定（重试不产生新 id）', r1.reviewItems.every((item, i) => item.id === r2.reviewItems[i].id))
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
process.exit(failed > 0 ? 1 : 0)
