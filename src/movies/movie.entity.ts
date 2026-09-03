// 电影实体类
// 对照 Java 项目: src/main/java/com/example/test1backend/entity/Movie.java
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

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
  @Column({ type: 'date', name: 'deleted_at', nullable: true })
  deletedAt: Date;
}
