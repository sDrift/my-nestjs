// 用户服务层（Service）
// 对照 Java 项目: src/main/java/com/example/test1backend/mapper/UserMapper.java
// 关键差异：NestJS 中 Mapper 和 Service 合并为一层，直接用 TypeORM 的 Repository
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './user.entity.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';

@Injectable() // 等价于 Java 的 @Service / @Component，标记为可注入的 Provider
export class UsersService {
  // 构造器注入，等价于 Java 的 @Autowired 构造器注入
  // @InjectRepository(User) 把 TypeORM 的 Repository 绑定到 User 实体
  //
  // 机制——repo 这个对象到底从哪冒出来的：
  //   1) UsersModule 里写了 imports: [TypeOrmModule.forFeature([User])]
  //   2) forFeature 读 User 类的 @Entity/@Column 元数据，在 IoC 容器里注册了一个
  //      token "Repository<User>"，对应的实例是一个"懂 User 表结构"的 Repository
  //   3) 这里构造器声明 @InjectRepository(User) private repo: Repository<User>
  //      就是告诉容器："请按 Repository<User> 这个 token 取一个实例注入进来"
  //   4) 容器 new UsersService 时发现构造器要这个 token，就把那个 Repository 实例传进来
  //   所以 repo 不是我们 new 的，是容器在装配时按 token 注入进来的——这就是"依赖注入"
  // 前端(Vue3)理解：像 setup(props) 里的 props——不是组件自己造的，是父组件/容器传进来的。
  //   这里"父组件"就是 IoC 容器，它按你声明的 token 把 Repository 传给 Service。
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  // 查询所有未软删除的用户，等价于 Java 的 @Select("SELECT * FROM users WHERE deleted_at IS NULL ORDER BY id")
  //
  // repo.find 怎么就拿到表里数据的——调用时发生了什么：
  //   1) this.repo.find({ order: {...} }) 是 TypeORM 的 API，不直接发 SQL
  //   2) repo 内部读 User 类的 @Entity('users') 拿到表名 'users'
  //   3) 因为 deletedAt 用了 @DeleteDateColumn，TypeORM 会自动补上 deleted_at IS NULL 条件，
  //      所以这里不用再手写 `where: { deletedAt: IsNull() }`（写了也等价，属于冗余）
  //   4) 把 order 翻译成 ORDER BY id ASC（@Column name='id'）
  //   5) 拼出完整 SQL: SELECT * FROM users WHERE deleted_at IS NULL ORDER BY id ASC
  //   6) 通过 mysql2 驱动把这个 SQL 发给 MySQL，MySQL 返回所有匹配的行
  //   7) TypeORM 把每一行 { id:1, username:'sTest', hashed_password:'...', ... }
  //      按 @Column 的 name 映射到 User 实例的属性（hashed_password → hashedPassword）
  //   8) 返回 User[]，每个元素是一个带数据的 User 实例（含 @Exclude 的敏感字段，但在响应阶段被剔）
  // 前端(Vue3)理解：像封装一个 useUsers() composable 内部 await fetch('/api/users')——
  //   你只调一个函数，里面的 fetch/序列化/类型还原都是底层封装好的，你拿到的是结构化对象。
  //   这里 this.repo.find 是"对象版 SQL"——你写对象，TypeORM 替你拼 SQL + 发送 + 映射。
  findAll(): Promise<User[]> {
    return this.repo.find({
      order: { id: 'ASC' },
    });
  }

  // 按 id 查询单条用户
  // 等价于 Java 的 @Select("SELECT * FROM users WHERE id = #{id} AND deleted_at IS NULL")
  //
  // 同上：findOne 会拼出 SELECT * FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1，
  //   （deleted_at IS NULL 由 @DeleteDateColumn 自动追加）
  //   发到 MySQL，拿回单行（或拿不到返回 null），把行映射成 User 实例。
  //   区别只在 find 返回数组、findOne 返回单个 + 自动加 LIMIT 1。
  findById(id: number): Promise<User | null> {
    return this.repo.findOne({
      where: { id },
    });
  }

  // 创建用户：POST /api/users 调用
  // 对照 Java：UserRepository.save(new User(username, encodedPassword, email))
  //
  // 关键步骤：
  //   1) 查 username 是否已存在（users 表 username 应该是 UNIQUE 索引），
  //      已存在就抛 ConflictException(409)，避免 MySQL 抛 1062 duplicate entry 让人看不懂
  //   2) bcrypt.hash(password, saltRounds)：把明文密码哈希后才存库，**绝对不存明文**
  //      - saltRounds=10：2^10 次迭代，约 200ms，慢到足以让彩虹表/暴力破解不划算
  //      - bcrypt 自动把 salt 拼进哈希结果字符串（格式 $2a$10$<salt><hash>），不用单独存 salt 列
  //   3) repo.save(user)：INSERT INTO users(username, hashed_password, email, created_at) VALUES (?,?,?,NOW())
  //      返回保存后的 User 实例（含数据库自动生成的 id / createdAt 等字段）
  // 前端(Vue3)理解：你前端千万不能 hash 后再发给后端——传输层靠 HTTPS 保护；
  //   明文传到后端、后端才哈希存库的好处是：bcrypt 的 salt/saltRounds 升级只要后端改代码就行，
  //   不用前端版本对齐；而且如果前端自己算，会把"算法与成本"暴露给攻击者。
  async create(dto: CreateUserDto): Promise<User> {
    // 1) 用户名唯一校验
    //    注意：@DeleteDateColumn 会自动在查询里追加 deleted_at IS NULL，
    //    即"和已软删除的同名用户不算冲突"（符合直觉：删掉的名字可以再用）
    const exists = await this.repo.findOne({
      where: { username: dto.username },
    });
    if (exists) {
      // 409 Conflict: 表示资源冲突（已有同名用户），不是参数错误 400 也不是权限 401
      throw new ConflictException(`用户名 "${dto.username}" 已存在`);
    }

    // 2) 明文密码 → bcrypt 哈希。对照 Java BCryptPasswordEncoder.encode(raw)
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(dto.password, saltRounds);

    // 3) new User() + 属性赋值（TypeORM create 也可以，结果一样）
    // 注意：当前表结构里 role、email、is_active 都没有 MySQL 层 DEFAULT（synchronize=false 也不能改表），
    //   所以这里每个字段都要显式赋值，否则 MySQL 抛 "Field 'xxx' doesn't have a default value"
    const user = new User();
    user.username = dto.username;
    user.hashedPassword = hashedPassword;
    user.email = dto.email ?? '';          // email 没填用空串兜底（表列非 null）
    user.role = 'user';                   // 普通用户；对应 MySQL users.role 默认应为 'user'
    user.isActive = true;                 // 新用户默认启用；对应 MySQL users.is_active 默认 1
    user.createdAt = new Date();          // 实体 createdAt 只是 @Column 不是 @CreateDateColumn，不会自动填，手动给 NOW()
    // currentToken / tokenExpiresAt 此时为空（没登录，没生成 token），实体列 nullable 可接受 null

    // 4) 存库 → 返回保存后的实例（已带 id）
    return this.repo.save(user);
  }

