<template>
  <div class="space-y-4 p-4 lg:p-6">
    <!-- 页面标题 -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p class="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400">
          消息记录
        </p>
        <h2 class="text-xl font-bold text-gray-900 dark:text-gray-100">LLM 消息日志</h2>
        <p class="text-xs text-gray-500 dark:text-gray-400">记录所有经过中转的 LLM 请求与响应</p>
      </div>
      <el-button :loading="loading" @click="fetchLogs(1)">
        <i class="fas fa-sync-alt mr-2" />刷新
      </el-button>
    </div>

    <!-- 筛选栏 -->
    <div
      class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <div class="flex flex-wrap items-center gap-3">
        <el-date-picker
          v-model="filters.dateRange"
          class="max-w-[320px]"
          clearable
          end-placeholder="结束时间"
          format="YYYY-MM-DD HH:mm:ss"
          start-placeholder="开始时间"
          type="datetimerange"
          unlink-panels
          value-format="x"
        />

        <el-input
          v-model="filters.apiKeyId"
          class="w-[220px]"
          clearable
          placeholder="API Key ID"
          @keyup.enter="handleSearch"
        />

        <el-input
          v-model="filters.model"
          class="w-[200px]"
          clearable
          placeholder="模型名称"
          @keyup.enter="handleSearch"
        />

        <el-input
          v-model="filters.keyword"
          class="w-[220px]"
          clearable
          placeholder="搜索内容关键词"
          @keyup.enter="handleSearch"
        >
          <template #prefix>
            <i class="fas fa-search text-gray-400" />
          </template>
        </el-input>

        <el-button type="primary" @click="handleSearch">
          <i class="fas fa-search mr-2" />搜索
        </el-button>
        <el-button @click="resetFilters"> <i class="fas fa-undo mr-2" />重置 </el-button>
      </div>
    </div>

    <!-- 表格 -->
    <div
      class="rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900"
    >
      <div
        v-if="loading"
        class="flex items-center justify-center p-10 text-gray-500 dark:text-gray-400"
      >
        <i class="fas fa-spinner fa-spin mr-2" />加载中...
      </div>
      <div v-else>
        <div
          v-if="logs.length === 0"
          class="flex flex-col items-center gap-2 p-10 text-gray-500 dark:text-gray-400"
        >
          <i class="fas fa-inbox text-2xl" />
          <p>暂无记录</p>
        </div>
        <div v-else>
          <!-- 桌面端表格 -->
          <div class="hidden overflow-x-auto md:block">
            <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
              <thead class="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th class="table-th">时间</th>
                  <th class="table-th">API Key</th>
                  <th class="table-th">模型</th>
                  <th class="table-th">类型</th>
                  <th class="table-th">总输入</th>
                  <th class="table-th">输出</th>
                  <th class="table-th">费用</th>
                  <th class="table-th">延迟</th>
                  <th class="table-th text-right">操作</th>
                </tr>
              </thead>
              <tbody
                class="divide-y divide-gray-200 bg-white dark:divide-gray-800 dark:bg-gray-900"
              >
                <tr
                  v-for="log in logs"
                  :key="log.requestId"
                  class="hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-800 dark:text-gray-100">
                    {{ formatDate(log.timestamp) }}
                  </td>
                  <td class="px-4 py-3 text-sm">
                    <span class="font-mono text-xs text-gray-600 dark:text-gray-400">
                      {{ log.apiKeyId ? log.apiKeyId.slice(0, 8) + '...' : '-' }}
                    </span>
                  </td>
                  <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-800 dark:text-gray-100">
                    {{ log.model || '-' }}
                  </td>
                  <td class="whitespace-nowrap px-4 py-3 text-sm">
                    <span
                      class="rounded px-2 py-0.5 text-xs font-medium"
                      :class="
                        log.isStream
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                      "
                    >
                      {{ log.isStream ? '流式' : '非流式' }}
                    </span>
                  </td>
                  <td class="whitespace-nowrap px-4 py-3 text-sm text-blue-600 dark:text-blue-400">
                    {{
                      formatNumber(log.inputTokens + log.cacheCreateTokens + log.cacheReadTokens)
                    }}
                  </td>
                  <td
                    class="whitespace-nowrap px-4 py-3 text-sm text-green-600 dark:text-green-400"
                  >
                    {{ formatNumber(log.outputTokens) }}
                  </td>
                  <td
                    class="whitespace-nowrap px-4 py-3 text-sm text-yellow-600 dark:text-yellow-400"
                  >
                    {{ formatCost(log.cost) }}
                  </td>
                  <td class="whitespace-nowrap px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                    {{ log.latency }}ms
                  </td>
                  <td class="whitespace-nowrap px-4 py-3 text-right text-sm">
                    <div class="flex items-center justify-end gap-2">
                      <el-button size="small" @click="openDetail(log.requestId)">详情</el-button>
                      <el-button size="small" type="danger" @click="confirmDelete(log.requestId)">
                        删除
                      </el-button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 移动端卡片 -->
          <div class="space-y-3 p-4 md:hidden">
            <div
              v-for="log in logs"
              :key="log.requestId"
              class="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
            >
              <div class="flex items-start justify-between">
                <div>
                  <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {{ log.model || '-' }}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {{ formatDate(log.timestamp) }}
                  </p>
                </div>
                <div class="flex gap-2">
                  <el-button size="small" @click="openDetail(log.requestId)">详情</el-button>
                  <el-button size="small" type="danger" @click="confirmDelete(log.requestId)">
                    删除
                  </el-button>
                </div>
              </div>
              <div class="mt-3 grid grid-cols-2 gap-2 text-sm text-gray-700 dark:text-gray-300">
                <div>
                  总输入：{{
                    formatNumber(log.inputTokens + log.cacheCreateTokens + log.cacheReadTokens)
                  }}
                </div>
                <div>输出：{{ formatNumber(log.outputTokens) }}</div>
                <div class="text-yellow-600 dark:text-yellow-400">
                  费用：{{ formatCost(log.cost) }}
                </div>
                <div>延迟：{{ log.latency }}ms</div>
              </div>
            </div>
          </div>

          <!-- 分页 -->
          <div class="flex items-center justify-between px-4 pb-4">
            <div class="text-sm text-gray-500 dark:text-gray-400">共 {{ total }} 条记录</div>
            <el-pagination
              background
              :current-page="pagination.page"
              layout="prev, pager, next, sizes"
              :page-size="pagination.pageSize"
              :page-sizes="[20, 50, 100, 200]"
              :total="total"
              @current-change="handlePageChange"
              @size-change="handleSizeChange"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 详情弹窗 -->
    <el-dialog
      v-model="detailVisible"
      :close-on-click-modal="true"
      title="消息记录详情"
      width="80%"
    >
      <div v-if="detailLoading" class="flex justify-center py-8 text-gray-500 dark:text-gray-400">
        <i class="fas fa-spinner fa-spin mr-2" />加载中...
      </div>
      <div v-else-if="activeDetail" class="space-y-4">
        <!-- 元数据 -->
        <div class="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 lg:grid-cols-4">
          <div
            v-for="item in metaItems"
            :key="item.label"
            class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800"
          >
            <p class="text-xs text-gray-500 dark:text-gray-400">{{ item.label }}</p>
            <p class="mt-1 font-medium text-gray-900 dark:text-gray-100">{{ item.value }}</p>
          </div>
        </div>

        <!-- 对话消息 -->
        <div v-if="parsedMessages.length > 0">
          <p class="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
            对话消息（{{ parsedMessages.length }} 条）
          </p>
          <div class="max-h-[400px] space-y-2 overflow-auto">
            <div
              v-for="(msg, idx) in parsedMessages"
              :key="idx"
              class="rounded-lg p-3 text-sm"
              :class="
                msg.role === 'user'
                  ? 'bg-blue-50 dark:bg-blue-900/20'
                  : 'bg-gray-50 dark:bg-gray-800'
              "
            >
              <p
                class="mb-1 text-xs font-semibold uppercase"
                :class="
                  msg.role === 'user'
                    ? 'text-blue-600 dark:text-blue-400'
                    : 'text-gray-500 dark:text-gray-400'
                "
              >
                {{ msg.role }}
              </p>
              <pre class="whitespace-pre-wrap text-xs text-gray-800 dark:text-gray-200">{{
                getMessageText(msg.content)
              }}</pre>
            </div>
          </div>
        </div>

        <!-- 请求体 -->
        <div>
          <p class="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">请求体</p>
          <pre
            class="max-h-[300px] overflow-auto rounded-lg bg-gray-50 p-4 text-xs text-gray-800 dark:bg-gray-800 dark:text-gray-200"
            >{{ formatJson(activeDetail.requestBody) }}</pre
          >
        </div>

        <!-- 响应内容 -->
        <div>
          <p class="mb-2 text-sm font-semibold text-gray-700 dark:text-gray-300">响应内容</p>
          <pre
            class="max-h-[400px] overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-4 text-xs text-gray-800 dark:bg-gray-800 dark:text-gray-200"
            >{{ activeDetail.responseContent || '（无内容）' }}</pre
          >
        </div>
      </div>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 删除确认弹窗 -->
    <el-dialog v-model="deleteVisible" title="确认删除" width="400px">
      <p class="text-gray-700 dark:text-gray-300">确定要删除这条消息记录吗？此操作不可撤销。</p>
      <template #footer>
        <el-button @click="deleteVisible = false">取消</el-button>
        <el-button :loading="deleting" type="danger" @click="doDelete">删除</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { getMessageLogsApi, getMessageLogDetailApi, deleteMessageLogApi } from '@/utils/http_apis'
