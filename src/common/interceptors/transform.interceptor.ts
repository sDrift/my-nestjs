// 统一响应格式拦截器
// 对照 Java 项目里常见的统一返回 Result<T> 类，以及 @ControllerAdvice 里包装返回值的逻辑
// 作用：把 Controller 返回的任意数据，统一包成 { code, message, data } 结构
// 例如 Controller 返回 [user1, user2]，最终前端收到的是：
//   { code: 0, message: 'success', data: [user1, user2] }
//
// 注意：本拦截器只处理成功情况（Controller 正常返回）；
// 异常情况（Controller 抛出 HttpException 或被拦截器过滤）由 AllExceptionsFilter 接管处理
//
// 前端(Vue3)理解：完全等价于 axios 的响应拦截器
//   axios.interceptors.response.use(r => ({ code: 0, message: 'success', data: r }))
// 区别是：这是"服务端版"——在 Controller 返回值发给网络之前就包好。
// 你前端再写一个 axios 拦截器去拆包，就能直接拿到 data 字段，省得每个接口都 try/catch
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

// 统一响应体类型 —— 对照 Java Result<T>
export interface ApiResponse<T> {
  code: number;       // 业务状态码：0 表示成功，非 0 表示业务错误
  message: string;    // 文案信息，成功为 'success'，失败为对应错误描述
  data: T | null;     // 实际业务数据，失败时为 null
}

@Injectable()
export class TransformInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T> | T>
{
  // 拦截器入口，对照 Java 里 HandlerInterceptor.afterCompletion 风格
  intercept(
    _context: ExecutionContext,        // 当前请求上下文（这里不需要读，但实现接口必须收下）
    next: CallHandler<T>,                // 调用下一个中间件/Controller 的句柄
  ): Observable<ApiResponse<T> | T> {
    // next.handle() 返回 RxJS Observable，里面是 Controller 的返回值
    // 用 pipe + map 在流上做映射，把原始数据包装成统一格式
    return next.handle().pipe(
      map((data) => {
        // 兼容流式（如分页）已包装对象的情况：如果 Controller 主动返回了带 code 字段的对象，
        // 说明可能已经手工包装或本身就是错误结果，直接透传避免二次包装
        // （这样以后扩展分页/封装返回也不需要改拦截器）
        if (
          data !== null &&
          typeof data === 'object' &&
          'code' in (data as Record<string, unknown>)
        ) {
          return data as T;
        }
        // 正常路径：把原始返回值塞进 data，套上 { code: 0, message: 'success' }
        return {
          code: 0,
          message: 'success',
          data,
        } as ApiResponse<T>;
      }),
    );
  }
}
