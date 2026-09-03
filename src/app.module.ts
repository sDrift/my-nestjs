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

@Module({
  imports: [
    // 1. 加载 .env 文件到 process.env
    // isGlobal: true 让所有模块都能用 ConfigService，不用每个模块单独 import
    ConfigModule.forRoot({ isGlobal: true }),

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
      useFactory: (cfg: ConfigService) => ({
        type: 'mysql',
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
      }),
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

    // 5. 业务模块
    UsersModule,
    MoviesModule,
  ],

  // providers 里挂一个 APP_GUARD = ThrottlerGuard，意思是"给所有 Controller 自动套上限流守卫"
  // 对照 Java：类似 WebSecurityConfig 配 filter 在每个请求前拦截
  // 机制：APP_GUARD 是 NestJS 的特殊 token，挂它后框架会对每个路由自动跑 ThrottlerGuard，
  //   Guard 在路由匹配后、Controller 方法执行前介入，检查该 IP 在 ttl 窗口内请求数，
  //   超限就 throw ThrottlerException(429)，没超就放行到 Controller
  // 前端(Vue3)理解：像全局 router.beforeEach((to, from, next) => ...)，每个路由跳转前都走一遍；
  //   这里是每个 HTTP 请求到达 Controller 前都先过这个守卫
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
