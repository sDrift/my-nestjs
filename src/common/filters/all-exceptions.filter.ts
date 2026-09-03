// 全局异常过滤器
// 对照 Java 项目的 @ControllerAdvice + @ExceptionHandler 统一异常处理
// 作用：捕获所有抛出的异常，统一包装成 { code, message, data: null } 结构返回前端
// 同时用 pino logger 记录完整堆栈，便于排查问题
//
// 处理分类：
//   1. HttpException —— 框架抛出的业务异常（如 NotFoundException、BadRequestException、ParseIntPipe）
//      按 status 当 code 用，message 取 getResponse() 里携带的内容
//   2. 其他异常（Error 实例等）—— 未知系统错误，统一返回 500，堆栈不外泄只记日志
//
// 前端(Vue3)理解：完全等价于 Vue3 的全局错误处理器
//   app.config.errorHandler = (err, instance, info) => { /* 统一处理 */ }
// 也像 axios.interceptors.response.use 的第二个参数(错误处理)统一把 HTTP 错误格式化。
// 后端在这里把错误"包成统一形状"，前端 axios 拦截器就能统一弹 ElMessage.error(body.message)。
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

// 统一响应体类型（与 transform.interceptor.ts 里保持一致）
interface ApiResponse {
  code: number;
  message: string;
  data: null;
}

@Catch() // 不传参数 = 捕获所有类型异常（如果想只捕 HttpException 可以写成 @Catch(HttpException)）
export class AllExceptionsFilter implements ExceptionFilter {
  // 用 NestJS 内置 Logger（不直接依赖 pino，避免循环依赖；pino 会接管它的输出）
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    // 切到 HTTP 上下文（NestJS 也支持 WS、RPC，这里本项目只跑 HTTP）
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // 计算最终 HTTP 状态码 + 业务 code + 给用户看的 message
    let status: number;
    let body: ApiResponse;

    if (exception instanceof HttpException) {
      // 业务异常：状态码以异常自己声明的为准
      status = exception.getStatus();
      const resp = exception.getResponse();

      // 业务消息提取：
      //   - 多数字段校验失败时 resp 是 { statusCode, message: string[], error }
      //   - 单条错误时 resp 是字符串（throw new NotFoundException('xxx') 时）
      //   - 也可能用户自定义对象，按 message 字段取
      let message: string;
      if (typeof resp === 'string') {
        message = resp;
      } else if (
        resp !== null &&
        typeof resp === 'object' &&
        'message' in (resp as Record<string, unknown>)
      ) {
        const m = (resp as Record<string, unknown>).message;
        message = Array.isArray(m) ? m.join('; ') : String(m);
      } else {
        message = exception.message;
      }

      body = {
        code: status,       // 业务 code 直接复用 HTTP 状态码，便于前端判断
        message,
        data: null,
      };
    } else {
      // 未知系统异常：统一返回 500，堆栈不写进响应体（避免泄露内部信息）
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      body = {
        code: status,
        message: 'Internal server error',
        data: null,
      };

      // 用 error 级别记录：包含完整堆栈，便于在日志系统里追溯
      // 注意：在生产环境，response 体里看不到这些，但日志里能看到
      this.logger.error(
        `Unhandled exception: ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    // 把统一格式的响应体写回 Express Response
    response.status(status).json(body);
  }
}
