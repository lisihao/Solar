/**
 * Boot Smoke Test —— DI 图实例化冒烟测试（针对编译后 dist 运行）
 *
 * 背景：CI 从不真正启动应用（单测大量 mock 模块），导致**循环导入引发的
 * NestJS DI 解析崩溃**（"Nest can't resolve dependencies" /
 * "metatype is not a constructor" / 注入到 undefined）能一路漏到生产环境
 * （2026-06-03 ContentFetchService 生产启动崩溃，hotfix #220）。
 *
 * 本脚本用 `NestFactory.create(AppModule)` 实例化**完整 provider 依赖图**——
 * 这正是 DI 循环崩溃触发的阶段——但**不调用 app.init()**，因此不会触发
 * onModuleInit 里的 Redis / 外部服务网络连接，保持轻量、确定、无需真实依赖。
 *
 * **为何跑 dist 而非 src**：tsx 的 resolveTsPaths 与本仓 `@/` tsconfig paths
 * 不兼容（Windows + Linux 均 ERR_INVALID_URL_SCHEME）。编译后的 dist 已由
 * tsc-alias 把 `@/` 重写为相对路径，无需任何运行时路径解析器——这也与生产
 * 真实启动路径（node dist/main.js）完全一致，是最忠实的冒烟测试。
 *
 * 退出码 0 = DI 图可完整解析；非 0 = 存在无法解析的依赖（疑似 facade barrel 循环）。
 */
const path = require("path");
const { NestFactory } = require("@nestjs/core");
// dist 相对本文件：backend/scripts/ci/ -> backend/dist
const { AppModule } = require(path.join(__dirname, "../../dist/app.module"));

async function main() {
  const started = Date.now();
  // logger:false 静默框架日志；create() 实例化所有 singleton provider（DI 解析在此发生），
  // 但不调用 onModuleInit（那是 app.init() 阶段），故不触发网络/DB 连接。
  // abortOnError:false —— 默认 NestFactory 的 ExceptionsZone 会在解析失败时直接
  // process.exit(1)（吞掉错误堆栈），改为让 create() reject，由下方 catch 打印完整堆栈。
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });
  await app.close();
  console.log(
    `BOOT SMOKE TEST PASSED — full DI graph resolved in ${Date.now() - started}ms`,
  );
  // ioredis 等客户端构造时可能起后台重连定时器，显式退出避免 job 挂起。
  process.exit(0);
}

main().catch((err) => {
  console.error("BOOT SMOKE TEST FAILED — DI graph could not be resolved:");
  console.error(err);
  process.exit(1);
});
