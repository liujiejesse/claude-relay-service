# 故障排除：Redis MISCONF 写入锁定

## 错误信息

```
500 MISCONF Redis is configured to save RDB snapshots, but it's currently unable
to persist to disk. Commands that may modify the data set are disabled, because
this instance is configured to report errors during writes if RDB snapshotting
fails (stop-writes-on-bgsave-error option). Please check the Redis logs for
details about the RDB error.
```

## 原因

Redis 默认开启 `stop-writes-on-bgsave-error yes`，当后台 RDB 快照保存失败时（磁盘空间不足、权限问题等），Redis 会拒绝所有写操作。

对于 Railway 托管的 Redis，持久化由平台自身管理，不需要 Redis 自己维护 RDB 快照，因此可以安全关闭此选项。

## 临时修复（重启后失效）

### 方式一：通过 railway run 执行修复脚本（推荐）

**前提**：本地已安装并登录 Railway CLI。

```bash
# 安装 Railway CLI（如未安装）
npm install -g @railway/cli

# 登录
railway login
```

在项目根目录创建临时脚本 `fix-redis.js`：

```js
const Redis = require('ioredis')

const url = process.env.REDIS_PUBLIC_URL
console.log('Connecting to:', url ? url.replace(/:\/\/[^@]+@/, '://***@') : 'undefined')

if (!url) {
  console.error('REDIS_PUBLIC_URL not set')
  process.exit(1)
}

const client = new Redis(url, { connectTimeout: 8000, lazyConnect: true })

client.connect()
  .then(() => {
    console.log('Connected!')
    return client.config('SET', 'stop-writes-on-bgsave-error', 'no')
  })
  .then((r) => {
    console.log('Done:', r)
    return client.quit()
  })
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e.message)
    process.exit(1)
  })

setTimeout(() => {
  console.error('Timeout after 10s')
  process.exit(2)
}, 10000)
```

执行（替换为实际的 project / environment / service ID）：

```bash
railway run \
  --project=<PROJECT_ID> \
  --environment=<ENVIRONMENT_ID> \
  --service=<SERVICE_ID> \
  node fix-redis.js
```

成功输出：

```
Connecting to: redis://***@yamanote.proxy.rlwy.net:xxxxx
Connected!
Done: OK
```

执行完毕后删除临时脚本：

```bash
rm fix-redis.js
```

### 方式二：本地 redis-cli 直连

在 Railway Redis 服务页面开启 Public Networking，获取公网连接信息后执行：

```bash
redis-cli -h <PUBLIC_HOST> -p <PORT> -a <PASSWORD> CONFIG SET stop-writes-on-bgsave-error no
```

### 方式三：Railway SSH 进入服务容器

```bash
railway ssh \
  --project=<PROJECT_ID> \
  --environment=<ENVIRONMENT_ID> \
  --service=<SERVICE_ID>
```

进入容器后：

```bash
redis-cli -h $REDIS_HOST -p $REDIS_PORT -a $REDIS_PASSWORD CONFIG SET stop-writes-on-bgsave-error no
```

---

## 永久修复

临时修复在 Railway 重启 Redis 实例后会失效。要永久解决，需在 Railway Redis 服务中添加配置变量：

1. 打开 Railway Dashboard → 进入 Redis 服务
2. 点击 **Settings** → **Variables**（或 **Config**）
3. 添加：
   ```
   stop-writes-on-bgsave-error = no
   ```
4. 重启 Redis 服务使配置生效

---

## 本项目 Railway 资源 ID

| 资源 | ID |
|------|----|
| Project | `47fa542c-efe1-4d89-867e-37c86137791b` |
| Environment | `f492ca02-0a4f-4e88-9ce4-e6bc8cfb8c9f` |
| Service | `87263212-855f-4de6-8763-27600507e3cc` |

完整修复命令：

```bash
railway run \
  --project=47fa542c-efe1-4d89-867e-37c86137791b \
  --environment=f492ca02-0a4f-4e88-9ce4-e6bc8cfb8c9f \
  --service=87263212-855f-4de6-8763-27600507e3cc \
  node fix-redis.js
```
