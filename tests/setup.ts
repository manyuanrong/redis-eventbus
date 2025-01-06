// 设置测试环境变量
process.env.REDIS_HOST = process.env.REDIS_HOST || 'localhost'
process.env.REDIS_PASSWORD = process.env.REDIS_PASSWORD || ''

// 增加测试超时时间
jest.setTimeout(30000) 