import { showToast, formatNumber, formatDate } from '@/utils/tools'

const loading = ref(false)
const logs = ref([])
const total = ref(0)

const pagination = reactive({
  page: 1,
  pageSize: 20
})

const filters = reactive({
  dateRange: null,
  apiKeyId: '',
  model: '',
  keyword: ''
})

const detailVisible = ref(false)
const detailLoading = ref(false)
const activeDetail = ref(null)

const deleteVisible = ref(false)
const deleting = ref(false)
const pendingDeleteId = ref(null)

const formatCost = (value) => {
  const num = typeof value === 'number' ? value : parseFloat(value) || 0
  if (num >= 1) return `$${num.toFixed(2)}`
  if (num >= 0.001) return `$${num.toFixed(4)}`
  return `$${num.toFixed(6)}`
}

const formatJson = (str) => {
  if (!str) return ''
  try {
    return JSON.stringify(JSON.parse(str), null, 2)
  } catch {
    return str
  }
}

const parsedMessages = computed(() => {
  if (!activeDetail.value?.requestBody) return []
  try {
    const body = JSON.parse(activeDetail.value.requestBody)
    return Array.isArray(body.messages) ? body.messages : []
  } catch {
    return []
  }
})

const getMessageText = (content) => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
  }
  return ''
}

