# 修改日志（CHANGELOG）

本文件记录每轮重要改动，方便回溯"改了什么、为什么改、改在哪"。

---

## 2026-10-15 · 生产化补全（业务逻辑除外）

### 背景

项目此前已完成"生产级地基"：统一响应/异常、pino 日志、helmet、CORS 白名单、限流、Swagger、
健康检查、认证（login/logout/me + 全局 AuthGuard + `@Public`）、Users 全套 CRUD。

本轮目标：把**除业务逻辑之外**还差的部分补齐，使其达到可部署上生产的水平；业务功能后续再写。

---

### 1. 配置分层与启动校验

| 文件 | 改动 |
| --- | --- |
| [src/config/env.validation.ts](src/config/env.validation.ts) | **新增**。用 class-validator 定义环境变量规则，`validateEnv()` 在启动时校验 |
| [src/app.module.ts](src/app.module.ts) | `ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })` 接入校验 |
| [.env.example](.env.example) | 重写为带分区注释的模板，明确"哪些会影响什么" |
| [.env.production.example](.env.production.example) | **新增**。生产环境变量模板 |
| [.gitignore](.gitignore) | 改为忽略 `.env.*`（保留 `*.example` 模板） |

**为什么**：以前缺环境变量要等到运行到某处才报错，定位成本高。现在**启动即校验、快速失败**：

- `DB_HOST` 等必填项缺失 → 启动失败，并打印是哪个字段、什么原因
- `PORT` / `DB_PORT` 不是数字 → 启动失败
- **`NODE_ENV=production` 且 `CORS_ORIGINS` 为空 → 直接启动失败**（空值会放行所有来源，是安全红线）

对照 Java：相当于 `@ConfigurationProperties` + `@Validated`。

---

### 2. TypeORM 连接池 / 超时 / 重试（按环境区分）

| 文件 | 改动 |
| --- | --- |
| [src/app.module.ts](src/app.module.ts) | TypeORM `useFactory` 增加 `extra` 连接池参数、`retryAttempts` / `retryDelay`，按 `NODE_ENV` 区分 |

新增运行参数：

- `connectionLimit`：生产 20 / 开发 10（防止流量一大把 MySQL 连接数打满）
- `waitForConnections: true` + `queueLimit: 0`：池满时请求排队而不是直接失败
- `connectTimeout: 10s`：建连超时，避免网络抖动时长期挂住
- `enableKeepAlive` / `keepAliveInitialDelay`：保持长连接，防中间设备掐空闲连接
- `retryAttempts`：生产 10 / 开发 3；`retryDelay: 3s`

对照 Java：HikariCP 的 `maximumPoolSize` / `connectionTimeout`。

---

### 3. 软删除统一改造（代码层，不动表结构）

| 文件 | 改动 |
| --- | --- |
| [src/users/user.entity.ts](src/users/user.entity.ts) | `deletedAt` 由普通 `@Column` 改为 **`@DeleteDateColumn`** |
| [src/users/users.service.ts](src/users/users.service.ts) | 去掉手写的 `deletedAt: IsNull()` 过滤；`remove()` 改用 `repo.softDelete(id)` |
| [src/auth/auth.service.ts](src/auth/auth.service.ts) | 同步去掉手写的 `IsNull()` 过滤（由 `@DeleteDateColumn` 自动过滤） |
| [src/movies/movie.entity.ts](src/movies/movie.entity.ts) | 同样改为 `@DeleteDateColumn`（保持一致） |
| [src/movies/movies.service.ts](src/movies/movies.service.ts) | 同步去掉手写过滤 |

**为什么**：以前每条查询都要手写 `WHERE deleted_at IS NULL`，漏写一处就会把已删除数据查出来。
改用 `@DeleteDateColumn` 后：

- `find` / `findOne` 等查询**自动追加** `deleted_at IS NULL`，业务代码不用再写（少写少错）
- 删除用 `repo.softDelete(id)` 一条 `UPDATE ... SET deleted_at = NOW()` 搞定，不用先查再存
- 需要看"回收站"时，查询传 `withDeleted: true` 即可
- 未来可用 `repo.restore(id)` 恢复

⚠️ **保持 `synchronize: false`，本次只改代码层，数据库表结构不变**。`deleted_at` 列本来就存在，装饰器只是改变 TypeORM 的读写策略。

对照 Java：Hibernate 的 `@SQLDelete` + `@Where(clause = "deleted_at IS NULL")`，或 MyBatis-Plus 的 `@TableLogic`。

---

### 4. 测试（此前 `test/` 为空）

| 文件 | 改动 |
| --- | --- |
| [src/users/users.service.spec.ts](src/users/users.service.spec.ts) | **新增**。10 个单元测试（Repository 用 mock） |
| [test/users.e2e-spec.ts](test/users.e2e-spec.ts) | **新增**。10 个接口层 e2e（supertest，Service 用 mock） |

