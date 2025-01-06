import Redis from 'ioredis'

export const delay = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms))

export const cleanupRedis = async () => {
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    password: process.env.REDIS_PASSWORD,
    port: 6379,
  })
  await redis.flushall()
  await redis.quit()
}
