// 认证接口 Controller
//   POST /api/auth/login  @Public  —— 账号密码登录，拿 token
//   POST /api/auth/logout          —— 拿当前登录用户 id 让 token 失效
// 对照 Java：AuthController /api/auth/* 登录相关
// 前端(Vue3)理解：像 axios.post('/api/auth/login', { username, password })
//   返回 { token, expiresAt } 存进 localStorage / Pinia store；后续所有请求带
//   Authorization: Bearer <token>
import { Body, Controller, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { Public } from '../decorators/public.decorator.js';
import { User } from '../users/user.entity.js';

// 扩展 Express 的 Request 类型：AuthGuard 把查到的 User 挂到 req.user 上，
// 后面其他 Controller 也能从 @Req() 直接取到登录用户（类型安全，不再是 any）
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // 登录接口必须 @Public，否则会被 AuthGuard 拦住
  //   —— 你没登录就没 token，没 token 过不了全局鉴权，就调不到登录接口，死循环了
  @Public()
  @Post('login')
  @ApiOperation({ summary: '账号密码登录，返回 { token, expiresAt }' })
  @ApiBody({ type: LoginDto })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  // 登出：需要 token 才能登（谁登出登谁），不是 @Public
  //   从 req.user.id 拿到用户 id，调用 AuthService.logout 清空 token
  @Post('logout')
  @ApiBearerAuth()
  @ApiOperation({ summary: '登出当前账号（让当前 token 立即失效）' })
  async logout(@Req() req: Request) {
    if (!req.user) throw new UnauthorizedException('未登录');
    await this.auth.logout(req.user.id);
    return { message: 'ok' };
  }

  // 取当前登录用户信息：前端可以调用这个检查自己是不是登录状态
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: '取当前登录用户信息（不带敏感字段）' })
  me(@Req() req: Request): User {
    if (!req.user) throw new UnauthorizedException('未登录');
    // req.user 是 AuthGuard 挂上去的 User 实体，@Exclude 已生效，
    //   通过 TransformInterceptor 序列化时自动剔除 hashedPassword/currentToken/tokenExpiresAt
    return req.user;
  }
}
