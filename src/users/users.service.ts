// 用户服务层（Service）
// 对照 Java 项目: src/main/java/com/example/test1backend/mapper/UserMapper.java
// 关键差异：NestJS 中 Mapper 和 Service 合并为一层，直接用 TypeORM 的 Repository
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { User } from './user.entity.js';

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
  //   1) this.repo.find({ where: {...}, order: {...} }) 是 TypeORM 的 API，不直接发 SQL
  //   2) repo 内部读 User 类的 @Entity('users') 拿到表名 'users'
  //   3) 把 where 对象翻译成 SQL 片段：
  //        { deletedAt: IsNull() } → 因为 @Column name='deleted_at'，翻译成 deleted_at IS NULL
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
      where: { deletedAt: IsNull() },
      order: { id: 'ASC' },
    });
  }

  // 按 id 查询单条用户
  // 等价于 Java 的 @Select("SELECT * FROM users WHERE id = #{id} AND deleted_at IS NULL")
  //
  // 同上：findOne 会拼出 SELECT * FROM users WHERE id=? AND deleted_at IS NULL LIMIT 1，
  //   发到 MySQL，拿回单行（或拿不到返回 null），把行映射成 User 实例。
  //   区别只在 find 返回数组、findOne 返回单个 + 自动加 LIMIT 1。
  findById(id: number): Promise<User | null> {
    return this.repo.findOne({
      where: { id, deletedAt: IsNull() },
    });
  }
}
