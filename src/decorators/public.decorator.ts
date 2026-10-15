// @Public() 装饰器：标记"该 Controller 或方法不需要鉴权"
//
// 机制：用 SetMetadata 把 'isPublic'=true 元数据贴到类/方法上，
//   AuthGuard 里 reflector.getAllAndOverride('isPublic', [handler, controller])
//   读到 true 就跳过 Bearer token 校验，直接放行
// 对照 Java：对应 Spring Security 的 @PermitAll
// 前端(Vue3)理解：像路由 meta: { requiresAuth: false }
//   router.beforeEach 里看这个 meta 决定要不要跳登录页；这里 AuthGuard 读 isPublic 决定要不要验 token
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
