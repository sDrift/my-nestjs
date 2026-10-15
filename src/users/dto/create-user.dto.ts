// 创建用户 DTO：POST /api/users 的请求体校验
// 对照 Java：CreateUserRequest @RequestBody + JSR-303 校验
// 前端(Vue3)理解：像前端 el-form 的 rules 校验，比如 username 必填、邮箱格式、
//   密码至少 4 位；前端校验是为了体验，服务端这层校验是为了安全（绕过前端直接 curl 也能拦）
import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ description: '用户名（唯一）', example: 'alice' })
  @IsNotEmpty({ message: '用户名不能为空' })
  @IsString({ message: '用户名必须是字符串' })
  @MinLength(2, { message: '用户名至少 2 位' })
  username: string;

  @ApiProperty({ description: '密码（明文，服务端 bcrypt 哈希后存库，不存明文）', example: '123456' })
  @IsNotEmpty({ message: '密码不能为空' })
  @IsString({ message: '密码必须是字符串' })
  @MinLength(4, { message: '密码至少 4 位' })
  password: string;

  // email 字段 Java 项目的 User 实体 @Column(name='email') 有，这里放可选
  @ApiProperty({ description: '邮箱（可选）', example: 'alice@example.com', required: false })
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;
}
