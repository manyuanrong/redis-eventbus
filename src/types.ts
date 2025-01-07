import { RedisOptions } from 'ioredis'

/**
 * 事件总线选项
 */
export interface EventBusOptions {
  /** 事件总线名称，默认default */
  name?: string
  /** Redis 配置 */
  redis: RedisOptions
  /** 消息保留时间（毫秒，默认 5 分钟） */
  messageRetention?: number
  /** Stream 的生存时间（秒，默认 1 小时, EventBus运行期间会自动续期, 如果小于5分钟, 则会被置为5分钟） */
  streamTTL?: number
  /** 是否只读取新消息（默认不读取历史消息） */
  onlyNew?: boolean
  /** 是否启用debug模式 */
  debug?: boolean
  /** 最大消息数量（默认 5000） */
  maxMessageCount?: number
  /** 事件总线角色（默认both） */
  role?: EventBusRole
}

/**
 * 事件总线角色
 */
export type EventBusRole = 'publisher' | 'consumer' | 'both'

/**
 * 事件处理器
 */
export type EventHandler<T = unknown> = (
  message: ReceivedEventMessage<T>
) => void | Promise<void>

/**
 * 事件模式
 */
export enum EventMode {
  /** 广播模式，所有订阅者都会收到消息，并被所有订阅者消费一次 */
  BROADCAST = 'broadcast',
  /** 单播模式，只有指定目标会收到消息，并被指定目标消费一次 */
  UNICAST = 'unicast',
  /** 任播模式，所有订阅者共享消息，但总共只会被消费一次 */
  ANYCAST = 'anycast',
}

/**
 * 事件消息
 */
export interface EventMessage<T = unknown> {
  /** 消息模式 */
  mode?: EventMode
  /** 目标ID（单播模式） */
  target?: string
  /** 消息数据 */
  data?: T
}

export interface ReceivedEventMessage<T = unknown> {
  /** 消息模式 */
  mode: EventMode
  /** 目标ID（单播模式） */
  target?: string
  /** 事件类型 */
  event: string
  /** 消息数据 */
  data: T
  /** 时间戳 */
  timestamp: number
  /** 发送方ID */
  source: string
}
