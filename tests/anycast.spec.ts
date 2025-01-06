import { EventBus, EventMode } from '../src'
import { cleanupRedis, delay } from './helpers'

const redis = {
  host: process.env.REDIS_HOST || 'localhost',
  password: process.env.REDIS_PASSWORD,
  port: 6379,
}

interface TaskData {
  id: string
  task: string
}

describe('Anycast Tests', () => {
  // 基本任播功能测试
  it('Basic Message Distribution', async () => {
    await cleanupRedis()

    // 创建3个实例模拟分布式环境
    const instances = Array.from({ length: 3 }, () => new EventBus({ redis }))
    const received = Array.from({ length: 3 }, () => [] as TaskData[])

    try {
      // 为每个实例设置处理器
      instances.forEach((instance, index) => {
        instance.on<TaskData>('process-task', (event) => {
          console.log(`Instance ${index + 1} processing:`, event.data)
          received[index].push(event.data)
        })
      })

      await Promise.all(instances.map((instance) => instance.init()))

      // 发送多个任务
      const tasks = Array.from({ length: 30 }, (_, i) => ({
        id: `task-${i + 1}`,
        task: `Task ${i + 1}`,
      }))

      await Promise.all(
        tasks.map((task) =>
          instances[0].emit('process-task', {
            data: task,
            mode: EventMode.ANYCAST,
          })
        )
      )

      await delay(5000)

      // 验证结果
      const totalProcessed = received.reduce((sum, arr) => sum + arr.length, 0)
      expect(totalProcessed).toBe(tasks.length)

      // 验证任务分配的均衡性
      const expectedPerInstance = tasks.length / instances.length
      const tolerance = expectedPerInstance * 0.5 // 允许50%的偏差

      received.forEach((instanceTasks, index) => {
        console.log(
          `Instance ${index + 1} processed ${instanceTasks.length} tasks`
        )
        expect(instanceTasks.length).toBeGreaterThanOrEqual(
          expectedPerInstance - tolerance
        )
      })

      // 验证没有重复处理
      const processedIds = new Set(received.flat().map((task) => task.id))
      expect(processedIds.size).toBe(tasks.length)
    } finally {
      await Promise.all(instances.map((instance) => instance.close()))
    }
  })

  // 实例故障转移测试
  it('Failover', async () => {
    await cleanupRedis()

    const instance1 = new EventBus({ redis })
    const instance2 = new EventBus({ redis })
    const received1: TaskData[] = []
    const received2: TaskData[] = []

    try {
      instance1.on<TaskData>('process-task', (event) => {
        console.log('Instance 1 processing:', event.data)
        received1.push(event.data)
      })

      instance2.on<TaskData>('process-task', (event) => {
        console.log('Instance 2 processing:', event.data)
        received2.push(event.data)
      })

      await Promise.all([instance1.init(), instance2.init()])

      // 发送第一批任务
      const tasks1 = Array.from({ length: 10 }, (_, i) => ({
        id: `task1-${i + 1}`,
        task: `Task 1-${i + 1}`,
      }))

      await Promise.all(
        tasks1.map((task) =>
          instance1.emit('process-task', {
            data: task,
            mode: EventMode.ANYCAST,
          })
        )
      )

      await delay(2000)

      // 关闭第一个实例模拟故障
      await instance1.close()

      // 发送第二批任务
      const tasks2 = Array.from({ length: 10 }, (_, i) => ({
        id: `task2-${i + 1}`,
        task: `Task 2-${i + 1}`,
      }))

      await Promise.all(
        tasks2.map((task) =>
          instance2.emit('process-task', {
            data: task,
            mode: EventMode.ANYCAST,
          })
        )
      )

      await delay(3000)

      // 验证结果
      const totalProcessed = received1.length + received2.length
      expect(totalProcessed).toBe(tasks1.length + tasks2.length)

      // 验证第二批任务都由 instance2 处理
      const task2Count = received2.filter((task) =>
        task.id.startsWith('task2-')
      ).length
      expect(task2Count).toBe(tasks2.length)
    } finally {
      await instance2.close()
    }
  })
})
