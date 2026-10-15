// 电影服务层（Service）
// 对照 Java 项目: src/main/java/com/example/test1backend/mapper/MovieMapper.java
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Movie } from './movie.entity.js';

@Injectable()
export class MoviesService {
  constructor(
    @InjectRepository(Movie) private readonly repo: Repository<Movie>,
  ) {}

  findAll(): Promise<Movie[]> {
    // deletedAt 是 @DeleteDateColumn，deleted_at IS NULL 由 TypeORM 自动追加，无需手写 where
    return this.repo.find({
      order: { id: 'ASC' },
    });
  }

  findById(id: number): Promise<Movie | null> {
    return this.repo.findOne({
      where: { id },
    });
  }
}
