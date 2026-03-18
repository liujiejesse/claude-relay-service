#!/usr/bin/env node
/**
 * 将导出的消息记录 JSON 文件批量导入 Elasticsearch
 *
 * 用法：
 *   node elasticsearch/import-to-es.js --file <path> [选项]
 *
 * 选项：
 *   --file <path>        导出的 JSON 文件路径（必填）
 *   --url <url>          ES 地址，默认 http://localhost:9200
 *   --index <name>       索引名称，默认 message-logs
 *   --batch <n>          每批条数，默认 500
 *   --no-create-index    跳过索引创建（索引已存在时可用）
 *   --user <username>    Basic Auth 用户名（可选）
 *   --password <pass>    Basic Auth 密码（可选）
 *
 * 示例：
 *   node elasticsearch/import-to-es.js --file message-logs-2026-03-18.json
 *   node elasticsearch/import-to-es.js --file ./exports/message-logs-2026-03-18.json \
 *     --url http://localhost:9200 --index message-logs --batch 1000
 */

const fs = require('fs')
const path = require('path')

// ── 解析命令行参数 ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const get = (flag, def) => {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] ? args[i + 1] : def
}
const has = (flag) => args.includes(flag)

const filePath = get('--file', null)
const esUrl = get('--url', 'http://localhost:9200').replace(/\/$/, '')
const indexName = get('--index', 'message-logs')
const batchSize = Math.max(1, parseInt(get('--batch', '500')) || 500)
const skipCreateIndex = has('--no-create-index')
const esUser = get('--user', null)
const esPassword = get('--password', null)

if (!filePath) {
  console.error('错误：请指定 --file <path>')
  console.error('用法：node elasticsearch/import-to-es.js --file <path> [--url <url>] [--index <name>]')
  process.exit(1)
}

// ── ES 请求封装 ─────────────────────────────────────────────────────────────────

const authHeader =
  esUser && esPassword
    ? { Authorization: 'Basic ' + Buffer.from(`${esUser}:${esPassword}`).toString('base64') }
    : {}

async function esRequest(method, urlPath, body) {
  const url = `${esUrl}${urlPath}`
  const isNdJson = typeof body === 'string'
  const headers = {
    ...authHeader,
    'Content-Type': isNdJson ? 'application/x-ndjson' : 'application/json'
  }
  const options = { method, headers }
  if (body !== undefined) {
    options.body = isNdJson ? body : JSON.stringify(body)
  }

  const res = await fetch(url, options)
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { _raw: text }
  }
  return { status: res.status, ok: res.ok, json }
}

// ── 创建索引 ────────────────────────────────────────────────────────────────────

async function createIndex() {
  const { status } = await esRequest('HEAD', `/${indexName}`)
  if (status === 200) {
    console.log(`索引 "${indexName}" 已存在，跳过创建`)
    return
  }

  const mapping = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'mapping.json'), 'utf-8')
  )
  const { ok, json } = await esRequest('PUT', `/${indexName}`, mapping)
  if (!ok) {
    console.error('创建索引失败：', JSON.stringify(json, null, 2))
    process.exit(1)
  }
  console.log(`索引 "${indexName}" 创建成功`)
}

// ── 批量导入 ────────────────────────────────────────────────────────────────────

async function bulkIndex(items) {
  let imported = 0
  let errors = 0
  const total = items.length

  for (let i = 0; i < total; i += batchSize) {
    const batch = items.slice(i, i + batchSize)
    const lines = []

    for (const item of batch) {
      lines.push(JSON.stringify({ index: { _index: indexName, _id: item.requestId } }))
      // timestamp: Unix ms → ISO 8601（ES date 类型要求）
      const doc = { ...item, timestamp: new Date(item.timestamp).toISOString() }
      lines.push(JSON.stringify(doc))
    }

    const body = lines.join('\n') + '\n'
    const { ok, json } = await esRequest('POST', '/_bulk', body)

    if (!ok) {
      console.error(`第 ${Math.floor(i / batchSize) + 1} 批请求失败（HTTP ${json.status || '?'}）`)
      errors += batch.length
      continue
    }

    if (json.errors) {
      for (const item of json.items || []) {
        if (item.index?.error) {
          console.warn(`  跳过 ${item.index._id}：${item.index.error.reason}`)
          errors++
        } else {
          imported++
        }
      }
    } else {
      imported += batch.length
    }

    const done = Math.min(i + batchSize, total)
    process.stdout.write(`\r进度：${done} / ${total}`)
  }

  process.stdout.write('\n')
  return { imported, errors }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────────

async function main() {
  // 读取文件
  let raw
  try {
    raw = fs.readFileSync(path.resolve(filePath), 'utf-8')
  } catch (e) {
    console.error(`无法读取文件 "${filePath}"：${e.message}`)
    process.exit(1)
  }

  let data
  try {
    data = JSON.parse(raw)
  } catch (e) {
    console.error(`JSON 解析失败：${e.message}`)
    process.exit(1)
  }

  const items = Array.isArray(data.items) ? data.items : []
  if (items.length === 0) {
    console.log('文件中没有记录，退出')
    return
  }

  console.log(`文件：${path.resolve(filePath)}`)
  console.log(`记录数：${items.length}，目标：${esUrl}/${indexName}，批大小：${batchSize}`)

  if (!skipCreateIndex) {
    await createIndex()
  }

  const { imported, errors } = await bulkIndex(items)
  console.log(`\n完成：成功 ${imported} 条，失败/跳过 ${errors} 条`)

  if (errors > 0) process.exit(1)
}

main().catch((e) => {
  console.error('未预期的错误：', e.message)
  process.exit(1)
})
