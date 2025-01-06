import EJSON from 'ejson'
import { Redis, RedisOptions } from 'ioredis'
import { EventHandler } from './types'

interface EventStreamOptions {
  stream: string
  group: string
  consumer: string
  connection: RedisOptions
  batchSize: number
  onlyNew: boolean
  handler: EventHandler
  messageRetention: number
}

/**
 * 事件流，用于在分布式环境中进行事件消费，
 * 注意：该实现依赖于 Redis Stream，并使用阻塞获取消息,
 * 因此会创建单独的 redis 连接，否则会阻塞 redis 客户端的其他操作
 */
export class EventStream {
  private redis: Redis
  private options: Required<EventStreamOptions>
  private loop: boolean = false

  private loopPromise: Promise<void> | null = null

  constructor(options: EventStreamOptions) {
    this.options = options
    this.redis = new Redis({ ...options.connection, lazyConnect: true })
  }

  public async init() {
    await this.redis.connect()
    const startId = this.options.onlyNew ? '$' : '0'
    await this.redis
      .xgroup(
        'CREATE',
        this.options.stream,
        this.options.group,
        startId,
        'MKSTREAM'
      )
      .catch(() => 0)
    // 创建stream并设置过期时间
    this.redis.expire(this.options.stream, 60).catch(() => 0)
    this.loopPromise = this.startLoop()
  }

  public getStreamKey() {
    return this.options.stream
  }

  public getGroupKey() {
    return this.options.group
  }

  public async close() {
    this.loop = false
    if (this.loopPromise) {
      await this.loopPromise
    }
    await this.redis.quit()
  }

  private async startLoop() {
    this.loop = true

    while (this.loop) {
      const messages: any = await this.redis.xreadgroup(
        'GROUP',
        this.options.group,
        this.options.consumer,
        'COUNT',
        this.options.batchSize,
        'BLOCK',
        1000,
        'STREAMS',
        this.options.stream,
        '>'
      )

      if (messages) {
        for (const message of messages) {
          if (!message[1][0]) continue
          const messageId = message[1][0][0]
          const messageValue = message[1][0][1]
          const [_key, value] = messageValue

          try {
            await this.options.handler(EJSON.parse(value))
          } catch (error) {
            console.error('Error processing message:', error)
          }

          await this.redis.xack(
            this.options.stream,
            this.options.group,
            messageId
          )
        }
      }
    }
  }
}
