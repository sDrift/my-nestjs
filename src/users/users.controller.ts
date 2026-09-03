// 用户接口控制器（Controller）
// 对照 Java 项目: src/main/java/com/example/test1backend/controller/UserController.java
import { Controller, Get, Param, ParseIntPipe, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { UsersService } from './users.service.js';
import { User } from './user.entity.js';

// @ApiTags('users')：Swagger 文档按这个标签分组，所有接口归在 users 分组下
// 对照 Java springdoc-openapi 的 @Tag(name = "users")
// 前端(Vue3)理解：像把路由按 module 分组在 vue-router 配置里，devtools 里看着不乱
@ApiTags('users')
// @Controller('users') 等价于 Java 的 @RestController + @RequestMapping('/users')
// 配合 main.ts 里的 setGlobalPrefix('api')，最终路径是 /api/users
@Controller('users')
export class UsersController {
  // 构造器注入 Service，等价于 Java 的 private final UserService userService;
  constructor(private readonly svc: UsersService) {}

  // GET /api/users —— 查询所有用户
  // 等价于 Java 的 @GetMapping + @ResponseBody
  @Get()
  @ApiOperation({ summary: '查询所有用户' })
  findAll(): Promise<User[]> {
    return this.svc.findAll();
  }

  // GET /api/users/:id —— 按 id 查询
  // ParseIntPipe 等价于 Java 的 @PathVariable Long id（自动转 number，非数字会 400）
  @Get(':id')
  @ApiOperation({ summary: '按 id 查询用户' })
  async findById(@Param('id', ParseIntPipe) id: number): Promise<User> {
    const user = await this.svc.findById(id);
    if (!user) {
      // 主动抛 404，比 Java 版直接返回 null 更规范
      throw new NotFoundException(`User #${id} not found`);
    }
    return user;
  }
}
