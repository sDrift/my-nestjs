// 健康检查模块
// 对照 Java 项目的 actuator 依赖，作为独立功能挂到主应用
//
// 机制：TerminusModule 提供了 HealthCheckService / TypeOrmHealthIndicator 这些 provider，
//   这里 imports 进来后，HealthController 才能构造器注入它们
// 前端(Vue3)理解：像把一个全局能力装到 app 上，组件就能 useXxx 拿到；
//   这里 TerminusModule 是"提供探活能力"的开关，装上后 Controller 才能注入探活服务
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
