const { v4: uuidv4 } = require('uuid')
const logger = require('../utils/logger')

/**
 * 根据 accountType 推断账户在 Redis 中的 Hash key
 */
function accountRedisKey(accountType, accountId) {
  switch (accountType) {
    case 'claude-official':
      return `claude:account:${accountId}`
    case 'claude-console':
      return `claude_console_account:${accountId}`
    case 'ccr':
      return `ccr_account:${accountId}`
    case 'bedrock':
      return `bedrock:account:${accountId}`
    case 'droid':
      return `droid:account:${accountId}`
    case 'openai':
      return `openai:account:${accountId}`
    default:
      return `claude:account:${accountId}`
  }
}

/**
 * 批量查询 apiKeyId → name 和 accountId → name
 * @param {object[]} items  parseRecord 后的记录数组
 * @returns {Promise<void>}  直接在 items 上写入 apiKeyName / accountName
 */
async function enrichWithNames(items) {
  if (!items || items.length === 0) return

  const redis = getRedis()
  const client = redis.getClientSafe()
  if (!client) return

  // 收集去重后的 keyId 和 accountId
  const keyIds = [...new Set(items.map((r) => r.apiKeyId).filter(Boolean))]
  const accountPairs = [
    ...new Map(
      items
        .filter((r) => r.accountId)
        .map((r) => [
          `${r.accountType}:${r.accountId}`,
          { accountType: r.accountType, accountId: r.accountId }
        ])
    ).values()
  ]

  // 批量拉取
  const pipeline = client.pipeline()
  for (const keyId of keyIds) {
    pipeline.hget(`apikey:${keyId}`, 'name')
  }
  for (const { accountType, accountId } of accountPairs) {
    pipeline.hget(accountRedisKey(accountType, accountId), 'name')
  }

  const results = await pipeline.exec()

  // 建映射表
  const keyNameMap = {}
  for (let i = 0; i < keyIds.length; i++) {
    const [, name] = results[i]
    if (name) keyNameMap[keyIds[i]] = name
  }

  const accountNameMap = {}
  for (let i = 0; i < accountPairs.length; i++) {
    const [, name] = results[keyIds.length + i]
    if (name) accountNameMap[accountPairs[i].accountId] = name
  }

  // 写入每条记录
  for (const item of items) {
    item.apiKeyName = keyNameMap[item.apiKeyId] || ''
    item.accountName = accountNameMap[item.accountId] || ''
  }
}

const ENABLED = process.env.MSG_LOG_ENABLED !== 'false'

function getRedis() {
  return require('../models/redis')
}

function makeKey(requestId) {
  return `msglog:${requestId}`
}

function makeKeyIdx(apiKeyId) {
  return `msglog:idx:key:${apiKeyId}`
}

function makeDateIdx(dateStr) {
  return `msglog:idx:date:${dateStr}`
}

function makeModelIdx(model) {
  return `msglog:idx:model:${model}`
}

const ALL_IDX = 'msglog:idx:all'

function dateStr(ts) {
  return new Date(ts).toISOString().slice(0, 10)
}

/**
 * 保存一条消息记录（fire-and-forget 方式调用）
 * @param {object} data
 * @param {string} data.apiKeyId
 * @param {string} [data.accountId]
 * @param {string} [data.accountType]
 * @param {string} [data.model]
 * @param {boolean} [data.isStream]
 * @param {number} [data.statusCode]
 * @param {number} [data.timestamp]   Unix ms，默认 Date.now()
 * @param {number} [data.latency]     ms
 * @param {number} [data.inputTokens]
 * @param {number} [data.outputTokens]
 * @param {number} [data.cacheCreateTokens]
 * @param {number} [data.cacheReadTokens]
 * @param {number|string} [data.cost]
 * @param {string} [data.sessionHash]
 * @param {string} [data.clientIp]
 * @param {string} [data.stopReason]
 * @param {object|string} [data.requestBody]   原始请求体（object 或 JSON string）
 * @param {string} [data.responseContent]      完整 assistant 文本
 */
