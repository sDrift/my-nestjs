// 用户模块（Module）
// NestJS 独有的概念，Java/Spring Boot 没有完全对应的，但作用类似 @Configuration + @ComponentScan
// 把本模块下的 Controller / Service / Entity 注册到 NestJS 容器
//
// 关键理解：@Module({...}) 这一段不"执行"任何东西，它只是把四个字段的清单存到类元数据里。
// 真正"按这份清单装配"的是 NestFactory——启动时读这份清单，决定：
//   - 谁能被本模块的代码注入（providers + imports 带来的）
//   - 谁要被路由扫描（controllers）
//   - 本模块对外暴露什么（exports，别的模块才能注入）
// 前端(Vue3)理解：像 defineStore('users', () => {...}) 返回的不是一个 store，
//   而是一份"如何造 store 的说明书"；组件调 useUsersStore() 时才真正按说明书造实例。
//   这里 @Module 是说明书，NestFactory 启动时才按它造 Controller/Service 实例。
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity.js';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';

@Module({
  // TypeOrmModule.forFeature([User]) 把 User 实体注册到 TypeORM，
  // 让本模块下的 Service 可以用 @InjectRepository(User) 注入 Repository<User>
  //
  // 机制：forFeature 是"动态模块"，它内部做的事是——
  //   读 User 类的 @Entity/@Column 元数据 → 在 IoC 容器里注册一个 token "Repository<User>"，
  //   这个 token 绑定了一个用 User 元数据武装过的 Repository 实例。
  //   后面 Service 里 @InjectRepository(User) 就是按这个 token 从容器取实例。
  // 前端(Vue3)理解：像 provide('repo:user', new Repository(User)) 把东西放进 inject context，
  //   子组件用 inject('repo:user') 取出来用。
  imports: [TypeOrmModule.forFeature([User])],

  // providers: 声明"本模块能造哪些实例"的清单
  // 这里写 UsersService，意味着容器知道"当谁要 UsersService 时，给我 new UsersService(...)"。
  // 用在哪：Controller 的 constructor(private svc: UsersService) 就是从这里取的。
  // 不写 providers 就 inject 不到，会报 Nest couldn't resolve dependencies of UsersService。
  // 前端(Vue3)理解：像 app.provide('usersService', new UsersService())——
  //   不 provide 出去，下游 inject 就拿不到。
  providers: [UsersService],

  // controllers: 声明"哪些类是 Controller，需要被路由扫描"
  // 启动时 NestJS 遍历这里每个类，读它的 @Get/@Post 装饰器，把方法注册成 Express 路由。
  // 不写 controllers，路由表里就没有 /api/users 这条记录，请求过去全是 404。
  // 前端(Vue3)理解：像 Vue Router 的 routes: [{ path:'/users', component: Users }]——
  //   不写进 routes，URL 输 /users 就是空白。
  controllers: [UsersController],

  // exports: 声明"本模块对外暴露哪些 Provider"，让别的模块能注入它
  // 这里 exports UsersService，意味着如果有 AuthModule 想用 UsersService（比如登录时查用户），
  //   AuthModule 只要在自己的 imports 里写 UsersModule，就能 inject UsersService。
  // 如果不 exports，UsersService 只在本模块内部能用，外面注入会报 undefined。
  // 前端(Vue3)理解：像 setup() 里 return { login }——return 出去的才能被模板/父组件用，
  //   没 return 的就是模块内部私有。这里 exports 就是"return 给别的模块"。
  exports: [UsersService],
})
export class UsersModule {}
