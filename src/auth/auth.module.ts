// Auth 模块
// imports: TypeOrmModule.forFeature([User]) 让 AuthService 可以 @InjectRepository(User) 注入
// providers: AuthService 提供给本模块 Controller 用；也 exports 给 AuthGuard 用（AuthGuard 在 AppModule 的 APP_GUARD 注入，需要 AuthService 可得）
// controllers: AuthController —— POST /api/auth/login, POST /api/auth/logout, GET /api/auth/me
// exports: AuthService —— AuthGuard 在 AppModule 层注册（能跨模块拿到 AuthService）
//
// 对照 Java：@Configuration + @Bean AuthService / AuthController 的配置类
// 前端(Vue3)理解：像把认证这一块的 store + 路由 + 组件 封装成一个插件 install(app)，
//   你在 app.use(AuthPlugin) 后全局就有登录能力；这里 imports AuthModule 后应用就有认证接口
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [AuthService],
  controllers: [AuthController],
  // 关键：AuthGuard 在 AppModule 的 providers 里以 APP_GUARD 形式挂，它运行时需要 AuthService，
  //   所以 AuthService 必须 exports 出去，跨模块才能注入
  exports: [AuthService],
})
export class AuthModule {}
