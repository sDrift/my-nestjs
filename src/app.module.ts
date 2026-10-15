// 根模块（AppModule）
// 对照 Java 项目: src/main/java/com/example/test1backend/Test1BackendApplication.java
// 这里负责：注册 Logger、TypeORM、限流、加载 .env 配置、引入 Users/Movies 子模块
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { UsersModule } from './users/users.module.js';
import { MoviesModule } from './movies/movies.module.js';
import { HealthModule } from './health/health.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuthGuard } from './common/guards/auth.guard.js';
import { validateEnv } from './config/env.validation.js';

@Module({
  imports: [
    // 1. 加载 .env 文件到 process.env，并在启动时校验环境变量
    // isGlobal: true 让所有模块都能用 ConfigService，不用每个模块单独 import
    // validate: validateEnv —— 启动即校验（缺 DB_HOST 这类必填项直接启动失败），
    //   属于"配置分层 + 快速失败"的一部分：宁可起不来，也不要带病上线
    // 对照 Java：相当于 @ConfigurationProperties 上的 @Validated + 自定义校验器
    // 前端(Vue3)理解：像 main.ts 里 app.mount 前先 assert 关键环境变量，
    //   配错就在启动日志里一眼看到，而不是运行到某个页面才白屏
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),

    // 2. 注册 Pino 结构化日志
    // 对照 Java 项目的 logback-spring.xml：开发环境按人读格式输出，生产环境输出纯 JSON
    // nestjs-pino 还会自动接管每个 HTTP 请求的访问日志（req.method + req.url + 耗时 + 状态码）
    // 前端(Vue3)理解：类似在 main.ts 里 app.use(/* 某个全局插件 */)，
    //   app.use(createPinia()) 装上后所有组件都能用 useXxxStore()，
    //   这里 LoggerModule.forRootAsync 装上后，所有 Service 都能注入 Logger，
    //   不再需要每个文件手动 new Logger()
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const isProd = cfg.get<string>('NODE_ENV') === 'production';
        return {
          // pinoHttp：传给 pino-http 的配置项（nestjs-pino 会用它接管每条 HTTP 请求日志）
          // 同时也是应用日志（Logger.log/.error）的底层配置
          pinoHttp: {
            level: isProd ? 'info' : 'debug',   // 生产只记 info 及以上，开发可记 debug
            transport: isProd
              ? undefined    // 生产环境不装 pino-pretty，直接输出 JSON（性能更好、便于日志系统采集）
              : {            // 开发环境用 pino-pretty 把 JSON 美化成多行带颜色输出
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    translateTime: 'yyyy-mm-dd HH:MM:ss.l',
                    ignore: 'pid,hostname',
                  },
                },
          },
        };
      },
    }),

    // 3. 注册 TypeORM（异步方式，因为要等 ConfigModule 加载 .env）
    // 对照 Java 项目 application.properties 里的 spring.datasource.* 配置
    // 为什么用 forRootAsync 而不是同步版 forRoot：DB 连接需要 host/端口/密码这些值，
    //   而它们在 .env 里，必须等 ConfigModule.forRoot 先跑完把它们读到 process.env，
    //   才能拿来建连接。同步版 forRoot 要求写代码时就把配置写死，没法读 .env。
    //   执行顺序：ConfigModule 先跑 → inject: [ConfigService] 拿到 ConfigService
    //   → useFactory(cfg) 被调 → cfg.get('DB_HOST') 读到值 → 返回配置 → TypeORM 建池。
    // 前端(Vue3)理解：像 Pinia 的 setup store 必须等 props 传进来才能 init 数据，
    //   这里 useFactory 就是个"等依赖就绪再跑"的工厂函数。
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        // 先判断运行环境：生产环境用更大的连接池 + 更严格的超时
        // 对照 Java：application-prod.properties 与 application-dev.properties 分开配
        const isProd = cfg.get<string>('NODE_ENV') === 'production';
        return {
          type: 'mysql' as const,
          host: cfg.get<string>('DB_HOST'),
          port: cfg.get<number>('DB_PORT'),
          username: cfg.get<string>('DB_USER'),
          password: cfg.get<string>('DB_PASSWORD'),
          database: cfg.get<string>('DB_NAME'),
          autoLoadEntities: true,   // 自动加载每个 Module.forFeature() 注册的实体
          synchronize: false,        // 不自动改表结构（生产环境务必 false）
          // 生产环境不要打印全量 SQL（对照 MyBatis 在生产把 log-impl 关掉）
          // 只在出错和警告时打印；开发环境仍是 ['error', 'warn', 'query']，便于调试
          // 前端(Vue3)理解：类似 Vite 在生产 build 时关掉 sourcemap、关掉 HMR 详细日志，
          //   只保留 error 级别；开发时看详细日志方便定位，生产时只看告警避免日志爆炸
          logging: ['error', 'warn'],
          timezone: '+08:00',        // 时区，对照 Java URL 里的 serverTimezone=Asia/Shanghai

          // ── 生产可用性参数（连接池 / 超时 / 重试）──
          // 对照 Java：HikariCP 的 maximumPoolSize / connectionTimeout / initializationFailTimeout
          //   生产必须限制连接池上限，否则流量一大就把 MySQL 的连接数打满，
          //   拖垮同实例上的其它服务（"一个服务雪崩拖死整个库"）。
          // 前端(Vue3)理解：像 axios 实例设 timeout + 重试；这里管的是"后端到数据库"这条链路，
          //   池子满了会让请求排队（waitForConnections），而不是直接抛错。
          extra: {
            connectionLimit: isProd ? 20 : 10, // 连接池上限：生产 20，开发 10
            waitForConnections: true,          // 池满时新请求排队等待（而不是立即失败）
            queueLimit: 0,                     // 排队长度不限（0 = 无限）
            connectTimeout: 10_000,            // 建连超时 10s，避免网络抖动时一直挂住
            enableKeepAlive: true,             // 开启 TCP keep-alive，防中间设备把空闲连接掐掉
            keepAliveInitialDelay: 10_000,     // keep-alive 探测包首次发送延迟
          },
          retryAttempts: isProd ? 10 : 3, // 启动时数据库连不上，重试次数（生产更宽容，等 DB 起来）
          retryDelay: 3_000,              // 每次重试间隔 3s
        };
      },
    }),

    // 4. 注册限流 ThrottlerModule
    // 对照 Java 项目的 bucket4j / Spring Security rate limiter
    // 作用：限制同一 IP 单位时间内的请求数，防爬虫/暴力刷接口/CC 攻击
    //   ttl: 时间窗口（毫秒），limit: 该窗口内允许的最大请求数
    //   默认每个 IP 60 秒内最多 100 次，超了直接返回 429 Too Many Requests
    // 前端(Vue3)理解：你 axios 撞 429 时通常要写"指数退避重试"，就是这个限流触发的；
    //   类似前端用 lodash 的 _.throttle 限制按钮点击频率，只不过这里是服务端按 IP 限
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 100 },
    ]),

    // 5. 业务模块 + 健康检查 + 认证
    UsersModule,
    MoviesModule,
    HealthModule,
    AuthModule,
  ],

  // APP_GUARD：挂在这的守卫会被 NestJS 应用到**所有** Controller 的**所有**路由
  // 执行顺序：先 ThrottlerGuard（限流），再 AuthGuard（鉴权）
  //   NestJS 保证顺序按 providers 数组里写的先后
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // 鉴权：读 Authorization Bearer → 查 user 表 → @Public() 跳过
    // 对照 Java：Spring Security SecurityFilterChain 上注册的 authentication filter
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