async function saveLog(data) {
  if (!ENABLED) return

  const redis = getRedis()
  const client = redis.getClientSafe()
  if (!client) return

  const requestId = uuidv4()
  const timestamp = data.timestamp || Date.now()

  const requestBodyStr =
    typeof data.requestBody === 'string'
      ? data.requestBody
      : data.requestBody
        ? JSON.stringify(data.requestBody)
        : ''

  const record = {
    requestId,
    apiKeyId: data.apiKeyId || '',
    accountId: data.accountId || '',
    accountType: data.accountType || '',
    model: data.model || '',
    isStream: data.isStream ? 'true' : 'false',
    statusCode: String(data.statusCode || 200),
    timestamp: String(timestamp),
    latency: String(data.latency || 0),
    inputTokens: String(data.inputTokens || 0),
    outputTokens: String(data.outputTokens || 0),
    cacheCreateTokens: String(data.cacheCreateTokens || 0),
    cacheReadTokens: String(data.cacheReadTokens || 0),
    cost: String(data.cost || 0),
    sessionHash: data.sessionHash || '',
    clientIp: data.clientIp || '',
    stopReason: data.stopReason || '',
    requestBody: requestBodyStr,
    responseContent: data.responseContent || ''
  }

  const pipeline = client.pipeline()
  pipeline.hset(makeKey(requestId), record)

  if (data.apiKeyId) {
    pipeline.zadd(makeKeyIdx(data.apiKeyId), timestamp, requestId)
  }

  const ds = dateStr(timestamp)
  pipeline.zadd(makeDateIdx(ds), timestamp, requestId)

  if (data.model) {
    pipeline.zadd(makeModelIdx(data.model), timestamp, requestId)
  }

  pipeline.zadd(ALL_IDX, timestamp, requestId)

  await pipeline.exec()
}

/**
 * 查询消息记录列表
 * @param {object} options
 * @param {string} [options.apiKeyId]
 * @param {string} [options.model]
 * @param {number} [options.startTime]  Unix ms
 * @param {number} [options.endTime]    Unix ms
 * @param {string} [options.keyword]    在 responseContent/requestBody 中搜索
 * @param {number} [options.page]       默认 1
 * @param {number} [options.pageSize]   默认 20，最大 200
 * @returns {Promise<{items: object[], total: number, page: number, pageSize: number, totalPages: number}>}
 */
async function queryLogs(options = {}) {
  const redis = getRedis()
  const client = redis.getClientSafe()

  const page = Math.max(1, parseInt(options.page) || 1)
  const pageSize = Math.min(200, Math.max(1, parseInt(options.pageSize) || 20))
  const startScore = options.startTime || '-inf'
  const endScore = options.endTime || '+inf'

  // 选择最精确的索引
  let indexKey
  if (options.apiKeyId) {
    indexKey = makeKeyIdx(options.apiKeyId)
  } else if (options.model) {
    indexKey = makeModelIdx(options.model)
  } else {
    indexKey = ALL_IDX
  }

  // 先获取候选 requestId 列表（时间范围内，倒序）
  let candidates = await client.zrevrangebyscore(indexKey, endScore, startScore)

  // 若同时指定了 model 但使用的是 apiKeyId 索引，需在内存中过滤
  const needModelFilter = options.model && options.apiKeyId

  let items = []

  if (candidates.length === 0) {
    return { items: [], total: 0, page, pageSize, totalPages: 0 }
  }

  // 批量拉取完整记录（pipeline）
  const pipeline = client.pipeline()
  for (const id of candidates) {
    pipeline.hgetall(makeKey(id))
  }
  const results = await pipeline.exec()

  for (let i = 0; i < results.length; i++) {
    const [err, record] = results[i]
    if (err || !record || !record.requestId) continue

    // model 过滤
    if (needModelFilter && record.model !== options.model) continue

    // keyword 过滤（在 responseContent 和 requestBody 中搜索）
    if (options.keyword) {
      const kw = options.keyword.toLowerCase()
      const inResponse = (record.responseContent || '').toLowerCase().includes(kw)
      const inRequest = (record.requestBody || '').toLowerCase().includes(kw)
      if (!inResponse && !inRequest) continue
    }

    items.push(parseRecord(record))
  }

  const total = items.length
  const totalPages = Math.ceil(total / pageSize)
  const offset = (page - 1) * pageSize
  items = items.slice(offset, offset + pageSize)

  await enrichWithNames(items)
  return { items, total, page, pageSize, totalPages }
}

/**
 * 导出消息记录（不分页，返回所有匹配项含完整字段）
 * @param {object} options  同 queryLogs，但无 page/pageSize
 * @param {number} [options.limit]  最大条数，默认 10000
 * @returns {Promise<object[]>}
 */
