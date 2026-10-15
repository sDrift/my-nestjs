// 用户接口控制器（Controller）
// 对照 Java 项目: src/main/java/com/example/test1backend/controller/UserController.java
import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, NotFoundException } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service.js';
import { User } from './user.entity.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { Public } from '../decorators/public.decorator.js';

// @ApiTags('users')：Swagger 文档按这个标签分组，所有接口归在 users 分组下
// 对照 Java springdoc-openapi 的 @Tag(name = "users")
// 前端(Vue3)理解：像把路由按 module 分组在 vue-router 配置里，devtools 里看着不乱
@ApiTags('users')
// @Controller('users') 等价于 Java 的 @RestController + @RequestMapping('/users')
// 配合 main.ts 里的 setGlobalPrefix('api')，最终路径是 /api/users
@Controller('users')
// ⚠️ 这里把类级 @Public 撤掉了，默认所有接口都受全局 AuthGuard 保护
//   下面用方法级 @Public() 精确控制谁能免 token 调：
//   - 两个 GET 读接口：保持 @Public（读接口先放行）
//   - POST create：临时 @Public（你现在"忘密码了，自己建一个用户"）
//      生产环境务必删掉 POST 上的 @Public() 或改成 @Roles('admin')，否则任何人都能注册管理员账号
export class UsersController {
  // 构造器注入 Service，等价于 Java 的 private final UserService userService;
  constructor(private readonly svc: UsersService) {}

  // GET /api/users —— 查询所有用户（免 token）
  // 等价于 Java 的 @GetMapping + @ResponseBody
  @Public()
  @Get()
  @ApiOperation({ summary: '查询所有用户' })
  findAll(): Promise<User[]> {
    return this.svc.findAll();
  }

  // GET /api/users/:id —— 按 id 查询（免 token）
  // ParseIntPipe 等价于 Java 的 @PathVariable Long id（自动转 number，非数字会 400）
  @Public()
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

  // POST /api/users —— 创建用户
  // ⚠️ 临时 @Public：现在先让你不用登录就能注册（你说密码忘了）
  //   生产请删除 @Public()，改为需要登录 + 管理员角色才能建账号，否则任意访客能注册超级用户
  // 对照 Java：@PostMapping @RequestBody CreateUserRequest
  // 前端(Vue3)理解：你写注册页面 <form @submit.prevent> 调 api.post('/users', form)
  //   成功返回 { code:0, data:{ id, username, email, createdAt } }
  @Public()
  @Post()
  @ApiOperation({ summary: '创建用户（临时免 token，生产请加鉴权）' })
  @ApiBody({ type: CreateUserDto })
  create(@Body() dto: CreateUserDto): Promise<User> {
    // 传进来的 dto 已经过 ValidationPipe：
    //   - username 2+ 位且非空
    //   - password 4+ 位且非空
    //   - email（若填）必须符合邮箱格式
    //   不合法直接在第 4 层 ValidationPipe 抛 400，不会到这里
    return this.svc.create(dto);
  }

  // PATCH /api/users/:id —— 更新用户（需要 token，不标 @Public）
  // ⚠️ 没有 @Public() → 全局 AuthGuard 会先校验 Authorization: Bearer <token>
  //   没 token / token 无效 → 直接 401，到不了这里
  // 对照 Java：@PatchMapping("/{id}") @RequestBody UpdateUserRequest
  // 前端(Vue3)理解：编辑用户弹窗点保存 → api.patch(`/users/${id}`, form)
  @Patch(':id')
  @ApiOperation({ summary: '更新用户（需登录）' })
  @ApiParam({ name: 'id', description: '用户 id', example: 8 })
  @ApiBody({ type: UpdateUserDto })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
  ): Promise<User> {
    // dto 里所有字段都是可选的（@IsOptional），ValidationPipe 只校验"传了的"字段
    //   例如只传 { password: 'newpass' } → 只校验 password，其他字段保持原值
    return this.svc.update(id, dto);
  }

  // DELETE /api/users/:id —— 软删除用户（需要 token）
  // 对照 Java：@DeleteMapping("/{id}")
  // 前端(Vue3)理解：用户列表点删除按钮 → 确认框 → api.delete(`/users/${id}`)
  @Delete(':id')
  @HttpCode(204) // 204 No Content：删除成功无返回体，比 200 更符合 REST 语义
  @ApiOperation({ summary: '软删除用户（需登录）' })
  @ApiParam({ name: 'id', description: '用户 id', example: 8 })
  remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    return this.svc.remove(id);
  }
}
