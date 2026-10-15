// 环境变量启动校验（Environment Validation）
// 作用：应用启动时（ConfigModule 加载 .env 之后）立刻校验必需的环境变量，
//   缺哪个/格式错哪个，就带着清晰的错误信息"快速失败"（fail fast），
//   避免应用先启动成功、等到第一次连数据库或第一次读配置时才报错。
//
// 原注释：无（本项目新增）
// 对照 Java：类似 Spring Boot 的 @ConfigurationProperties + @Validated，
//   或 @Value 注入时用 JSR-303 校验，配置不合法就在启动阶段抛异常终止。
// 前端(Vue3)理解：类似在 main.ts 里 app.mount 之前先 assert 一遍关键配置
//   （process.env.VITE_API_BASE 没配就直接 throw，别等页面白屏了才发现）；
//   这里是"启动前先 assert 配置"，不合格直接崩，不给你带病上线的机会。
import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

// 运行环境枚举。对照 Java 的 Profile（dev / prod）
export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

// 环境变量的"类型声明 + 校验规则"类
// 每个属性对应一个环境变量，装饰器描述它的约束；校验失败会把字段名一起报出来
export class EnvironmentVariables {
  // NODE_ENV：可省略，默认 development
  @IsOptional()
  @IsEnum(NodeEnv, {
    message: 'NODE_ENV 只能是 development / production / test',
  })
  NODE_ENV: NodeEnv = NodeEnv.Development;

  // ── 数据库连接（必填）──
  @IsNotEmpty({ message: 'DB_HOST 不能为空' })
  @IsString({ message: 'DB_HOST 必须是字符串' })
  DB_HOST: string;

  @IsInt({ message: 'DB_PORT 必须是整数' })
  @Min(1, { message: 'DB_PORT 必须在 1-65535 之间' })
  @Max(65535, { message: 'DB_PORT 必须在 1-65535 之间' })
  DB_PORT: number;

  @IsNotEmpty({ message: 'DB_USER 不能为空' })
  @IsString({ message: 'DB_USER 必须是字符串' })
  DB_USER: string;

  @IsNotEmpty({ message: 'DB_PASSWORD 不能为空' })
  @IsString({ message: 'DB_PASSWORD 必须是字符串' })
  DB_PASSWORD: string;

  @IsNotEmpty({ message: 'DB_NAME 不能为空' })
  @IsString({ message: 'DB_NAME 必须是字符串' })
  DB_NAME: string;

  // ── HTTP 监听端口（可省略，默认 3000）──
  @IsOptional()
  @IsInt({ message: 'PORT 必须是整数' })
  @Min(1, { message: 'PORT 必须在 1-65535 之间' })
  @Max(65535, { message: 'PORT 必须在 1-65535 之间' })
  PORT: number = 3000;

  // ── CORS 白名单（可省略；但生产环境下面会强制要求）──
  @IsOptional()
  @IsString({ message: 'CORS_ORIGINS 必须是字符串' })
  CORS_ORIGINS?: string;
}

// 校验函数：ConfigModule.forRoot({ validate: validateEnv }) 会在启动时调用它
// 入参 config 是"process.env + .env 文件"合并后的原始对象（值全是 string/undefined）
// 返回校验+类型转换后的对象，NestJS 会用它作为 ConfigService 的数据源
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  // plainToInstance 做两件事：
  //   1) 把普通对象还原成 EnvironmentVariables 实例（这样 class-validator 的装饰器元数据才生效）
  //   2) enableImplicitConversion 让 "3306" 这种字符串自动转成 number（懒省去手写 parseInt）
  // 前端(Vue3)理解：类似用 zod/valibot 的 schema.parse(config)，一次拿到"已校验 + 已定型"的对象
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  // validateSync：跑一遍上面所有装饰器规则，收集全部不合法项一次性报出
  // 前端(Vue3)理解：像 el-form 的 validate() 返回 errors 数组，全部列出来比一次报一个更省事
  const errors = validateSync(validated, {
    skipMissingProperties: false, // 连"整个必填项缺失"也要报
  });

  if (errors.length > 0) {
    // 把所有字段的错误拼成一段人话，抛出去 → 应用启动直接失败
    const detail = errors
      .map((e) => {
        const constraints = e.constraints
          ? Object.values(e.constraints).join('；')
          : '格式不正确';
        return `  - ${e.property}: ${constraints}`;
      })
      .join('\n');
    throw new Error(
      `环境变量校验失败，请检查 .env（可对照 .env.example）：\n${detail}`,
    );
  }

  // 生产环境的额外"安全红线"：CORS 白名单不能为空
  // 原因：为空时 main.ts 会放行所有来源，等于任何人/任何网站都能调你的 API，生产上很危险
  // 对照 Java：生产 Profile 里强制配置允许的跨域来源
  if (validated.NODE_ENV === NodeEnv.Production && !validated.CORS_ORIGINS) {
    throw new Error(
      '生产环境（NODE_ENV=production）必须配置 CORS_ORIGINS 白名单，' +
        '不允许为空（空值会放行所有来源，存在安全风险）。',
    );
  }

  return validated;
}
