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
