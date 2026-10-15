// 更新用户 DTO：PATCH /api/users/:id 的请求体校验
// 对照 Java：UpdateUserRequest，所有字段用 @NotNull/@NotBlank 的"可选"版本（只校验传入的字段）
// 前端(Vue3)理解：像 el-form 的编辑表单——用户只改了几个字段就只传几个，没改的字段不传
//   服务端用 Partial<T> 思路：只校验"传了的"字段，没传的保持原值
import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  // @IsOptional()：字段可以不传；传了才走后面的校验
  // 不传时 dto.username = undefined，Service 里用 dto.username ?? user.username 保留原值
  @ApiPropertyOptional({ description: '用户名（唯一）', example: 'alice_new' })
  @IsOptional()
  @IsString({ message: '用户名必须是字符串' })
  @MinLength(2, { message: '用户名至少 2 位' })
  username?: string;

  @ApiPropertyOptional({ description: '新密码（明文，服务端 bcrypt 哈希后存库）', example: '654321' })
  @IsOptional()
  @IsString({ message: '密码必须是字符串' })
  @MinLength(4, { message: '密码至少 4 位' })
  password?: string;

  @ApiPropertyOptional({ description: '邮箱', example: 'new@example.com' })
  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;

  @ApiPropertyOptional({ description: '是否启用', example: true })
  @IsOptional()
  @IsBoolean({ message: 'isActive 必须是布尔值' })
  isActive?: boolean;
}
