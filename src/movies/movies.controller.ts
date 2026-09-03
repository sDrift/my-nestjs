// 电影接口控制器（Controller）
// 对照 Java 项目: src/main/java/com/example/test1backend/controller/MovieController.java
import { Controller, Get, Param, ParseIntPipe, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { MoviesService } from './movies.service.js';
import { Movie } from './movie.entity.js';

// @ApiTags('movies')：Swagger 文档分组标签，所有 movies 接口归在一起
@ApiTags('movies')
@Controller('movies')
export class MoviesController {
  constructor(private readonly svc: MoviesService) {}

  @Get()
  @ApiOperation({ summary: '查询所有电影' })
  findAll(): Promise<Movie[]> {
    return this.svc.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: '按 id 查询电影' })
  async findById(@Param('id', ParseIntPipe) id: number): Promise<Movie> {
    const movie = await this.svc.findById(id);
    if (!movie) {
      throw new NotFoundException(`Movie #${id} not found`);
    }
    return movie;
  }
}
