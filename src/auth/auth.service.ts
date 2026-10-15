// 认证服务
// 核心三件事：
//   1) login(username, password)：按 username 找用户 → bcrypt.compare(明文密码, hashedPassword) → 过了生成 32 字节随机 token →
//      update user.currentToken + tokenExpiresAt(=now+7d) → 返回 {token, expiresAt}
//   2) logout(userId)：把 user 的 currentToken/tokenExpiresAt 置空（强制当前 token 失效）
//   3) getUserByToken(token)：AuthGuard 调它——按 token 查用户，且 tokenExpiresAt > now，未软删除；查不到返回 null
// 对照 Java：AuthService + TokenService（含 generateToken / validateToken）
// 前端(Vue3)理解：类似前端 Pinia 里的 useAuthStore().login() 调接口拿 token 存 localStorage，
//   这里后端的 login 是真正"算 token + 写进 DB"的地方；logout 就是把 token 标成无效（服务端可主动失效，不像 JWT 只能等过期）
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { User } from '../users/user.entity.js';
import { LoginDto } from './dto/login.dto.js';

// Token 有效期：7 天（604800 秒）
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    // 注入 User Repository，读 user.entity 的 @Entity / @Column 元数据知道 "id 对应 id 列"等
    // 前端(Vue3)理解：像 provide('repo:user', ...) 提供的实例，这里 inject 进来用
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  /**
   * 登录：账号密码比对 → 生成 token → 写回 user.currentToken/tokenExpiresAt
   * 失败抛 UnauthorizedException (401)
   */
  async login(dto: LoginDto): Promise<{ token: string; expiresAt: Date }> {
    // 1) 按 username 查用户（deletedAt 是 @DeleteDateColumn，已软删除的会被自动过滤掉）
    const user = await this.repo.findOne({
      where: { username: dto.username },
    });
    if (!user) {
      // 用户名/密码错误统一报"用户名或密码错误"，不暴露"用户是否存在"防枚举攻击
      // 对照 Java Spring Security 统一返回 BadCredentialsException
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 2) bcrypt.compare(明文密码, hashedPassword) 对比哈希
    // bcrypt 把 "salt" 存进了 hashedPassword 字符串内（格式 $2a$10$...），
    //   所以 compare 不需要额外 salt 参数，自己从字符串里拆
    // 前端(Vue3)理解：不要自己写 === / hash('md5') 比对；bcrypt 是专门做密码哈希的算法，
    //   慢、加盐、防彩虹表；类似前端别用 eval/new Function 一样，有专用工具用专用工具
    const ok = await bcrypt.compare(dto.password, user.hashedPassword);
    if (!ok) {
      throw new UnauthorizedException('用户名或密码错误');
    }

    // 3) 生成随机 32 字节 hex token（64 位字符串，熵足够长不会被撞）
    // 为什么不用 UUID：token 是 secret，长度越大熵越高，randomBytes(32) 256 位熵比 UUID 的 122 位安全
    // 对照 Java：SecureRandom.getInstanceStrong().generateSeed(32)
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    // 4) 写回 DB：只更新 currentToken / tokenExpiresAt，不碰其他列
    await this.repo.update(user.id, {
      currentToken: token,
      tokenExpiresAt: expiresAt,
    });

    return { token, expiresAt };
  }

  /**
   * 登出：把 user 的 currentToken/tokenExpiresAt 清空，当前 token 立即失效
   * 因为 token 是存在表里的（不像 JWT 是签了名不可撤销的字符串），
   *   登出/改密码可以直接让 token 失效，这是自研 token 相对 JWT 的核心优势
   */
  async logout(userId: number): Promise<void> {
    await this.repo.update(userId, {
      currentToken: null as any,
      tokenExpiresAt: null as any,
    });
  }

  /**
   * 校验 token：AuthGuard 调用，按 token 查用户 + token 未过期（已软删除的由 @DeleteDateColumn 自动过滤）
   * 命中 → 返回 User；否则 null（AuthGuard 会据此抛 401）
   * MoreThan(new Date()) 等价于 SQL: token_expires_at > NOW()
   */
  async getUserByToken(token: string): Promise<User | null> {
    return this.repo.findOne({
      where: {
        currentToken: token,
        tokenExpiresAt: MoreThan(new Date()),
      },
    });
  }
}
