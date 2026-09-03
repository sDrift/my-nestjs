// 电影服务层（Service）
// 对照 Java 项目: src/main/java/com/example/test1backend/mapper/MovieMapper.java
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Movie } from './movie.entity.js';

@Injectable()
export class MoviesService {
  constructor(
    @InjectRepository(Movie) private readonly repo: Repository<Movie>,
  ) {}

  findAll(): Promise<Movie[]> {
    return this.repo.find({
      where: { deletedAt: IsNull() },
      order: { id: 'ASC' },
    });
  }

  findById(id: number): Promise<Movie | null> {
    return this.repo.findOne({
      where: { id, deletedAt: IsNull() },
    });
  }
}
