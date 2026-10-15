# ─────────────────────────────────────────────────────────────
# 多阶段（multi-stage）Dockerfile
#
# 原注释：无（本项目生产化改造新增的部署文件）
# 对照 Java：等价于 Spring Boot 的 Dockerfile（mvn package 出一个 fat jar 再 COPY 进镜像），
#   但 Node 项目多一个"要不要把 node_modules 带进镜像"的问题，所以拆成多个阶段：
#     deps   → 装依赖（含 dev）
#     build  → 编译 TS，并裁掉 dev 依赖
#     runtime → 只拷贝"运行时真正需要的东西"，镜像更小、攻击面更小
# 前端(Vue3)：等价于你 `npm run build` 后把 dist/ 拷进 nginx 镜像；
#   这里是后端版——编译产物是 dist/，运行它需要 node + 生产版 node_modules。
#
# 好处：
#   1) 最终镜像里没有源码、没有 devDependencies、没有构建缓存（体积和泄露风险都更小）
#   2) 分层缓存：package.json 没变时，deps 这层能复用，CI 构建更快
# ─────────────────────────────────────────────────────────────

# ───────── 阶段 1：安装依赖（含 dev，供下一阶段编译用）─────────
FROM node:22-alpine AS deps
WORKDIR /app
# 只先拷这两个文件：它们不变时 Docker 能复用这一层缓存，不用每次重装依赖
COPY package.json package-lock.json ./
# --legacy-peer-deps：@nestjs/throttler / @nestjs/terminus / @nestjs/swagger 的
#   peer 依赖范围没声明 NestJS 12，npm 严格模式下会冲突报错，这里放宽校验（实测可用）
RUN npm ci --legacy-peer-deps

# ───────── 阶段 2：编译 TypeScript ─────────
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# nest build → 产出 dist/（ESM，入口 dist/main.js）
RUN npm run build
# 裁掉 devDependencies，只留生产依赖，供 runtime 阶段拷贝
RUN npm prune --omit=dev --legacy-peer-deps

# ───────── 阶段 3：运行时镜像（最小、非 root）─────────
FROM node:22-alpine AS runtime
# 生产环境标识：影响 pino 日志格式（JSON）、TypeORM 连接池大小、CORS 强校验
ENV NODE_ENV=production
WORKDIR /app

# 只拷运行时必需的三样东西：
#   node_modules（已裁成生产依赖）、dist（编译产物）、package.json（"type":"module" 注册表要它）
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# 用非 root 用户跑（node 镜像自带 uid=1000 的 node 用户）
# 对照 Java：类似容器里不用 root 跑 java -jar，降低被攻破后的影响面
USER node

# 声明监听端口（仅文档作用，实际映射在 docker-compose.yml / k8s 里配）
EXPOSE 3000

# 直接跑编译产物，不再经过 nest CLI（生产不需要 CLI 的 watch/dev 能力）
CMD ["node", "dist/main.js"]
