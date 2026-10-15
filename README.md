# nest-backend

NestJS + TypeORM + MySQL 后端服务。对照已有的 Java Spring Boot 项目 **test1-backend** 改写，
目前处于「生产级地基」阶段：业务功能待后续迭代，框架层的日志 / 异常 / 鉴权 / 限流 / 文档 / 健康检查 / 部署链路已就位。

> 代码注释统一采用三段式：**原注释 → 对照 Java → 前端(Vue3) 理解**，方便对照 Java 项目阅读。

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 框架 | NestJS 12（ESM，`"type": "module"`） |
| ORM | TypeORM + MySQL（`mysql2` 驱动） |
| 参数校验 | class-validator + class-transformer |
| 日志 | nestjs-pino / pino（开发 pretty，生产 JSON） |
| 认证 | 自研 Bearer Token（存库、可主动失效），密码 bcrypt 哈希 |
| 限流 | @nestjs/throttler |
| 安全 | helmet + CORS 白名单 |
| 文档 | @nestjs/swagger（`/api/docs`） |
| 健康检查 | @nestjs/terminus（含 DB 连通性） |
| 测试 | vitest + supertest |
| 代码检查 | oxlint + prettier |

---

## 快速开始

### 1. 环境要求

- Node.js **>= 22**，npm >= 10
- MySQL 8.x（默认 `localhost:3306`）

### 2. 安装依赖

```bash
npm ci --legacy-peer-deps
```

> 必须加 `--legacy-peer-deps`：`@nestjs/throttler` / `@nestjs/terminus` / `@nestjs/swagger`
> 声明的 peer 范围没有包含 NestJS 12，npm 严格模式下会报冲突。实测这些包在 NestJS 12 下运行正常。

### 3. 配置环境变量

```bash
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env
```

然后编辑 `.env` 填上真实的数据库连接信息。**`.env` 已在 `.gitignore` 中排除，不要提交。**

启动时会自动校验环境变量（见 [src/config/env.validation.ts](src/config/env.validation.ts)）：
必填项缺失、端口不是数字、生产环境 `CORS_ORIGINS` 为空 —— 都会直接启动失败并打印原因。

### 4. 启动

```bash
npm run start:dev     # 开发（watch 热重载）
npm run start         # 普通启动
npm run build && npm run start:prod   # 生产
```

- 接口基地址：`http://localhost:3000/api`
- 接口文档：`http://localhost:3000/api/docs`
- 健康检查：`http://localhost:3000/api/health`

---

## 目录结构

```
src/
├── main.ts                          # 启动入口：helmet / CORS / 全局管道·拦截器·过滤器 / Swagger
├── app.module.ts                    # 根模块：Config(含校验) / Logger(pino) / TypeORM / Throttler / 全局守卫
├── config/
│   └── env.validation.ts            # 环境变量启动校验（fail fast）
├── common/
│   ├── filters/all-exceptions.filter.ts      # 全局异常 → 统一错误格式
│   ├── interceptors/transform.interceptor.ts # 统一成功响应 { code, message, data }
│   └── guards/auth.guard.ts                  # 全局鉴权守卫（Bearer token）
├── decorators/public.decorator.ts   # @Public() 免鉴权标记
├── auth/                            # 登录 / 登出 / 当前用户
├── users/                           # 用户 CRUD（读公开，写需登录）
├── movies/                          # 电影查询（示例业务模块）
└── health/                          # 健康检查
test/
└── users.e2e-spec.ts                # 接口层 e2e（mock Service，不依赖数据库）
```

---

## 接口一览

统一响应格式（成功）：

```json
{ "code": 0, "message": "success", "data": { } }
```

失败时 `code` 复用 HTTP 状态码，`data` 为 `null`：

