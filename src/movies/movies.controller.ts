// 电影接口控制器（Controller）
// 对照 Java 项目: src/main/java/com/example/test1backend/controller/MovieController.java
import { Controller, Get, Param, ParseIntPipe, NotFoundException } from '@nestjs/common';
import { MoviesService } from './movies.service.js';
import { Movie } from './movie.entity.js';

@Controller('movies')
export class MoviesController {
  constructor(private readonly svc: MoviesService) {}

  @Get()
  findAll(): Promise<Movie[]> {
    return this.svc.findAll();
  }

  @Get(':id')
  async findById(@Param('id', ParseIntPipe) id: number): Promise<Movie> {
    const movie = await this.svc.findById(id);
    if (!movie) {
      throw new NotFoundException(`Movie #${id} not found`);
    }
    return movie;
  }
}
