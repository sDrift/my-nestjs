// 登录 DTO：校验 /api/auth/login 的请求体
// 对照 Java：RequestBody LoginRequest
// 前端(Vue3)理解：像前端发请求前用 zod schema 校验表单输入——
//   服务端也做一遍（前端校验是为了体验，服务端校验是为了安全），
//   class-validator 的装饰器 + ValidationPipe 自动 400 拒绝非法输入
import { IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  // @IsNotEmpty：不能是 null/undefined/空字符串，不填就 400
  // @IsString：必须是 string 类型
  // ApiProperty：swagger 文档显示该字段的描述和示例
  @ApiProperty({ description: '用户名', example: 'sTest' })
  @IsNotEmpty({ message: '用户名不能为空' })
  @IsString({ message: '用户名必须是字符串' })
  username: string;

  @ApiProperty({ description: '密码（明文，服务端用 bcrypt 对比哈希）', example: '123456' })
  @IsNotEmpty({ message: '密码不能为空' })
  @IsString({ message: '密码必须是字符串' })
  @MinLength(4, { message: '密码至少 4 位' })
  password: string;
}