async function exportLogs(options = {}) {
  const redis = getRedis()
  const client = redis.getClientSafe()

  const limit = Math.min(50000, Math.max(1, parseInt(options.limit) || 10000))
  const startScore = options.startTime || '-inf'
  const endScore = options.endTime || '+inf'

  let indexKey
  if (options.apiKeyId) {
    indexKey = makeKeyIdx(options.apiKeyId)
  } else if (options.model) {
    indexKey = makeModelIdx(options.model)
  } else {
    indexKey = ALL_IDX
  }

  const candidates = await client.zrevrangebyscore(indexKey, endScore, startScore)
  if (candidates.length === 0) return []

  const needModelFilter = options.model && options.apiKeyId

  const pipeline = client.pipeline()
  for (const id of candidates) {
    pipeline.hgetall(makeKey(id))
  }
  const results = await pipeline.exec()

  const items = []
  for (let i = 0; i < results.length; i++) {
    if (items.length >= limit) break
    const [err, record] = results[i]
    if (err || !record || !record.requestId) continue
    if (needModelFilter && record.model !== options.model) continue
    if (options.keyword) {
      const kw = options.keyword.toLowerCase()
      const inResponse = (record.responseContent || '').toLowerCase().includes(kw)
      const inRequest = (record.requestBody || '').toLowerCase().includes(kw)
      if (!inResponse && !inRequest) continue
    }
    items.push(parseRecord(record, true))
  }

  await enrichWithNames(items)
  return items
}

/**
 * 获取单条完整记录（含 requestBody 和 responseContent）
 */
async function getLog(requestId) {
  const redis = getRedis()
  const client = redis.getClientSafe()
  const record = await client.hgetall(makeKey(requestId))
  if (!record || !record.requestId) return null
  const item = parseRecord(record, true)
  await enrichWithNames([item])
  return item
}

/**
 * 删除单条记录及其索引
 */
async function deleteLog(requestId) {
  const redis = getRedis()
  const client = redis.getClientSafe()

  const record = await client.hgetall(makeKey(requestId))
  if (!record || !record.requestId) return false

  const ts = parseInt(record.timestamp) || 0

  const pipeline = client.pipeline()
  pipeline.del(makeKey(requestId))
  if (record.apiKeyId) pipeline.zrem(makeKeyIdx(record.apiKeyId), requestId)
  if (record.model) pipeline.zrem(makeModelIdx(record.model), requestId)
  if (ts) {
    const ds = dateStr(ts)
    pipeline.zrem(makeDateIdx(ds), requestId)
  }
  pipeline.zrem(ALL_IDX, requestId)
  await pipeline.exec()
  return true
}

/**
 * 清除某 API Key 的所有记录
 */
async function clearLogsByKey(apiKeyId) {
  const redis = getRedis()
  const client = redis.getClientSafe()

  const idxKey = makeKeyIdx(apiKeyId)
  const ids = await client.zrange(idxKey, 0, -1)
  if (ids.length === 0) return 0

  const pipeline = client.pipeline()
  for (const id of ids) {
    pipeline.del(makeKey(id))
  }
  pipeline.del(idxKey)
  await pipeline.exec()

  // 从其他索引清除（忽略 date 和 model 索引，依靠 hgetall miss 即失效）
  const allPipeline = client.pipeline()
  for (const id of ids) {
    allPipeline.zrem(ALL_IDX, id)
  }
  await allPipeline.exec()

  return ids.length
}

/**
 * 将 Redis Hash 字段转换为结构化对象
 * @param {object} record  原始 Hash 字段
 * @param {boolean} full   是否包含 requestBody 和 responseContent
 */
function parseRecord(record, full = false) {
  const parsed = {
    requestId: record.requestId,
    apiKeyId: record.apiKeyId,
    accountId: record.accountId,
    accountType: record.accountType,
    model: record.model,
    isStream: record.isStream === 'true',
    statusCode: parseInt(record.statusCode) || 200,
    timestamp: parseInt(record.timestamp) || 0,
    latency: parseInt(record.latency) || 0,
    inputTokens: parseInt(record.inputTokens) || 0,
    outputTokens: parseInt(record.outputTokens) || 0,
    cacheCreateTokens: parseInt(record.cacheCreateTokens) || 0,
    cacheReadTokens: parseInt(record.cacheReadTokens) || 0,
    cost: parseFloat(record.cost) || 0,
    sessionHash: record.sessionHash,
    clientIp: record.clientIp,
    stopReason: record.stopReason
  }

  if (full) {
    parsed.requestBody = record.requestBody || ''
    parsed.responseContent = record.responseContent || ''
  }

  return parsed
}

module.exports = { saveLog, queryLogs, exportLogs, getLog, deleteLog, clearLogsByKey }
