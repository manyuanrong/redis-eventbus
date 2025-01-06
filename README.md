# Redis EventBus

[![Test](https://github.com/manyuanrong/redis-eventbus/actions/workflows/test.yml/badge.svg)](https://github.com/manyuanrong/redis-eventbus/actions/workflows/test.yml)
[![codecov](https://codecov.io/gh/manyuanrong/redis-eventbus/branch/main/graph/badge.svg)](https://codecov.io/gh/manyuanrong/redis-eventbus)
[![npm version](https://badge.fury.io/js/node-redis-eventbus.svg)](https://badge.fury.io/js/node-redis-eventbus)

基于 Redis Streams 实现的分布式事件总线，支持三种消息分发模式。

## 特性

- **多种消息分发模式**

  - 🔄 **广播 (Broadcast)**: 所有订阅者都会收到并处理消息
  - 🎯 **单播 (Unicast)**: 消息只发送给指定目标
  - ⚖️ **任播 (Anycast)**: 消息在多个订阅者中均衡分发，每条消息只被处理一次

- **可靠性保证**

  - 消息持久化存储
  - 自动故障转移
  - 消息确认机制
  - 自动清理过期数据

- **高性能**

  - 基于 Redis Streams
  - 支持批量消息处理
  - 异步消息处理

- **易用性**
  - TypeScript 支持
  - 完整的类型定义
  - 简单的 API 设计

## 安装

```bash
npm install node-redis-eventbus
```

## 快速开始

```ts
import { EventBus, EventMode } from 'node-redis-eventbus'
// 创建实例
const eventBus = new EventBus({
  redis: {
    host: 'localhost',
    port: 6379,
  },
})
// 初始化
await eventBus.init()
// 订阅事件
eventBus.on('user:created', (message) => {
  console.log('New user created:', message.data)
})
// 发送广播消息（默认模式）
await eventBus.emit('user:created', {
  data: { id: 1, name: 'John' },
})
// 发送单播消息
await eventBus.emit('process:task', {
  mode: EventMode.UNICAST,
  // 实例id，可以给当前实例发送，也可以给其他实例发送（比如在收到其他消息，从消息.source中获取）
  target: eventBus.id,
  data: { taskId: 'task-1' },
})
// 发送任播消息
await eventBus.emit('process:task', {
  mode: EventMode.ANYCAST,
  data: { taskId: 'task-2' },
})
// 清理资源
await eventBus.close()
```

## API

### EventBus

#### 构造选项

```ts
interface EventBusOptions {
  name?: string // 事件总线名称，默认 'default'
  redis: RedisOptions // Redis 连接配置
  messageRetention?: number // 消息保留时间（毫秒），默认 5 分钟
  streamTTL?: number // Stream 生存时间（秒），默认 1 小时
  onlyNew?: boolean // 是否只读取新消息，默认 false
  debug?: boolean // 是否启用调试模式，默认 false
  maxMessageCount?: number // 最大消息数量，默认 5000
}
```

#### 方法

- `init()`: 初始化事件总线
- `emit(event: string, message: EventMessage<T>)`: 发送消息
- `on<T>(event: string, handler: EventHandler<T>)`: 订阅事件
- `off<T>(event: string, handler: EventHandler<T>)`: 取消订阅
- `once<T>(event: string, handler: EventHandler<T>)`: 订阅一次性事件
- `close()`: 关闭事件总线

### 消息类型

```typescript
interface EventMessage<T = unknown> {
  mode?: EventMode // 消息模式
  target?: string // 目标实例ID（单播模式）
  data?: T // 消息数据
}

interface ReceivedEventMessage<T = unknown> extends EventMessage<T> {
  event: string // 事件类型
  timestamp: number // 时间戳
  source: string // 发送方ID
}
```

## 使用场景

1. **微服务通信**

   - 服务间事件通知
   - 状态变更广播
   - 任务分发

2. **实时数据同步**

   - 缓存更新通知
   - 数据变更广播
   - 配置更新推送

3. **任务调度**
   - 工作任务分发
   - 负载均衡
   - 任务队列

## 使用场景示例

### 1. 微服务间的事件通知

```typescript
// 共享的事件总线配置
const busOptions = {
  name: 'microservices', // 所有微服务共享同一个事件总线空间
  redis,
}

// 用户服务
const userService = new EventBus(busOptions)

// 当用户注册时发送事件
await userService.emit('user:registered', {
  data: {
    userId: 'user-1',
    email: 'user@example.com',
    timestamp: Date.now(),
  },
})

// 邮件服务
const emailService = new EventBus(busOptions)

// 监听用户注册事件并发送欢迎邮件
emailService.on('user:registered', async (message) => {
  await sendWelcomeEmail(message.data.email)
})
```

### 2. 分布式任务处理

```typescript
// 任务分发器
const dispatcher = new EventBus({ redis })

// 分发任务给多个工作节点
for (const task of tasks) {
  await dispatcher.emit('task:process', {
    mode: EventMode.ANYCAST, // 使用任播模式实现负载均衡
    data: {
      taskId: task.id,
      payload: task.data,
    },
  })
}

// 工作节点
const worker = new EventBus({ redis })

worker.on('task:process', async (message) => {
  const { taskId, payload } = message.data

  try {
    const result = await processTask(payload)
    // 处理完成后通知分发器
    await worker.emit('task:completed', {
      target: message.source, // 回复给源实例
      data: { taskId, result },
    })
  } catch (error) {
    await worker.emit('task:failed', {
      target: message.source,
      data: { taskId, error: error.message },
    })
  }
})
```

### 3. 实时配置更新

```typescript
// 配置管理服务
const configService = new EventBus({ redis })

// 广播配置更新
async function updateConfig(key: string, value: any) {
  await configService.emit('config:updated', {
    data: { key, value, version: Date.now() },
  })
}

// 应用服务
const appService = new EventBus({ redis })

// 本地配置缓存
const configCache = new Map()

// 监听配置更新
appService.on('config:updated', (message) => {
  const { key, value, version } = message.data
  configCache.set(key, { value, version })
})
```

### 4. 请求-响应模式

```typescript
// RPC 客户端
const client = new EventBus({ redis })

async function callRemoteService<T>(method: string, params: any): Promise<T> {
  return new Promise((resolve, reject) => {
    const requestId = `req-${Date.now()}`

    // 监听一次性响应
    client.once(`response:${requestId}`, (message) => {
      const { error, result } = message.data
      if (error) reject(new Error(error))
      else resolve(result)
    })

    // 发送请求
    client.emit('rpc:request', {
      mode: EventMode.ANYCAST,
      data: { requestId, method, params },
    })

    // 超时处理
    setTimeout(() => {
      client.off(`response:${requestId}`)
      reject(new Error('Request timeout'))
    }, 5000)
  })
}

// RPC 服务端
const server = new EventBus({ redis })

server.on('rpc:request', async (message) => {
  const { requestId, method, params } = message.data

  try {
    const result = await handleMethod(method, params)
    await server.emit(`response:${requestId}`, {
      target: message.source,
      data: { result },
    })
  } catch (error) {
    await server.emit(`response:${requestId}`, {
      target: message.source,
      data: { error: error.message },
    })
  }
})
```

### 5. 集群状态同步

```typescript
// 集群节点
const node = new EventBus({ redis })

// 定期广播节点状态
setInterval(async () => {
  await node.emit('node:heartbeat', {
    data: {
      nodeId: node.id,
      status: getNodeStatus(),
      timestamp: Date.now(),
    },
  })
}, 5000)

// 维护集群状态
const clusterState = new Map()

node.on('node:heartbeat', (message) => {
  const { nodeId, status, timestamp } = message.data
  clusterState.set(nodeId, { status, lastSeen: timestamp })

  // 清理过期节点
  const now = Date.now()
  for (const [id, info] of clusterState) {
    if (now - info.lastSeen > 15000) {
      clusterState.delete(id)
      console.log(`Node ${id} is offline`)
    }
  }
})
```

## 注意事项

1. 确保 Redis 版本 >= 5.0
2. 合理配置消息保留时间和数量限制
3. 在生产环境中建议启用 Redis 持久化
4. 建议使用 Redis 集群以提高可用性

## License

MIT