const metaItems = computed(() => {
  if (!activeDetail.value) return []
  const d = activeDetail.value
  return [
    { label: '请求 ID', value: d.requestId },
    { label: '时间', value: formatDate(d.timestamp) },
    { label: '模型', value: d.model || '-' },
    { label: '类型', value: d.isStream ? '流式' : '非流式' },
    { label: '状态码', value: d.statusCode },
    { label: '延迟', value: `${d.latency}ms` },
    {
      label: '输入 Token (含缓存)',
      value: formatNumber(d.inputTokens + d.cacheCreateTokens + d.cacheReadTokens)
    },
    { label: '输入 Token (非缓存)', value: formatNumber(d.inputTokens) },
    { label: '输出 Token', value: formatNumber(d.outputTokens) },
    { label: '缓存创建', value: formatNumber(d.cacheCreateTokens) },
    { label: '缓存读取', value: formatNumber(d.cacheReadTokens) },
    { label: '费用', value: formatCost(d.cost) },
    { label: '结束原因', value: d.stopReason || '-' },
    { label: '账户类型', value: d.accountType || '-' },
    { label: 'Client IP', value: d.clientIp || '-' }
  ]
})

const buildParams = (page) => {
  const params = { page, pageSize: pagination.pageSize }
  if (filters.apiKeyId) params.apiKeyId = filters.apiKeyId
  if (filters.model) params.model = filters.model
  if (filters.keyword) params.keyword = filters.keyword
  if (filters.dateRange && filters.dateRange.length === 2) {
    params.startTime = filters.dateRange[0]
    params.endTime = filters.dateRange[1]
  }
  return params
}

const fetchLogs = async (page = pagination.page) => {
  loading.value = true
  try {
    const res = await getMessageLogsApi(buildParams(page))
    const data = res.data || {}
    logs.value = data.items || []
    total.value = data.total || 0
    pagination.page = data.page || page
    pagination.pageSize = data.pageSize || pagination.pageSize
  } catch (error) {
    showToast(`加载失败：${error.message || '未知错误'}`, 'error')
  } finally {
    loading.value = false
  }
}

const handleSearch = () => {
  pagination.page = 1
  fetchLogs(1)
}

const resetFilters = () => {
  filters.dateRange = null
  filters.apiKeyId = ''
  filters.model = ''
  filters.keyword = ''
  pagination.page = 1
  fetchLogs(1)
}

const handlePageChange = (page) => {
  pagination.page = page
  fetchLogs(page)
}

const handleSizeChange = (size) => {
  pagination.pageSize = size
  pagination.page = 1
  fetchLogs(1)
}

const openDetail = async (requestId) => {
  detailVisible.value = true
  detailLoading.value = true
  activeDetail.value = null
  try {
    const res = await getMessageLogDetailApi(requestId)
    activeDetail.value = res.data || null
  } catch (error) {
    showToast(`加载详情失败：${error.message || '未知错误'}`, 'error')
    detailVisible.value = false
  } finally {
    detailLoading.value = false
  }
}

const confirmDelete = (requestId) => {
  pendingDeleteId.value = requestId
  deleteVisible.value = true
}

const doDelete = async () => {
  if (!pendingDeleteId.value) return
  deleting.value = true
  try {
    await deleteMessageLogApi(pendingDeleteId.value)
    showToast('删除成功', 'success')
    deleteVisible.value = false
    fetchLogs(pagination.page)
  } catch (error) {
    showToast(`删除失败：${error.message || '未知错误'}`, 'error')
  } finally {
    deleting.value = false
    pendingDeleteId.value = null
  }
}

onMounted(() => {
  fetchLogs()
})
</script>

<style scoped>
.table-th {
  @apply px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-300;
}
</style>
