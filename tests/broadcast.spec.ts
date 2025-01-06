import { EventBus } from '../src'
import { cleanupRedis, delay } from './helpers'

const redis = {
  host: process.env.REDIS_HOST || 'localhost',
  password: process.env.REDIS_PASSWORD,
  port: 6379,
}

interface BroadcastData {
  id: string
  message: string
}

describe('Broadcast Tests', () => {
  // 广播模式测试
  test('Basic Message Delivery', async () => {
    await cleanupRedis()

    const instance1 = new EventBus({ redis })
    const instance2 = new EventBus({ redis })
    const instance3 = new EventBus({ redis })

    const received1: BroadcastData[] = []
    const received2: BroadcastData[] = []
    const received3: BroadcastData[] = []

    try {
      // 设置处理器
      instance1.on<BroadcastData>('test-event', (event) => {
        console.log('Instance 1 received:', event.data)
        received1.push(event.data)
      })

      instance2.on<BroadcastData>('test-event', (event) => {
        console.log('Instance 2 received:', event.data)
        received2.push(event.data)
      })

      instance3.on<BroadcastData>('test-event', (event) => {
        console.log('Instance 3 received:', event.data)
        received3.push(event.data)
      })

      await Promise.all([instance1.init(), instance2.init(), instance3.init()])

      // 发送广播消息
      const testData = { id: 'test-1', message: 'broadcast test' }
      await instance1.emit('test-event', {
        data: testData,
      })

      await delay(200)

      // 验证所有实例都收到消息
      expect(received1.length).toBe(1)
      expect(received2.length).toBe(1)
      expect(received3.length).toBe(1)

      // 验证消息内容
      expect(received1[0]).toEqual(testData)
      expect(received2[0]).toEqual(testData)
      expect(received3[0]).toEqual(testData)
    } finally {
      await Promise.all([
        instance1.close(),
        instance2.close(),
        instance3.close(),
      ])
    }
  })

  // 延迟初始化测试
  test('Late Initialization', async () => {
    await cleanupRedis()

    const instance1 = new EventBus({ redis, onlyNew: true })
    const instance2 = new EventBus({ redis, onlyNew: true })
    const received1: BroadcastData[] = []
    const received2: BroadcastData[] = []

    try {
      instance1.on<BroadcastData>('test-event', (event) => {
        console.log('Instance 1 received:', event.data)
        received1.push(event.data)
      })

      await instance1.init()

      // 发送第一条消息
      const message1 = { id: 'msg-1', message: 'first message' }
      await instance1.emit('test-event', { data: message1 })

      await delay(1000)

      // 延迟初始化第二个实例
      instance2.on<BroadcastData>('test-event', (event) => {
        console.log('Instance 2 received:', event.data)
        received2.push(event.data)
      })
      await instance2.init()

      // 发送第二条消息
      const message2 = { id: 'msg-2', message: 'second message' }
      await instance1.emit('test-event', { data: message2 })

      await delay(1000)

      // 验证结果
      expect(received1.length).toBe(2)
      expect(received2.length).toBe(1)

      expect(received1[0]).toEqual(message1)
      expect(received1[1]).toEqual(message2)
      expect(received2[0]).toEqual(message2)
    } finally {
      await Promise.all([instance1.close(), instance2.close()])
    }
  })

  // 历史消息读取测试
  test('History Messages', async () => {
    await cleanupRedis()

    const instance1 = new EventBus({ redis })
    const received1: BroadcastData[] = []

    try {
      instance1.on<BroadcastData>('test-event', (event) => {
        console.log('Instance 1 received:', event.data)
        received1.push(event.data)
      })

      await instance1.init()

      // 发送历史消息
      const historyMessage = { id: 'history-1', message: 'history message' }
      await instance1.emit('test-event', { data: historyMessage })

      await delay(1000)

      // 创建新实例，配置读取历史消息
      const instance2 = new EventBus({ redis })
      const received2: BroadcastData[] = []

      instance2.on<BroadcastData>('test-event', (event) => {
        console.log('Instance 2 received:', event.data)
        received2.push(event.data)
      })

      await instance2.init()

      // 发送新消息
      const newMessage = { id: 'new-1', message: 'new message' }
      await instance1.emit('test-event', { data: newMessage })

      await delay(1000)

      // 验证结果
      expect(received1.length).toBe(2)
      expect(received2.length).toBe(2)

      expect(received1[0]).toEqual(historyMessage)
      expect(received1[1]).toEqual(newMessage)
      expect(received2[0]).toEqual(historyMessage)
      expect(received2[1]).toEqual(newMessage)

      await instance2.close()
    } finally {
      await instance1.close()
    }
  })
})