  // 更新用户：PATCH /api/users/:id 调用
  // 对照 Java：userRepository.findById(id) → setXxx(dto.getXxx()) → userRepository.save(user)
  //
  // PATCH vs PUT 的区别（本项目用 PATCH）：
  //   - PUT：要求传完整的资源对象（所有字段都要给），不传的字段会被当成"清空/重置"
  //   - PATCH：只传要改的字段，不传的字段保持原值（partial update）
  //   前端(Vue3)理解：像 Object.assign(user, patch) 只覆盖传了的属性，没传的不动
  //
  // 关键步骤：
  //   1) findById 查出原用户，不存在 → 404 NotFoundException
  //   2) 如果改了 username，检查新用户名是否和别人冲突（不能和自己 id 以外的用户重名）
  //   3) 用 ?? 合并：dto.xxx ?? user.xxx（dto 没传就保留原值）
  //   4) 如果传了 password，重新 bcrypt.hash（否则保留原 hashedPassword）
  //   5) repo.save(user)：TypeORM 发现 user 有 id，会发 UPDATE 而不是 INSERT
  async update(id: number, dto: UpdateUserDto): Promise<User> {
    // 1) 查出原用户（必须存在且未软删除）
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundException(`User #${id} not found`);
    }

    // 2) 如果改了 username，检查新用户名是否被别人占用
    //    注意要排除自己：where 条件里 id != 当前 id
    if (dto.username && dto.username !== user.username) {
      const conflict = await this.repo.findOne({
        where: { username: dto.username },
      });
      // 找到别人（id 不同）也用这个名字 → 冲突
      if (conflict && conflict.id !== id) {
        throw new ConflictException(`用户名 "${dto.username}" 已存在`);
      }
    }

    // 3) 合并字段：dto 传了就用 dto 的，没传就保留 user 原值
    //    ?? 是"空值合并"：左边是 null/undefined 才取右边，空字符串 '' 不会被 ?? 跳过
    user.username = dto.username ?? user.username;
    user.email = dto.email ?? user.email;
    user.isActive = dto.isActive ?? user.isActive;

    // 4) 密码单独处理：传了才重新哈希，没传保持原 hashedPassword
    if (dto.password) {
      user.hashedPassword = await bcrypt.hash(dto.password, 10);
    }

    // 5) save：TypeORM 看到 user.id 已存在，执行 UPDATE
    //    SQL: UPDATE users SET username=?, email=?, is_active=?, hashed_password=? WHERE id=?
    return this.repo.save(user);
  }

  // 软删除用户：DELETE /api/users/:id 调用
  // 对照 Java：user.setDeletedAt(LocalDateTime.now()); userRepository.save(user)
  //
  // 为什么叫"软删除"而不是真删：
  //   - 真删（repo.delete / DELETE FROM）：数据从表里彻底消失，不可恢复
  //   - 软删除：把 deleted_at 字段设为当前时间，数据还在表里，
  //     但查询会自动过滤掉（@DeleteDateColumn 生效），所以业务上"看不见"= 已删除
  //   好处：可恢复（repo.restore）、可审计、关联数据不会因外键 cascade 被误删
  //
  // 实现方式：
  //   User 实体的 deletedAt 用的是 @DeleteDateColumn，所以可以直接用 repo.softDelete(id)，
  //   它内部发的是 UPDATE users SET deleted_at = NOW() WHERE id = ?（不是物理 DELETE）
  //   返回 DeleteResult { affected }，affected=0 表示这条记录不存在（或已删过）
  async remove(id: number): Promise<void> {
    // softDelete 一条 UPDATE 语句搞定，不用先 findOne 再 save（少一次查库）
    // 对照 Java：等价于 MyBatis-Plus 的 removeById()（走 @TableLogic 逻辑删除）
    const result = await this.repo.softDelete(id);

    // affected 为 0：说明没匹配到"未删除"的该 id（不存在，或已经被软删除过）
    //   → 按 REST 语义抛 404，比静默返回成功更规范
    if (!result.affected) {
      throw new NotFoundException(`User #${id} not found`);
    }
  }
}
