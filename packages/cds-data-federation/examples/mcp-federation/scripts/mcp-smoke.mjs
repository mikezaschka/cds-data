#!/usr/bin/env node
/**
 * Smoke-test the FederationAgentService MCP endpoint.
 * Prerequisite: bash start.sh (provider :4121 + consumer :4120).
 */
const MCP_URL = process.env.MCP_URL || 'http://localhost:4120/mcp/agent'

function cqnSelect(...fields) {
  return fields.map((f) => ({ ref: f.includes('.') ? f.split('.') : [f] }))
}

async function mcpRequest(body) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
  }
  const jsonLine = text
    .split('\n')
    .map((line) => line.replace(/^data:\s*/, '').trim())
    .find((line) => line.startsWith('{'))
  if (jsonLine) return JSON.parse(jsonLine)
  return JSON.parse(text)
}

async function callTool(name, args) {
  const res = await mcpRequest({
    jsonrpc: '2.0',
    id: `${name}-${Date.now()}`,
    method: 'tools/call',
    params: { name, arguments: args },
  })
  if (res.error) throw new Error(res.error.message || JSON.stringify(res.error))
  if (res.result?.isError) {
    throw new Error(res.result.content?.[0]?.text || 'MCP tool error')
  }
  return res.result
}

async function main() {
  console.log(`MCP smoke test → ${MCP_URL}\n`)

  console.log('1) describe (Customers)')
  const described = await callTool('describe', { entities: ['Customers'] })
  const describeText = described?.content?.[0]?.text || JSON.stringify(described)
  console.log(describeText.slice(0, 600) + (describeText.length > 600 ? '…' : ''))
  console.log()

  console.log('2) query delegated Customers (limit 3)')
  const customers = await callTool('query', {
    entity: 'Customers',
    select: cqnSelect('ID', 'name', 'city'),
    limit: 3,
  })
  const customerPayload = customers?.structuredContent || JSON.parse(customers?.content?.[0]?.text || '{}')
  console.log(JSON.stringify(customerPayload, null, 2))
  console.log()

  console.log('3) query delegated Products with rename mapping (limit 2)')
  const products = await callTool('query', {
    entity: 'Products',
    select: cqnSelect('productId', 'productName', 'unitPrice', 'category'),
    limit: 2,
  })
  const productPayload = products?.structuredContent || JSON.parse(products?.content?.[0]?.text || '{}')
  console.log(JSON.stringify(productPayload, null, 2))
  console.log()

  console.log('4) query replicated ReplicatedCustomers (limit 3)')
  const replicated = await callTool('query', {
    entity: 'ReplicatedCustomers',
    select: cqnSelect('ID', 'name'),
    limit: 3,
  })
  const replPayload = replicated?.structuredContent || JSON.parse(replicated?.content?.[0]?.text || '{}')
  console.log(JSON.stringify(replPayload, null, 2))

  const count = replPayload?.count ?? replPayload?.data?.length ?? 0
  if (count === 0) {
    console.warn('\n⚠ ReplicatedCustomers is empty — preload replicate may still be running, or pipeline failed.')
    console.warn('  POST http://localhost:4120/pipeline/Pipelines(name=\'ReplicatedCustomers\')/start  { "mode": "full" }')
  } else {
    console.log('\n✓ MCP + federation smoke test passed')
  }
}

main().catch((err) => {
  console.error('Smoke test failed:', err.message)
  process.exit(1)
})