```json
{ "code": 404, "message": "User #9 not found", "data": null }
```

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | 公开 | 账号密码登录，返回 `{ token, expiresAt }` |
| POST | `/api/auth/logout` | 需 token | 登出（当前 token 立即失效） |
| GET | `/api/auth/me` | 需 token | 获取当前登录用户（自动剔除敏感字段） |
| GET | `/api/users` | 公开 | 查询所有用户 |
| GET | `/api/users/:id` | 公开 | 按 id 查询用户 |
| POST | `/api/users` | 公开（临时）⚠️ | 创建用户 |
| PATCH | `/api/users/:id` | 需 token | 更新用户（部分字段） |
| DELETE | `/api/users/:id` | 需 token | 软删除用户（`204`） |
| GET | `/api/movies` | 公开 | 查询所有电影 |
| GET | `/api/movies/:id` | 公开 | 按 id 查询电影 |
| GET | `/api/health` | 公开 | 健康检查（含 DB 连通性） |
| GET | `/api/docs` | 公开 | Swagger 交互式文档 |

> ⚠️ **上线前务必处理**：`POST /api/users` 目前标了 `@Public()`（方便"忘密码时自己建号"）。
> 生产环境请删除该 `@Public()`，改为"需登录 + 管理员角色"才能建账号，否则任意访客都能注册用户。

鉴权方式：登录拿到的 token，后续请求头带 `Authorization: Bearer <token>`。token 有效期 7 天，存在数据库里，登出即可立即失效。

---

## 环境变量

| 变量 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `NODE_ENV` | 否 | `development` | `development` / `production` / `test`。影响日志格式、连接池大小、CORS 强校验 |
| `PORT` | 否 | `3000` | HTTP 监听端口 |
| `CORS_ORIGINS` | 生产必填 | 空 | 允许的前端域名，逗号分隔。为空时放行所有来源（**生产环境为空会启动失败**） |
| `DB_HOST` | 是 | - | MySQL 主机 |
| `DB_PORT` | 是 | - | MySQL 端口 |
| `DB_USER` | 是 | - | MySQL 用户名 |
| `DB_PASSWORD` | 是 | - | MySQL 密码 |
| `DB_NAME` | 是 | - | 数据库名 |

生产模板见 [.env.production.example](.env.production.example)。

---

## npm 脚本

| 命令 | 作用 |
| --- | --- |
| `npm run build` | 编译 TS → `dist/` |
| `npm run start:dev` | 开发模式（watch） |
| `npm run start:prod` | 跑编译产物（生产） |
| `npm run lint` | oxlint 静态检查 |
| `npm run format` | prettier 格式化 |
| `npm run test` | 单元测试（vitest） |
| `npm run test:e2e` | 端到端测试（vitest + supertest） |
| `npm run test:cov` | 单元测试 + 覆盖率 |

测试说明：单测与 e2e 都把 Service / Repository 换成 mock，**不需要真实数据库**，因此可在 CI 上无依赖跑通。

---

## Docker 部署

```bash
docker compose up --build      # 一键拉起 app + mysql
```

- `docker compose` 里的密码是占位符（`change_me`），上线前务必替换或改用 `env_file: [.env]`。
- MySQL 未映射到宿主机端口（避免和本机 MySQL 抢 3306），应用通过 compose 内部网络用服务名 `mysql` 连接。
- 镜像为多阶段构建（见 [Dockerfile](Dockerfile)），最终镜像只含编译产物 + 生产依赖，并以非 root 用户运行。

---

## 生产上线清单

- [ ] `.env` 用生产值（`NODE_ENV=production`、强密码、`CORS_ORIGINS` 填前端域名）
- [ ] 删除 `POST /api/users` 上的 `@Public()`，并接入角色鉴权
- [ ] `synchronize` 保持 `false`（生产绝不自动改表结构）
- [ ] 数据库账号最小权限（不要用 root）
- [ ] 前面挂 HTTPS（反向代理 / 负载均衡），helmet 的 HSTS 才真正生效
- [ ] 日志接入采集（生产输出 JSON，可直接喂给 ELK / Loki）
- [ ] 健康检查 `/api/health` 接入 K8s 探针或负载均衡

---

## 相关文档

- 本轮生产化改造记录：[CHANGELOG.md](CHANGELOG.md)
- 基础框架搭建说明：[.trae/documents/搭建NestJS生产级基础框架.md](.trae/documents/搭建NestJS生产级基础框架.md)
