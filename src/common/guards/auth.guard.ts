// 全局鉴权守卫（AuthGuard）
// 每个请求到达 Controller 前都先走这里（APP_GUARD 全局挂载时）
// 流程：
//   1) Reflector 看当前路由/Controller 有没有 @Public()，有就直接放行
//   2) 读 req.headers.authorization：要求格式 "Bearer <token>"
//   3) AuthService.getUserByToken(token) → 查 DB 有匹配 user 且 token 未过期 → 挂 req.user → 放行
//   4) 其他情况 → 401 Unauthorized
// 对照 Java：Spring Security 的 BasicAuthenticationFilter / JwtAuthenticationFilter
//   在 SecurityFilterChain 里注册后，每个请求都先走一次
// 前端(Vue3)理解：像全局 router.beforeEach((to, from, next) => {
//   if (to.meta.requiresAuth && !localStorage.getItem('token')) next('/login');
//   else next();
// })
// 只是它在后端执行，且不是看 localStorage(前端才有)，是看请求头里的 Bearer token 真去 DB 查
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthService } from '../../auth/auth.service.js';
import { IS_PUBLIC_KEY } from '../../decorators/public.decorator.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    // reflector：读 @Public() 这种 SetMetadata 贴的元数据
    //   getAllAndOverride 先看方法上贴没贴，再看 Controller 类上贴没贴，任一个有 isPublic=true 就放行
    private readonly reflector: Reflector,
    // AuthService：按 token 查 user
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 1) @Public 跳过
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),        // 方法级
      context.getClass(),         // 类级
    ]);
    if (isPublic) return true;

    // 2) 取 token：Authorization: Bearer <token>
    const req = context.switchToHttp().getRequest() as Request;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少 Bearer token');
    }
    const token = authHeader.slice(7); // 去掉 'Bearer ' 前缀，7 字符 = "Bearer ".length
    if (!token) {
      throw new UnauthorizedException('token 为空');
    }

    // 3) 查 DB：token 匹配 + 未过期 + 未软删除
    const user = await this.auth.getUserByToken(token);
    if (!user) {
      throw new UnauthorizedException('token 无效或已过期');
    }

    // 4) 把 user 挂到 req 上，Controller 里 @Req() req.user 就能拿到
    req.user = user;
    return true;
  }
}
