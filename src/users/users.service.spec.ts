// UsersService 单元测试
//
// 原注释：无（本项目生产化改造新增的测试层）
// 对照 Java：等价于 JUnit + Mockito 的 Service 层单测（@Mock UserRepository）
// 前端(Vue3)理解：等价于用 Vitest 给一个 useUsers() composable 写单测——
//   把里面依赖的 fetch/axios 换成 mock（vi.fn()），只测"业务逻辑对不对"，
//   不碰真实数据库、不发真实请求，所以又快又稳。
//
// 套路说明：
//   1) 用 @nestjs/testing 的 Test.createTestingModule 造一个"迷你 IoC 容器"
//   2) 用 { provide: getRepositoryToken(User), useValue: mockRepo } 把真的 Repository 换成假的
//      —— getRepositoryToken(User) 就是 Service 里 @InjectRepository(User) 用的那个 token
//   3) 容器 compile 后 get(UsersService) 拿到"注入了假 Repository"的 Service
//   4) 每个用例用 vi.fn().mockResolvedValue(...) 编排假数据的返回值，断言业务行为
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { UsersService } from './users.service.js';
import { User } from './user.entity.js';

// 假 Repository：只放被测代码会用到的方法，全部是 vi.fn()（可任意编排返回值/断言调用）
type MockRepo = {
  find: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  softDelete: ReturnType<typeof vi.fn>;
};

// 造一个 User 实例的工厂函数：省得每个用例重复写一堆属性赋值
function makeUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 1;
  user.username = 'alice';
  user.email = 'alice@example.com';
  user.hashedPassword = '$2a$10$abcdefghijklmnopqrstuv'; // 假的哈希串
  user.role = 'user';
  user.isActive = true;
  user.createdAt = new Date('2026-01-01T00:00:00Z');
  user.deletedAt = null;
  user.currentToken = null as any;
  user.tokenExpiresAt = null as any;
  Object.assign(user, overrides);
  return user;
}

describe('UsersService', () => {
  let service: UsersService;
  let repo: MockRepo;

  beforeEach(async () => {
    // 每个用例前重建假 Repository，避免用例之间互相污染
    repo = {
      find: vi.fn(),
      findOne: vi.fn(),
      save: vi.fn(),
      softDelete: vi.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        // 关键：把真 Repository 替换成 mock。
        // getRepositoryToken(User) 必须与 Service 里 @InjectRepository(User) 一致，否则注入不上
        { provide: getRepositoryToken(User), useValue: repo },
      ],
    }).compile();

    service = moduleRef.get(UsersService);
  });

  // ───────── 读 ─────────

  it('findAll：返回 Repository 查询结果，且按 id 升序', async () => {
    const users = [makeUser({ id: 1 }), makeUser({ id: 2, username: 'bob' })];
    repo.find.mockResolvedValue(users);

    await expect(service.findAll()).resolves.toEqual(users);
    // 断言传给 Repository 的查询参数正确（软删除过滤由 @DeleteDateColumn 自动完成，这里不用写 where）
    expect(repo.find).toHaveBeenCalledWith({ order: { id: 'ASC' } });
  });

  it('findById：命中返回用户，未命中返回 null', async () => {
    const user = makeUser();
    repo.findOne.mockResolvedValue(user);
    await expect(service.findById(1)).resolves.toBe(user);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 1 } });

    repo.findOne.mockResolvedValue(null);
    await expect(service.findById(999)).resolves.toBeNull();
  });

  // ───────── 创建 ─────────

  it('create：用户名已存在 → 抛 ConflictException(409)，且不写库', async () => {
    repo.findOne.mockResolvedValue(makeUser()); // 模拟已存在同名用户

    await expect(
      service.create({ username: 'alice', password: '123456' }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(repo.save).not.toHaveBeenCalled();
  });

  it('create：密码经 bcrypt 哈希后才存库（绝不存明文），并补齐默认字段', async () => {
    repo.findOne.mockResolvedValue(null); // 用户名可用
    // 模拟 save：补上数据库自增 id 后返回（真 Repository 的行为）
    repo.save.mockImplementation(async (u: User) => {
      u.id = 2;
      return u;
    });

    const saved = await service.create({
      username: 'bob',
      password: 'secret123',
      email: 'bob@example.com',
    });

    // 1) 存库的密码不是明文
    expect(saved.hashedPassword).not.toBe('secret123');
    // 2) 用 bcrypt.compare 能对上，说明哈希有效
    await expect(bcrypt.compare('secret123', saved.hashedPassword)).resolves.toBe(true);
    // 3) 默认字段被补齐（表结构这些列没有 MySQL 默认值，必须显式赋值）
    expect(saved.role).toBe('user');
    expect(saved.isActive).toBe(true);
    expect(saved.createdAt).toBeInstanceOf(Date);
  });

  // ───────── 更新 ─────────

  it('update：用户不存在 → 抛 NotFoundException(404)', async () => {
    repo.findOne.mockResolvedValue(null);

    await expect(
      service.update(99, { email: 'x@y.com' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update：只传部分字段时，未传字段保留原值（PATCH 语义）', async () => {
    const user = makeUser({ username: 'alice', email: 'alice@example.com' });
    repo.findOne.mockResolvedValue(user);
    repo.save.mockImplementation(async (u: User) => u);

    const updated = await service.update(1, { email: 'new@example.com' });

    expect(updated.email).toBe('new@example.com'); // 传了的被更新
    expect(updated.username).toBe('alice');        // 没传的保持原值
  });

  it('update：新用户名被其他用户占用 → 抛 ConflictException(409)', async () => {
    const me = makeUser({ id: 1, username: 'alice' });
    const other = makeUser({ id: 2, username: 'bob' });
    // 第一次 findOne = findById(拿到自己)；第二次 findOne = 查重(拿到别人)
    repo.findOne.mockResolvedValueOnce(me).mockResolvedValueOnce(other);

    await expect(
      service.update(1, { username: 'bob' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('update：传了 password 才重新哈希', async () => {
    const user = makeUser();
    repo.findOne.mockResolvedValue(user);
    repo.save.mockImplementation(async (u: User) => u);

    const updated = await service.update(1, { password: 'brandnew' });

    await expect(bcrypt.compare('brandnew', updated.hashedPassword)).resolves.toBe(true);
  });

  // ───────── 软删除 ─────────

  it('remove：走 Repository.softDelete（发 UPDATE 而非物理 DELETE）', async () => {
    repo.softDelete.mockResolvedValue({ affected: 1 });

    await expect(service.remove(1)).resolves.toBeUndefined();
    expect(repo.softDelete).toHaveBeenCalledWith(1);
  });

  it('remove：目标不存在或已删（affected=0）→ 抛 NotFoundException(404)', async () => {
    repo.softDelete.mockResolvedValue({ affected: 0 });

    await expect(service.remove(9)).rejects.toBeInstanceOf(NotFoundException);
  });
});
