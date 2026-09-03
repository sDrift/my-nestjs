// 应用启动入口
// 对照 Java 项目: src/main/java/com/example/test1backend/Test1BackendApplication.java 的 main 方法
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import type { Request, Response, NextFunction } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';

async function bootstrap() {
  // NestFactory.create(AppModule) 等价于 SpringApplication.run(Test1BackendApplication.class, args)
  // 启动一个 NestJS 应用，初始化 IoC 容器、加载所有 Module
  // bufferLogs: true 让 NestJS 在 pino 接管前的早期日志也走 pino 输出，避免混用 console
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // 用 pino 作为全局 Logger：此后 NestFactory 内部启动日志、DI 容器日志都会走 pino
  // 对照 Java 项目里 Spring Boot 默认使用 Logback 输出启动 banner 和容器日志
  // 前端(Vue3)理解：类似 main.ts 里 app.use(/* 插件 */) 之后，
  //   框架内部的所有后续日志(路由注册、组件挂载)都走这个新通道，不再用 console
  app.useLogger(app.get(Logger));

  // ─────── 安全中间件 ───────

  // helmet：给每个响应自动加一组安全 HTTP 头
  //   - Strict-Transport-Security: 强制 HTTPS（防中间人降级）
  //   - X-Content-Type-Options: nosniff（防 MIME 嗅探）
  //   - X-Frame-Options: DENY（防点击劫持 iframe 嵌入）
  //   - Content-Security-Policy: 限制脚本来源（防 XSS 注入）
  // 对照 Java 的 Spring Security 默认加的 Security Headers
  // 前端(Vue3)理解：像 Vite 配置里 csp 头、<meta http-equiv> 标签，但服务端统一加，
  //   你前端什么都不用做就自动带上这些头
  //
  // 例外：Swagger UI 用了 inline 脚本/样式，会被默认 CSP 拦死（页面空白或样式加载不出）
  //   所以对 /api/docs* 路径跳过 helmet，业务接口仍受保护
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api/docs')) {
      return next();
    }
    return helmet()(req, res, next);
  });

  // CORS：跨域资源共享，决定"哪些前端域名能调这个 API"
  //   - 浏览器有同源策略：前端在 https://a.com 调 https://b.com/api 会被拦
  //   - 服务端在响应头加 Access-Control-Allow-Origin: <允许的源> 才能放行
  // 策略：从 .env 读 CORS_ORIGINS（逗号分隔），为空时开发环境放行所有，生产必须配白名单
  // 对照 Java 的 @CrossOrigin / WebMvcConfigurer.addCorsMappings
  // 前端(Vue3)理解：你前端调后端遇到的 CORS 报错，就是这个开关没开/白名单不含你域名
  //   开发时 Vite proxy 能绕过，但生产部署后端必须自己配 CORS 才行
  const cfg = app.get(ConfigService);
  const rawOrigins = cfg.get<string>('CORS_ORIGINS') ?? '';
  const allowedOrigins = rawOrigins
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    // origin 为函数：每个请求动态判断该不该允许
    //   收到请求时 Express 拿 origin 头(发起方域名)问"这个域名能放行吗？"
    origin: (origin, callback) => {
      // !origin 表示同源请求或非浏览器请求(curl/Postman)，直接放行
      if (!origin) return callback(null, true);
      // 白名单为空时全放行（仅适合开发；生产为空会变成"任何网站都能调"，不安全）
      if (allowedOrigins.length === 0) return callback(null, true);
      // 在白名单里就放行，否则拒绝（callback 第一个参数为 Error 会被 Express 拒绝）
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`CORS blocked origin: ${origin}`));
    },
    credentials: true, // 允许前端带 Cookie（登录场景必备，对照 Java allowCredentials=true）
  });

  // ─────── 业务层（路由前缀 / 校验 / 拦截器 / 过滤器 / 关闭钩子） ───────

  // 设置全局路由前缀 /api
  // 对照 Java 项目 application.properties 里的 server.servlet.context-path=/test1
  // 但 NestJS 没有 context-path 概念，用全局前缀替代
  // 最终路径：http://localhost:3000/api/users  (Java 版是 http://localhost:8080/test1/api/users)
  app.setGlobalPrefix('api');

  // 全局 DTO 校验管道（对照 Java 的 @Valid + spring-boot-starter-validation）
  app.useGlobalPipes(new ValidationPipe({
    transform: true,              // 自动把 query/param 字符串转成声明类型
    whitelist: true,               // 自动剥离 DTO 上未声明的多余字段
    forbidNonWhitelisted: false,   // 不抛错，只剥离
  }));

  // 全局拦截器：注意执行顺序——写在前的先进入、后离开（洋葱模型）
  // 1. ClassSerializerInterceptor：NestJS 内置，依据 class-transformer 装饰器（@Exclude 等）
  //    在序列化成 JSON 前剔除敏感字段。对照 Java 里 Jackson 的 @JsonIgnore
  // 2. TransformInterceptor：自定义，把 Controller 返回值统一包成 { code, message, data }
  //    对照 Java 项目里 Result<T> 包装返回值
  // 前端(Vue3)理解：类似在 main.ts 里注册全局指令 app.directive(...) 或全局 $attrs，
  //    所有组件都不用单独 import 就自动生效；这里所有 Controller 都不用单独 import 拦截器
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get('Reflector')),
    new TransformInterceptor(),
  );

  // 全局异常过滤器：捕获所有抛出的异常，统一包装成 { code, message, data: null }
  // 对照 Java 的 @ControllerAdvice + @ExceptionHandler
  // 前端(Vue3)理解：对应 Vue3 的 app.config.errorHandler，一个地方兜底所有未捕获错误
  app.useGlobalFilters(new AllExceptionsFilter());

  // 优雅关闭：进程收到 SIGTERM（K8s 滚动更新）/ SIGINT（Ctrl+C）时，
  // NestJS 会先关闭 HTTP 服务、断开 TypeORM 数据库连接，再退出进程
  // 对照 Spring Boot 的 spring.lifecycle.timeout-per-shutdown-phase + ServerShutdown
  // 前端(Vue3)理解：类似 Vite/SSR 项目里监听 process.on('SIGTERM') 关闭 dev server，
  //    先把 in-flight 请求处理完、关掉数据库连接池，再退出，避免半截请求出错
  app.enableShutdownHooks();

  // ─────── Swagger 接口文档 ───────

  // 自动扫描所有 @ApiTags / @Get / @Post 等装饰器，生成 OpenAPI 规范 + 交互式文档页
  //   访问 http://localhost:3000/api/docs 就能在浏览器看所有接口、参数、在线试调
  // 对照 Java 项目的 springdoc-openapi（生成 /swagger-ui.html）
  // 前端(Vue3)理解：你后端不用再手写接口文档了，框架扫装饰器自动生成网页版 API 列表，
  //   类似前端 vue-router 的 routes 数组被 devtools 渲染成可点页面，但这里是 HTTP 接口
  // 注意：swagger 文档路径 /api/docs 不受全局前缀影响，要单独写
  const swaggerConfig = new DocumentBuilder()
    .setTitle('NestJS Backend API')
    .setDescription('对照 Java test1-backend 改写的 NestJS 项目接口文档')
    .setVersion('0.0.1')
    // .addBearerAuth() // 等下一轮加认证时再开
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument);

  // ─────── 启动监听 ───────

  // 启动 HTTP 服务，端口从 .env 的 PORT 读，默认 3000
  // 对照 Java 的 server.port=8080
  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  // 这里不再用 console.log，统一走 pino Logger（保持日志格式一致、可被采集）
  app.get(Logger).log(
    `NestJS app running on http://localhost:${port}/api  (Java 版: http://localhost:8080/test1/api)`,
  );
  app.get(Logger).log(`Swagger docs on http://localhost:${port}/api/docs`);
}

// 顶层 await（ESM 模块的特性，Node 14+ 支持）
await bootstrap();
