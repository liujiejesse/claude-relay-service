const express = require('express')
const { authenticateAdmin } = require('../../middleware/auth')
const logger = require('../../utils/logger')
const messageLogService = require('../../services/messageLogService')

const router = express.Router()

// 查询消息记录列表
router.get('/message-logs', authenticateAdmin, async (req, res) => {
  try {
    const { apiKeyId, model, startTime, endTime, keyword, page, pageSize } = req.query

    const result = await messageLogService.queryLogs({
      apiKeyId,
      model,
      startTime: startTime ? parseInt(startTime) : undefined,
      endTime: endTime ? parseInt(endTime) : undefined,
      keyword,
      page,
      pageSize
    })

    return res.json({ success: true, data: result })
  } catch (error) {
    logger.error('Failed to query message logs:', error)
    return res.status(500).json({ error: 'Failed to query message logs', message: error.message })
  }
})

// 导出消息记录（CSV 或 JSON）
router.get('/message-logs/export', authenticateAdmin, async (req, res) => {
  try {
    const { apiKeyId, model, startTime, endTime, keyword, format = 'json', limit } = req.query

    const items = await messageLogService.exportLogs({
      apiKeyId,
      model,
      startTime: startTime ? parseInt(startTime) : undefined,
      endTime: endTime ? parseInt(endTime) : undefined,
      keyword,
      limit: limit ? parseInt(limit) : undefined
    })

    const toDateStr = (ts) => new Date(ts).toISOString().slice(0, 10)
    let timespan
    if (startTime && endTime) {
      timespan = `${toDateStr(parseInt(startTime))}~${toDateStr(parseInt(endTime))}`
    } else if (items.length > 0) {
      const timestamps = items.map((i) => i.timestamp)
      timespan = `${toDateStr(Math.min(...timestamps))}~${toDateStr(Math.max(...timestamps))}`
    } else {
      timespan = new Date().toISOString().slice(0, 10)
    }
    const filename = `message-logs-${timespan}`

    if (format === 'csv') {
      const csvFields = [
        'requestId',
        'timestamp',
        'apiKeyId',
        'accountId',
        'accountType',
        'model',
        'isStream',
        'statusCode',
        'latency',
        'inputTokens',
        'outputTokens',
        'cacheCreateTokens',
        'cacheReadTokens',
        'cost',
        'stopReason',
        'clientIp',
        'sessionHash',
        'responseContent',
        'requestBody'
      ]

      const escapeCell = (val) => {
        const str = val === null || val === undefined ? '' : String(val)
        if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
          return `"${str.replace(/"/g, '""')}"`
        }
        return str
      }

      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`)
      // UTF-8 BOM，方便 Excel 正确识别中文，逐行流式写出避免超大字符串
      res.write('\uFEFF' + csvFields.join(',') + '\r\n')
      for (const item of items) {
        res.write(csvFields.map((f) => escapeCell(item[f])).join(',') + '\r\n')
      }
      return res.end()
    }

    // JSON 格式：流式写出，避免 JSON.stringify 整体超出 V8 字符串长度限制
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`)
    res.write(`{"exportedAt":"${new Date().toISOString()}","total":${items.length},"items":[`)
    for (let i = 0; i < items.length; i++) {
      res.write(JSON.stringify(items[i]))
      if (i < items.length - 1) res.write(',')
    }
    return res.end(']}')
  } catch (error) {
    logger.error('Failed to export message logs:', error)
    return res.status(500).json({ error: 'Failed to export message logs', message: error.message })
  }
})

// 获取单条完整记录
router.get('/message-logs/:requestId', authenticateAdmin, async (req, res) => {
  try {
    const { requestId } = req.params
    const record = await messageLogService.getLog(requestId)
    if (!record) {
      return res.status(404).json({ error: 'Not found' })
    }
    return res.json({ success: true, data: record })
  } catch (error) {
    logger.error('Failed to get message log:', error)
    return res.status(500).json({ error: 'Failed to get message log', message: error.message })
  }
})

// 以下固定路径路由必须在 /:requestId 之前定义，避免路由冲突

// 按时间范围批量删除
router.delete('/message-logs/by-range', authenticateAdmin, async (req, res) => {
  try {
    const { startTime, endTime, apiKeyId } = req.query
    const count = await messageLogService.deleteLogsByRange({
      startTime: startTime ? parseInt(startTime) : undefined,
      endTime: endTime ? parseInt(endTime) : undefined,
      apiKeyId
    })
    return res.json({ success: true, data: { deleted: count } })
  } catch (error) {
    logger.error('Failed to delete message logs by range:', error)
    return res
      .status(500)
      .json({ error: 'Failed to delete message logs by range', message: error.message })
  }
})

// 批量删除记录
router.delete('/message-logs/batch', authenticateAdmin, async (req, res) => {
  try {
    const { requestIds } = req.body
    if (!Array.isArray(requestIds) || requestIds.length === 0) {
      return res.status(400).json({ error: 'requestIds must be a non-empty array' })
    }
    let deleted = 0
    for (const requestId of requestIds) {
      const ok = await messageLogService.deleteLog(requestId)
      if (ok) deleted++
    }
    return res.json({ success: true, data: { deleted } })
  } catch (error) {
    logger.error('Failed to batch delete message logs:', error)
    return res
      .status(500)
      .json({ error: 'Failed to batch delete message logs', message: error.message })
  }
})

// 删除单条记录
router.delete('/message-logs/:requestId', authenticateAdmin, async (req, res) => {
  try {
    const { requestId } = req.params
    const deleted = await messageLogService.deleteLog(requestId)
    if (!deleted) {
      return res.status(404).json({ error: 'Not found' })
    }
    return res.json({ success: true })
  } catch (error) {
    logger.error('Failed to delete message log:', error)
    return res.status(500).json({ error: 'Failed to delete message log', message: error.message })
  }
})

// 清除某 API Key 的所有记录
router.delete('/message-logs', authenticateAdmin, async (req, res) => {
  try {
    const { apiKeyId } = req.query
    if (!apiKeyId) {
      return res.status(400).json({ error: 'apiKeyId is required' })
    }
    const count = await messageLogService.clearLogsByKey(apiKeyId)
    return res.json({ success: true, data: { deleted: count } })
  } catch (error) {
    logger.error('Failed to clear message logs:', error)
    return res.status(500).json({ error: 'Failed to clear message logs', message: error.message })
  }
})

module.exports = router
