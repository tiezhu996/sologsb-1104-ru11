/**
 * 组件冒烟（fake-indexeddb + renderToString，npm run test:render）：
 * 静态渲染每个路由，保证组件树、store 选择器与导入链无运行时错误。
 */
import 'fake-indexeddb/auto'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom/server'
import App from '../src/App.tsx'

const routes = ['/joints', '/joints/joint-dovetail', '/joints/joint-dovetail/steps', '/furniture', '/sync']

for (const route of routes) {
  const html = renderToString(
    <StaticRouter location={route}>
      <App />
    </StaticRouter>,
  )
  assert.ok(html.includes('<header'))
  assert.ok(html.length > 500)
}

// 不存在的榫卯：渲染应走兜底而不是抛错
const notFound = renderToString(
  <StaticRouter location="/joints/missing">
    <App />
  </StaticRouter>,
)
assert.ok(notFound.includes('未找到这项榫卯') || notFound.includes('正在读取'))

console.log(`组件静态渲染冒烟通过 ✔ (${routes.length + 1} 个路由)`)
