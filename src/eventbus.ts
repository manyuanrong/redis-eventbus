import EJSON from 'ejson'
import { Redis } from 'ioredis'
import { EventStream } from './stream'
import {
  EventBusOptions,
  EventHandler,
  EventMessage,
  EventMode,
  ReceivedEventMessage,
} from './types'

export class EventBus {
  private redis: Redis
  private instanceId: string
  private keyPrefix: string
  private streams: Record<EventMode, EventStream>
  private options: Required<EventBusOptions>
  private handlers: Map<string, Set<EventHandler>> = new Map()
  private maintenanceTimer?: ReturnType<typeof setInterval>

  constructor(options: EventBusOptions) {
    this.options = {
      ...options,
      name: options.name || 'default',
      messageRetention: options.messageRetention || 5 * 60 * 1000,
      streamTTL: Math.max(options.streamTTL ?? 60 * 60, 5 * 60),
      onlyNew: options.onlyNew ?? false,
      debug: options.debug ?? false,
      maxMessageCount: options.maxMessageCount ?? 5000,
    }
    this.redis = new Redis({ ...this.options.redis, lazyConnect: true })
    this.instanceId = crypto.randomUUID().replace(/-/g, '')

    this.keyPrefix = `eventbus:${this.options.name}:`
    this.streams = {
      // 任播 stream, 所有订阅者共享消息，但总共只会被消费一次
      [EventMode.ANYCAST]: new EventStream({
        connection: this.options.redis,
        stream: this.keyPrefix + 'anycast',
        group: this.keyPrefix + 'group',
        consumer: this.instanceId,
        batchSize: 1,
        onlyNew: this.options.onlyNew,
        handler: this.handleMessage.bind(this),
        messageRetention: this.options.messageRetention,
      }),
      // 广播 stream, 所有订阅者共享消息，消息会被每个订阅者消费一次
      [EventMode.BROADCAST]: new EventStream({
        connection: this.options.redis,
        stream: this.keyPrefix + 'broadcast',
        group: this.keyPrefix + this.instanceId,
        consumer: this.instanceId,
        batchSize: 1,
        onlyNew: this.options.onlyNew,
        handler: this.handleMessage.bind(this),
        messageRetention: this.options.messageRetention,
      }),
      // 单播 stream, 只有指定目标会收到消息，并被指定目标消费一次
      [EventMode.UNICAST]: new EventStream({
        connection: this.options.redis,
        stream: this.keyPrefix + 'unicast:' + this.instanceId,
        group: this.keyPrefix + this.instanceId,
        consumer: this.instanceId,
        batchSize: 10,
        onlyNew: this.options.onlyNew,
        handler: this.handleMessage.bind(this),
        messageRetention: this.options.messageRetention,
      }),
    }
  }

  private async handleMessage(message: ReceivedEventMessage) {
    if (this.options.debug) {
      console.log(message)
    }
    const handlers = this.handlers.get(message.event)
    if (handlers) {
      for (const handler of handlers) {
        await handler(message)
      }
    }
  }

  private async maintainOnce() {
    for (const stream of Object.values(this.streams)) {
      const streamKey = stream.getStreamKey()

      // 修剪消息
      await this.redis.xtrim(streamKey, 'MAXLEN', this.options.maxMessageCount)

      // Stream 续期
      await this.redis.expire(streamKey, this.options.streamTTL)

      const consumers = (await this.redis.xinfo(
        'CONSUMERS',
        streamKey,
        stream.getGroupKey()
      )) as any[][]

      // 删除所有不活跃的消费者
      consumers.forEach(([, name, , , , idle]) => {
        if (idle > this.options.streamTTL) {
          this.redis.xgroup(
            'DELCONSUMER',
            streamKey,
            stream.getGroupKey(),
            name
          )
        }
      })

      // 广播模式需要清理不活跃的消费组
      if (stream === this.streams[EventMode.BROADCAST]) {
        // 找出不活跃的消费组并删除
        const groups = (await this.redis.xinfo('GROUPS', streamKey)) as any[][]
        groups.forEach(([, name]) => {
          const instanceId = name.replace(this.keyPrefix, '')
          // 如果消费组对应的unicast stream不存在说明该消费组不活跃，则删消费组
          const unicastStreamKey = this.keyPrefix + 'unicast:' + instanceId
          this.redis.exists(unicastStreamKey).then((exists) => {
            if (exists === 0) {
              // 二次确认，防止其他实例还未完整初始化
              setTimeout(() => {
                this.redis.exists(unicastStreamKey).then((exists) => {
                  if (exists === 0) {
                    if (this.options.debug) {
                      console.log('delete group', name)
                    }
                    this.redis.xgroup('DESTROY', streamKey, name).catch(() => 0)
                  }
                })
              }, 2000)
            }
          })
        })
      }
    }
  }

  private startMaintenanceTimer() {
    this.maintainOnce()
    this.maintenanceTimer = setInterval(async () => {
      await this.maintainOnce()
    }, 30 * 1000)
  }

  public get id() {
    return this.instanceId
  }

  /**
   * 初始化事件总线
   */
  public async init() {
    await this.redis.connect()
    await Promise.all(
      Object.values(this.streams).map((stream) => stream.init())
    )
    this.startMaintenanceTimer()
  }

  /**
   * 发送消息
   * @param message 消息
   * @returns 消息ID
   */
  public async emit<T = any>(event: string, message: EventMessage<T>) {
    const mode = message.target
      ? EventMode.UNICAST
      : (message.mode ?? EventMode.BROADCAST)

    const payload: Omit<ReceivedEventMessage, 'id'> = {
      ...message,
      mode,
      event,
      timestamp: Date.now(),
      source: this.instanceId,
      data: message.data,
    }

    // 单播模式需要指定目标的stream key
    const streamKey =
      mode === EventMode.UNICAST
        ? this.keyPrefix + 'unicast:' + message.target
        : this.streams[mode].getStreamKey()

    const id = await this.redis.xadd(
      streamKey,
      '*',
      'message',
      EJSON.stringify(payload)
    )
    return id
  }

  /**
   * 订阅事件
   * @param type 事件类型
   * @param handler 事件处理器
   */
  public on<T = any>(type: string, handler: EventHandler<T>): void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler as EventHandler<any>)
  }

  /**
   * 取消订阅事件
   * @param type 事件类型
   * @param handler 事件处理器
   */
  public off<T = any>(type: string, handler: EventHandler<T>): void {
    const handlers = this.handlers.get(type)
    if (handlers) {
      handlers.delete(handler as EventHandler<any>)
      if (handlers.size === 0) {
        this.handlers.delete(type)
      }
    }
  }

  /**
   * 订阅事件一次
   * @param type 事件类型
   * @param handler 事件处理器
   */
  public once<T = any>(type: string, handler: EventHandler<T>): void {
    const wrappedHandler: EventHandler<T> = async (msg) => {
      try {
        await handler(msg)
      } finally {
        this.off(type, wrappedHandler)
      }
    }
    this.on(type, wrappedHandler)
  }

  public async close() {
    await this.redis.quit()
    clearInterval(this.maintenanceTimer)

    // 关闭所有 stream
    await Promise.all(
      Object.values(this.streams).map((stream) => stream.close())
    )
  }
}
