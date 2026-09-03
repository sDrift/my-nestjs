// 健康检查 Controller
// 暴露 GET /api/health，用于 K8s liveness/readiness 探针、负载均衡健康检查
// 对照 Java 项目里 Spring Boot Actuator 的 /actuator/health 端点
//
// 设计要点：
//   - 不依赖任何业务模块，独立挂在 /api/health
//   - 不仅返回 200 OK，还会实际 ping 数据库确认连通性
//   - 用 @nestjs/terminus 提供的 HealthCheckService 编排多个 indicator
//
// 前端(Vue3)理解：你部署前端时 nginx 也会有个 /health 路径给 LB 探活；
//   这里给后端也补一个，让运维知道"应用是否真的活着 + 依赖是否就绪"。
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

@ApiTags('health') // Swagger 文档分组标签：让 /api/health 归在 health 分组下
@Controller('health')
export class HealthController {
  // 构造器注入两个 terminus 服务：
  //   - HealthCheckService：编排器，跑一组 indicator 汇总成 { status, info, error, details }
  //   - TypeOrmHealthIndicator：DB 探活器，内部用 TypeORM 跑一个 SELECT 1 验证连接
  // 前端(Vue3)理解：像组合式 API 里 const http = useHttp(); const db = useDb()，
  //   把能力注入进来，方法里调用
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  // @HealthCheck() 装饰器：terminus 自动捕获抛出的异常转成 503 + unhealthy，
  //   不让它走全局 AllExceptionsFilter（避免健康检查失败返回 500）
  // @ApiOperation 给 swagger 文档显示一行描述
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: '健康检查（含 DB 连通性）' })
  check() {
    // health.check 接受一个 indicator 函数数组，逐个执行，并行 Promise.all
    // 返回结构：{ status: 'ok'|'error', info: {...}, error: {...}, details: {...} }
    //   status=ok 时 HTTP 200，status=error 时 terminus 自动返回 503
    // 这里只挂了 DB 一个 indicator；以后加 Redis/MQ 直接 push 进数组即可
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 1000 }),
    ]);
  }
}
