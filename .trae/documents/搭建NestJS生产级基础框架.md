# 搭建 NestJS 生产级基础框架

## Context

当前项目只完成了 `users` / `movies` 两个模块的 `findAll` / `findById` 接口,基础设施为空白:
- [users.controller.ts](file:///c:/code/Ztest/nest-backend/src/users/users.controller.ts#L17-L31) 直接返回 `User` 实体,会把 `hashedPassword` / `currentToken` 等敏感字段泄露给前端
- [main.ts](file:///c:/code/Ztest/nest-backend/src/main.ts#L30-L33) 用 `console.log`,无结构化日志,无优雅关闭
- 没有全局异常过滤器,未捕获异常会直接吐出 NestJS 默认带堆栈的 500
- 没有统一响应格式拦截器,成功/失败响应结构不一致

本轮目标:**只搭地基**(纯中间件 / 拦截器 / 过滤器 / 日志层),不碰认证、不扩 CRUD、不引入 swagger / helmet / throttler。地基搭好后,后续每加一个业务接口都会自动享受这些能力。每一步加详尽中文注释(延续现有"对照 Java 项目"的注释风格)。

## 实现步骤(每步都带注释)

### Step 1:安装依赖

```
npm install nestjs-pino pino pino-pretty
```

- `nestjs-pino`:NestJS 集成的结构化日志框架,自动接管 HTTP 请求日志
- `pino` / `pino-pretty`:底层日志引擎 + 开发环境可读化输出

### Step 2:在实体上标注敏感字段

文件:[src/users/user.entity.ts](file:///c:/code/Ztest/nest-backend/src/users/user.entity.ts)

- 引入 `class-transformer` 的 `@Exclude`
- 给 `hashedPassword`、`currentToken`、`tokenExpiresAt` 加 `@Exclude()`
- 注释解释:配合全局 `ClassSerializerInterceptor` 使用,序列化成 JSON 时自动剔除这些字段
- `Movie` 实体无敏感字段,不动

### Step 3:新建统一响应拦截器

新文件:`src/common/interceptors/transform.interceptor.ts`

- 实现 `NestInterceptor`,把 Controller 返回值统一包成 `{ code: 0, message: 'success', data: <原返回值> }`
- 注释对照 Java 项目里常见的统一响应 `Result<T>` 类
- 错误响应不在拦截器处理(由过滤器负责)

### Step 4:新建全局异常过滤器

新文件:`src/common/filters/all-exceptions.filter.ts`

- 实现 `ExceptionFilter`
- 捕获 `HttpException`:按其 `getStatus()` 和 `getResponse()` 还原业务错误码 / 消息
- 捕获其他未知异常:统一返回 500,响应体不暴露堆栈(生产环境),但用 logger 记录完整 stack
- 注释说明对照 Java 的 `@ControllerAdvice` + `@ExceptionHandler`

### Step 5:在根模块注册 Pino

文件:[src/app.module.ts](file:///c:/code/Ztest/nest-backend/src/app.module.ts)

- imports 数组加入 `LoggerModule.forRoot(...)`,开发环境用 `pino-pretty`,生产环境纯 JSON
- 注释解释对照 Java 项目的 `logback-spring.xml`
- TypeORM 的 `logging: true` 改为 `['error', 'warn']`,并接入 pino logger(避免生产打印全量 SQL)

### Step 6:改造 main.ts

文件:[src/main.ts](file:///c:/code/Ztest/nest-backend/src/main.ts)

- 用 pino 的 logger 替代 `console.log`
- 启用 `app.useGlobalFilters(new AllExceptionsFilter())`(全局过滤器)
- 启用 `app.useGlobalInterceptors(new TransformInterceptor(), new ClassSerializerInterceptor())`(全局拦截器 + 序列化)
- `app.enableShutdownHooks()` 优雅关闭,注释解释进程收到 SIGTERM 时会先关 DB 连接再退出
- 注释逐步标注每行作用,延续对照 Java 的风格

## 关键文件清单

| 操作 | 路径 |
|---|---|
| 新增 | `src/common/interceptors/transform.interceptor.ts` |
| 新增 | `src/common/filters/all-exceptions.filter.ts` |
| 改动 | [src/users/user.entity.ts](file:///c:/code/Ztest/nest-backend/src/users/user.entity.ts) |
| 改动 | [src/app.module.ts](file:///c:/code/Ztest/nest-backend/src/app.module.ts) |
| 改动 | [src/main.ts](file:///c:/code/Ztest/nest-backend/src/main.ts) |

不动 `movies` 模块、不动 `users` 的 Controller / Service / Module 业务逻辑,只通过全局拦截器 / 过滤器起效。

## 验证方法

执行完所有改动后:

1. `npm run build` —— TS 编译通过,无类型错误
2. `npm run start` —— 启动后控制台应输出 pino 格式日志,不再有裸 `console.log`
3. `curl http://localhost:3000/api/users` —— 响应体应为 `{ code: 0, message: 'success', data: [...] }`,且数组内每个 user **不含** `hashedPassword` / `currentToken` / `tokenExpiresAt`
4. `curl http://localhost:3000/api/users/99999` —— 响应应为 404 + `{ code: 404, message: 'User #99999 not found', data: null }` 等统一错误格式
5. `curl http://localhost:3000/api/users/abc` —— ParseIntPipe 触发 400,响应体也走统一格式
6. 在 Service 里临时 `throw new Error('boom')` 触发未知异常,确认返回 500 不带堆栈,但日志里能看到完整 stack(验完回滚)

## 不在本轮范围

- 认证授权(JWT / AuthGuard)
- CRUD 写操作 + DTO
- helmet / CORS / throttler 安全中间件
- @nestjs/terminus 健康检查
- @nestjs/swagger 接口文档
- Docker / CI / 测试

这些下一轮按"业务能力 / 部署运维"分批推进。
