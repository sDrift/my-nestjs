// 用户实体类
// 对照 Java 项目: src/main/java/com/example/test1backend/entity/User.java
import { Entity, PrimaryGeneratedColumn, Column, DeleteDateColumn } from 'typeorm';
import { Exclude } from 'class-transformer';

@Entity('users') // 对应 MySQL 的 users 表
export class User {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column({ type: 'varchar', length: 255, name: 'username' })
  username: string;

  @Column({ type: 'varchar', length: 255, name: 'email' })
  email: string;

  // 注意：原表字段就叫 hashed_password（少了 r），保持与数据库一致
  // @Exclude：配合全局 ClassSerializerInterceptor，把实体序列化成 JSON 时自动剔除该字段
  // 这样 Controller 即使直接 return User，也不会把密码哈希泄露给前端
  // 对照 Java 项目里通常用 @JsonIgnore 标注敏感字段
  // 前端(Vue3)理解：相当于前端在返回给调用方前做脱敏
  //   const { hashedPassword, ...safe } = user; return safe
  // 只不过这里用注解声明，由框架在序列化阶段统一剔除，不用每次手写
  @Exclude()
  @Column({ type: 'varchar', length: 255, name: 'hashed_password' })
  hashedPassword: string;

  @Column({ type: 'varchar', length: 50, name: 'role' })
  role: string;

  // tinyint(1) → boolean 是 TypeORM 的默认类型映射
  @Column({ type: 'boolean', name: 'is_active', nullable: true })
  isActive: boolean;

  @Column({ type: 'datetime', name: 'created_at', nullable: true })
  createdAt: Date;

  // 软删除标记字段（数据库列仍叫 deleted_at，不改表结构，synchronize=false 也不会动表）
  // @DeleteDateColumn 是 TypeORM 的"软删除"专用装饰器，相比普通 @Column 多出三个能力：
  //   1) find / findOne / findAndCount 等查询会自动追加 WHERE deleted_at IS NULL，
  //      业务代码不用再手写 `where: { deletedAt: IsNull() }` 去过滤已删除数据
  //   2) repo.softDelete(id) 会把该列置为当前时间；repo.restore(id) 可恢复
  //   3) 想看"连已删除的一起"时，查询传 withDeleted: true 即可
  // 对照 Java：等价于 Hibernate 的 @SQLDelete(sql="UPDATE ... SET deleted_at=NOW()") +
  //   @Where(clause="deleted_at IS NULL")，或 MyBatis-Plus 的 @TableLogic
  // 前端(Vue3)理解：像给列表数据套了一层默认过滤器——默认只显示"未删除"的，
  //   要看回收站时再额外打开 withDeleted 开关（类似前端列表默认隐藏已归档项）
  @DeleteDateColumn({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt: Date | null;

  // @Exclude：当前登录 token 同样属于敏感信息，不应随用户接口外泄
  // 前端(Vue3)理解：类似你在 Pinia store 里存了 token，但 export 给组件时只暴露用户信息
  //   不把 token 放进返回给后端/第三方的 payload
  @Exclude()
  @Column({ type: 'mediumtext', name: 'current_token', nullable: true })
  currentToken: string;

  // @Exclude：token 过期时间也不外泄，避免给攻击者提供信息
  @Exclude()
  @Column({ type: 'datetime', name: 'token_expires_at', nullable: true })
  tokenExpiresAt: Date;
}