覆盖点：

- 单测：查询排序、创建时的用户名冲突、**密码确实经 bcrypt 哈希后才入库（不存明文）**、PATCH 部分更新语义、改名冲突、软删除 `affected=0` 抛 404 …
- e2e：统一响应信封 `{ code, message, data }`、**敏感字段（`hashedPassword`/`currentToken`/`tokenExpiresAt`）不外泄**、
  `@Public` 免鉴权、无 token / token 无效 → 401、参数校验失败 → 400、删除 → 204、id 非数字 → 400

**设计要点**：单测和 e2e 全部把 Service / Repository 换成 mock，**不依赖真实数据库**，可在 CI 上无依赖跑通。

---

### 5. Docker

| 文件 | 改动 |
| --- | --- |
| [Dockerfile](Dockerfile) | **新增**。三阶段构建（deps → build → runtime），运行时非 root 用户 |
| [.dockerignore](.dockerignore) | **新增**。排除 `node_modules` / `.env` / 测试 等，减小上下文并防密码泄露 |
| [docker-compose.yml](docker-compose.yml) | **新增**。一键拉起 `app + mysql`，带健康检查与 `depends_on` |

要点：

- 镜像只含编译产物 + 生产依赖，体积小、攻击面小
- `.env` 绝不进镜像（密码泄露风险），运行时通过 compose / k8s 注入
- MySQL 不映射宿主机 3306，避免和本机 MySQL 抢端口
- compose 里的密码是占位符，上线前必须替换

---

### 6. CI（GitHub Actions）

| 文件 | 改动 |
| --- | --- |
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | **新增**。push / PR 触发：装依赖 → lint → build → 单测 → e2e |

全程不需要数据库（测试都用 mock）。

---

### 7. 文档与元信息

| 文件 | 改动 |
| --- | --- |
| [README.md](README.md) | **重写**（此前还是 NestJS 脚手架默认内容）：技术栈、快速开始、目录结构、接口清单、环境变量、脚本、Docker、生产上线清单 |
| [package.json](package.json) | 补 `description` / `author` / `version`(1.0.0)，加 `engines`（Node >= 22、npm >= 10） |

---

### 8. 顺带修复

| 文件 | 改动 |
| --- | --- |
| [src/auth/auth.controller.ts](src/auth/auth.controller.ts) | 删除未使用的 `UseGuards` import（`npm run lint` 会报警告） |
| [src/main.ts](src/main.ts#L152-L171) | **补齐未匹配路由的兜底 404**：此前 `GET /api/nope` 返回 Express 默认的纯文本 `Cannot GET /api/nope`（绕过异常过滤器），现统一返回 `{ code: 404, message, data: null }` |

**兜底 404 说明**：Nest 只把"注册过的路由"纳入自己的异常体系，未匹配任何路由的请求会掉到 Express 内置兜底处理器。
现于 `app.listen()` 之后挂一个中间件 —— Express 按注册顺序匹配，此时 Controller 与 Swagger 路由均已注册，
因此该中间件只会接住"前面都没匹配上"的请求，不会抢走正常路由，也不影响 `/api/docs`。

---

### 验证结果

| 检查 | 结果 |
| --- | --- |
| `npm run build` | ✅ 通过 |
| `npm run lint` | ✅ 0 error / 0 warning |
| `npm run test` | ✅ 10 passed |
| `npm run test:e2e` | ✅ 10 passed |
| 实际启动自测 | ✅ 服务正常拉起，`/api/health` DB up；鉴权 401 / 校验 400 / 未匹配路由 404 均为统一 JSON |

---

### 后续待办（业务 & 进阶）

1. **业务功能**：按 Java 项目 test1-backend 继续补齐业务接口与业务逻辑
2. **角色鉴权**：引入 `@Roles()` + `RolesGuard`，把 `POST /api/users` 收敛为管理员专属
3. **数据库迁移**：引入 TypeORM migration（替代 `synchronize` 的长期方案）
4. **可观测性**：接入 OpenTelemetry / Prometheus 指标
5. **配置分层进阶**：如需要多环境文件，可扩展为 `.env.development` / `.env.production` 按 `NODE_ENV` 加载

---

### ⚠️ 上线前必做

- [ ] `.env` 换成生产值（强密码、`CORS_ORIGINS` 填前端域名、`NODE_ENV=production`）
- [ ] 给 `POST /api/users` 去掉 `@Public()`（否则任何人都能注册账号）
- [ ] `synchronize` 保持 `false`
- [ ] 数据库账号最小权限，不用 root
- [ ] 前置 HTTPS（helmet 的 HSTS 才生效）
