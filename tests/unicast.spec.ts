import { EventBus, EventMode } from '../src'
import { cleanupRedis, delay } from './helpers'

const redis = {
  host: process.env.REDIS_HOST || 'localhost',
  password: process.env.REDIS_PASSWORD,
  port: 6379,
}

interface RequestData {
  id: string
  message: string
}

interface ResponseData {
  requestId: string
  result: string
}

describe('Unicast Tests', () => {
  // 基本单播功能测试
  test('Basic Message Delivery', async () => {
    await cleanupRedis()

    const instance1 = new EventBus({ redis })
    const instance2 = new EventBus({ redis })
    const received2: RequestData[] = []
    const responses: ResponseData[] = []

    try {
      // 设置目标实例的处理器
      instance2.once<RequestData>('test-event', async (event) => {
        console.log('Instance 2 received:', event.data)
        received2.push(event.data)
        // 使用单播模式发送响应给原发送方
        await instance2.emit('test-event:response', {
          target: event.source,
          data: {
            requestId: event.data.id,
            result: 'message processed',
          },
        })
      })

      // 设置发送方的响应处理器
      instance1.once<ResponseData>('test-event:response', (context) => {
        console.log('Instance 1 received response:', context.data)
        responses.push(context.data)
      })

      await Promise.all([instance1.init(), instance2.init()])

      // 发送单播消息
      const testData = { id: 'test-1', message: 'unicast test' }
      await instance1.emit('test-event', {
        data: testData,
        mode: EventMode.UNICAST,
        target: instance2.id,
      })

      await delay(1000)

      // 验证消息传递
      expect(received2.length).toBe(1)
      expect(received2[0]).toEqual(testData)

      // 验证响应
      expect(responses.length).toBe(1)
      expect(responses[0].requestId).toBe(testData.id)
      expect(responses[0].result).toBe('message processed')
    } finally {
      await Promise.all([instance1.close(), instance2.close()])
    }
  })

  // 可以添加更多单播测试场景
  test('Multiple Target Messages', async () => {
    await cleanupRedis()

    const instance1 = new EventBus({ redis })
    const instance2 = new EventBus({ redis })
    const instance3 = new EventBus({ redis })
    const received2: RequestData[] = []
    const received3: RequestData[] = []

    try {
      instance2.on<RequestData>('test-event', (event) => {
        console.log('Instance 2 received:', event.data)
        received2.push(event.data)
      })

      instance3.on<RequestData>('test-event', (event) => {
        console.log('Instance 3 received:', event.data)
        received3.push(event.data)
      })

      await Promise.all([instance1.init(), instance2.init(), instance3.init()])

      // 发送消息到不同目标
      const message1 = { id: 'msg-1', message: 'message for instance 2' }
      const message2 = { id: 'msg-2', message: 'message for instance 3' }

      await Promise.all([
        instance1.emit('test-event', {
          data: message1,
          mode: EventMode.UNICAST,
          target: instance2.id,
        }),
        instance1.emit('test-event', {
          data: message2,
          mode: EventMode.UNICAST,
          target: instance3.id,
        }),
      ])

      await delay(1000)

      // 验证消息正确送达
      expect(received2.length).toBe(1)
      expect(received3.length).toBe(1)
      expect(received2[0]).toEqual(message1)
      expect(received3[0]).toEqual(message2)
    } finally {
      await Promise.all([
        instance1.close(),
        instance2.close(),
        instance3.close(),
      ])
    }
  })
})
