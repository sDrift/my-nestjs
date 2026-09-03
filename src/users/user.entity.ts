// 用户实体类
// 对照 Java 项目: src/main/java/com/example/test1backend/entity/User.java
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
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

  // 软删除字段（与 Java 项目一致，SQL 里手动加 WHERE deleted_at IS NULL）
  @Column({ type: 'datetime', name: 'deleted_at', nullable: true })
  deletedAt: Date;

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
