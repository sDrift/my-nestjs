// Users API 端到端测试（e2e）
//
// 原注释：无（本项目生产化改造新增的测试层）
// 对照 Java：等价于 @SpringBootTest(webEnvironment = RANDOM_PORT) + MockMvc/RestAssured
// 前端(Vue3)理解：等价于用 Playwright/Cypress 打真实 HTTP 接口——
//   只不过这里没起真浏览器、也没连真数据库，而是把 Service 层换成 mock，
//   完整跑一遍"HTTP 请求 → 路由 → 守卫 → 校验管道 → 拦截器/过滤器 → HTTP 响应"这条链路。
//   目的：验证接口契约（状态码、响应信封结构、鉴权行为）是对的。
//
// 为什么不用真 AppModule + 真数据库：
//   e2e 要能在 CI 上无依赖跑通。这里只装配 UsersController + 一个假 Service，
//   既验证了 HTTP 层，又不需要 MySQL 在场（真正的连接测试交给部署后的健康检查）。
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  ClassSerializerInterceptor,
  NotFoundException,
} from '@nestjs/common';
import { Reflector, APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { UsersController } from '../src/users/users.controller.js';
import { UsersService } from '../src/users/users.service.js';
import { User } from '../src/users/user.entity.js';
import { AuthGuard } from '../src/common/guards/auth.guard.js';
import { AuthService } from '../src/auth/auth.service.js';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';

// 假的 Service 层：让 e2e 不依赖数据库
const mockUsersService = {
  findAll: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
};

// 假的 AuthService：AuthGuard 会调它按 token 查用户，这里用 mock 编排返回值
const mockAuthService = {
  getUserByToken: vi.fn(),
};

function makeUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 1;
  user.username = 'alice';
  user.email = 'alice@example.com';
  user.hashedPassword = '$2a$10$abcdefghijklmnopqrstuv';
  user.role = 'user';
  user.isActive = true;
  user.createdAt = new Date('2026-01-01T00:00:00Z');
  user.deletedAt = null;
  user.currentToken = null as any;
  user.tokenExpiresAt = null as any;
  Object.assign(user, overrides);
  return user;
}

describe('Users API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: AuthService, useValue: mockAuthService },
        // 和 src/app.module.ts 一样，用 APP_GUARD 全局挂 AuthGuard，
        // 这样"哪些接口需要 token、哪些 @Public 放行"的行为能在这里被真实验证
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();

    app = moduleRef.createNestApplication();

    // ⚠️ 这里刻意复刻 src/main.ts 的全局配置，保证 e2e 与"真实运行时"行为一致：
    //   少了任何一项，测出来的就不是生产行为
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    app.useGlobalInterceptors(
      new ClassSerializerInterceptor(app.get(Reflector)),
      new TransformInterceptor(),
    );
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ───────── 读接口（@Public，免 token）─────────

  it('GET /api/users：返回统一信封 { code, message, data }，且不泄露敏感字段', async () => {
    mockUsersService.findAll.mockResolvedValue([makeUser()]);

    const res = await request(app.getHttpServer()).get('/api/users').expect(200);

    expect(res.body.code).toBe(0);
    expect(res.body.message).toBe('success');
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].username).toBe('alice');
    // ClassSerializerInterceptor 应把 @Exclude 字段剔除
    expect(res.body.data[0].hashedPassword).toBeUndefined();
    expect(res.body.data[0].currentToken).toBeUndefined();
    expect(res.body.data[0].tokenExpiresAt).toBeUndefined();
  });

  it('GET /api/users/:id：查不到 → 404，data 为 null', async () => {
    mockUsersService.findById.mockResolvedValue(null);

    const res = await request(app.getHttpServer())
      .get('/api/users/999')
      .expect(404);

    expect(res.body.code).toBe(404);
    expect(res.body.data).toBeNull();
    expect(res.body.message).toContain('not found');
  });

  it('GET /api/users/:id：id 非数字 → ParseIntPipe 返回 400', async () => {
    await request(app.getHttpServer()).get('/api/users/abc').expect(400);
  });

  // ───────── 写接口（需要 token）─────────

  it('POST /api/users：请求体不合法 → 400，不进入 Service', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/users')
      .send({ username: 'x' }) // 缺 password，且 username 少于 2 位
      .expect(400);

    expect(res.body.code).toBe(400);
    expect(res.body.data).toBeNull();
    expect(mockUsersService.create).not.toHaveBeenCalled();
  });

  it('POST /api/users：合法请求体 → 201 + 统一信封', async () => {
    mockUsersService.create.mockResolvedValue(makeUser({ id: 2, username: 'bob' }));

    const res = await request(app.getHttpServer())
      .post('/api/users')
      .send({ username: 'bob', password: '123456' })
      .expect(201);

    expect(res.body.code).toBe(0);
    expect(res.body.data.username).toBe('bob');
  });

  it('PATCH /api/users/:id：未带 token → 401（被 AuthGuard 拦下）', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/users/1')
      .send({ email: 'new@example.com' })
      .expect(401);

    expect(res.body.code).toBe(401);
    expect(mockUsersService.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/users/:id：token 无效/过期 → 401', async () => {
    mockAuthService.getUserByToken.mockResolvedValue(null);

    await request(app.getHttpServer())
      .patch('/api/users/1')
      .set('Authorization', 'Bearer bad-token')
      .send({ email: 'new@example.com' })
      .expect(401);

    expect(mockUsersService.update).not.toHaveBeenCalled();
  });

  it('PATCH /api/users/:id：token 有效 → 200，Service 收到 id + DTO', async () => {
    mockAuthService.getUserByToken.mockResolvedValue(makeUser());
    mockUsersService.update.mockResolvedValue(makeUser({ email: 'new@example.com' }));

    const res = await request(app.getHttpServer())
      .patch('/api/users/1')
      .set('Authorization', 'Bearer good-token')
      .send({ email: 'new@example.com' })
      .expect(200);

    expect(res.body.code).toBe(0);
    expect(mockUsersService.update).toHaveBeenCalledWith(1, {
      email: 'new@example.com',
    });
  });

  it('DELETE /api/users/:id：token 有效 → 204 No Content，无响应体', async () => {
    mockAuthService.getUserByToken.mockResolvedValue(makeUser());
    mockUsersService.remove.mockResolvedValue(undefined);

    const res = await request(app.getHttpServer())
      .delete('/api/users/1')
      .set('Authorization', 'Bearer good-token')
      .expect(204);

    expect(res.text).toBe('');
    expect(mockUsersService.remove).toHaveBeenCalledWith(1);
  });

  it('DELETE /api/users/:id：目标不存在 → 404', async () => {
    mockAuthService.getUserByToken.mockResolvedValue(makeUser());
    mockUsersService.remove.mockRejectedValue(
      new NotFoundException('User #9 not found'),
    );

    await request(app.getHttpServer())
      .delete('/api/users/9')
      .set('Authorization', 'Bearer good-token')
      .expect(404);
  });
});
