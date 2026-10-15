// 电影实体类
// 对照 Java 项目: src/main/java/com/example/test1backend/entity/Movie.java
import { Entity, PrimaryGeneratedColumn, Column, DeleteDateColumn } from 'typeorm';

@Entity('movies') // 对应 MySQL 的 movies 表
export class Movie {
  @PrimaryGeneratedColumn({ type: 'int', name: 'id' })
  id: number;

  @Column({ type: 'varchar', length: 255, name: 'title' })
  title: string;

  @Column({ type: 'int', name: 'year' })
  year: number;

  // 数据库字段是 float 类型（Java 项目用 BigDecimal 也可，这里简化）
  @Column({ type: 'float', name: 'rating', nullable: true })
  rating: number;

  // 注意：movies 表的 deleted_at 是 date 类型（不是 datetime）
  // @DeleteDateColumn：和 User 一致，查询会自动追加 deleted_at IS NULL，业务代码不用手写过滤
  // （只改代码层，synchronize=false 不会动表结构）
  @DeleteDateColumn({ type: 'date', name: 'deleted_at', nullable: true })
  deletedAt: Date | null;
}
