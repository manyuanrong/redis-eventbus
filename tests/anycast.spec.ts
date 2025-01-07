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

interface WorkTask {
  id: string
  data: number // 用于计算的数据
}

interface TaskResult {
  taskId: string
  result: number
  workerId: string
  processTime: number
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

  // 耗时任务处理测试
  it.only('Process Time-consuming Tasks', async () => {
    await cleanupRedis()

    // 创建纯发布者
    const publisher = new EventBus({
      redis,
      role: 'publisher', // 声明为发布者
    })
    await publisher.init()

    // 创建工作节点（消费者）
    const worker1 = new EventBus({
      redis,
      role: 'consumer', // 声明为消费者
    })
    const worker2 = new EventBus({
      redis,
      role: 'consumer',
    })

    const results1: TaskResult[] = []
    const results2: TaskResult[] = []

    // 模拟不同的处理速度
    worker1.on<WorkTask>('heavy:task', async (message) => {
      const startTime = Date.now()
      // 模拟快速工作节点，处理时间 100-200ms
      await delay(100 + Math.random() * 100)
      const result: TaskResult = {
        taskId: message.data.id,
        result: Math.pow(message.data.data, 2),
        workerId: worker1.id,
        processTime: Date.now() - startTime,
      }
      results1.push(result)
    })

    worker2.on<WorkTask>('heavy:task', async (message) => {
      const startTime = Date.now()
      // 模拟慢速工作节点，处理时间 300-500ms
      await delay(300 + Math.random() * 200)
      const result: TaskResult = {
        taskId: message.data.id,
        result: Math.pow(message.data.data, 2),
        workerId: worker2.id,
        processTime: Date.now() - startTime,
      }
      results2.push(result)
    })

    await Promise.all([worker1.init(), worker2.init()])

    // 发布一批任务
    const tasks = Array.from({ length: 20 }, (_, i) => ({
      id: `task-${i + 1}`,
      data: i + 1,
    }))

    console.log('Publishing tasks...')
    await Promise.all(
      tasks.map((task) =>
        publisher.emit('heavy:task', {
          mode: EventMode.ANYCAST,
          data: task,
        })
      )
    )

    // 发布者完成任务后可以关闭
    await publisher.close()
    console.log('Publisher closed')

    // 等待所有任务处理完成
    await delay(5000)

    // 验证结果
    const totalProcessed = results1.length + results2.length
    expect(totalProcessed).toBe(tasks.length)

    // 由于 worker1 处理速度更快，预期会处理更多任务
    console.log(`Worker 1 (Fast) processed ${results1.length} tasks`)
    console.log(`Worker 2 (Slow) processed ${results2.length} tasks`)

    // 快速节点应该处理更多任务，但不会处理全部任务
    expect(results1.length).toBeGreaterThan(results2.length)
    expect(results2.length).toBeGreaterThan(0)

    // 验证处理时间
    results1.forEach((result) => {
      expect(result.processTime).toBeLessThan(300) // 快速节点处理时间应小于300ms
    })

    results2.forEach((result) => {
      expect(result.processTime).toBeGreaterThan(300) // 慢速节点处理时间应大于300ms
    })

    // 验证没有任务重复处理
    const processedIds = new Set([
      ...results1.map((r) => r.taskId),
      ...results2.map((r) => r.taskId),
    ])
    expect(processedIds.size).toBe(tasks.length)

    // 输出详细的处理统计
    console.log('\nProcessing Statistics:')
    console.log('Worker 1 (Fast):')
    console.log(
      '- Average process time:',
      results1.reduce((sum, r) => sum + r.processTime, 0) / results1.length,
      'ms'
    )
    console.log('- Task count:', results1.length)

    console.log('\nWorker 2 (Slow):')
    console.log(
      '- Average process time:',
      results2.reduce((sum, r) => sum + r.processTime, 0) / results2.length,
      'ms'
    )
    console.log('- Task count:', results2.length)

    console.log(
      'Total process time:',
      results1.reduce((sum, r) => sum + r.processTime, 0) +
        results2.reduce((sum, r) => sum + r.processTime, 0),
      'ms'
    )

    await Promise.all([worker1.close(), worker2.close()])
  })
})
