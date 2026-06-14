#!/usr/bin/env ts-node
/**
 * 发布通知 CLI 脚本
 *
 * 使用方式：
 *   npx ts-node scripts/send-release-notification.ts --from v1.0.0 --to v1.1.0
 *   npx ts-node scripts/send-release-notification.ts --from v1.0.0 --to v1.1.0 --dry-run
 *
 * 参数：
 *   --from <tag>    起始版本 tag（必填）
 *   --to <tag>      目标版本 tag（必填）
 *   --dry-run       预览模式，不发送通知
 *   --help          显示帮助信息
 */

import { NestFactory } from "@nestjs/core";
import { Module, Logger } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { HttpModule } from "@nestjs/axios";
import { EventEmitterModule } from "@nestjs/event-emitter";
// PR-X46: relocated from backend/scripts/devops/ → infra/railway/scripts/.
// Imports go through backend/ since the script runs as a backend CLI
// (`npm run release:preview` in backend/).
import { PrismaModule } from "../../../backend/src/common/prisma/prisma.module";
import { ReleaseModule } from "../../../backend/src/modules/ai-infra/release/release.module";
import { ReleaseService } from "../../../backend/src/modules/ai-infra/release/release.service";
import { AiEngineModule } from "../../../backend/src/modules/ai-engine/ai-engine.module";

const logger = new Logger("ReleaseNotificationCLI");

/**
 * CLI 专用模块
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),
    EventEmitterModule.forRoot({
      global: true,
    }),
    HttpModule,
    PrismaModule,
    AiEngineModule,
    ReleaseModule,
  ],
})
class CLIModule {}

/**
 * 解析命令行参数
 */
function parseArgs(): {
  fromTag: string;
  toTag: string;
  dryRun: boolean;
  help: boolean;
} {
  const args = process.argv.slice(2);
  let fromTag = "";
  let toTag = "";
  let dryRun = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case "--from":
        fromTag = args[++i] || "";
        break;
      case "--to":
        toTag = args[++i] || "";
        break;
      case "--dry-run":
        dryRun = true;
        break;
      case "--help":
      case "-h":
        help = true;
        break;
    }
  }

  return { fromTag, toTag, dryRun, help };
}

/**
 * 显示帮助信息
 */
function showHelp(): void {
  console.log(`
发布通知 CLI 脚本

使用方式：
  npx ts-node scripts/send-release-notification.ts --from <tag> --to <tag> [options]

参数：
  --from <tag>    起始版本 tag（必填）
  --to <tag>      目标版本 tag（必填）
  --dry-run       预览模式，只生成发布说明，不发送通知
  --help, -h      显示帮助信息

示例：
  # 预览发布说明
  npx ts-node scripts/send-release-notification.ts --from v1.0.0 --to v1.1.0 --dry-run

  # 发送发布通知
  npx ts-node scripts/send-release-notification.ts --from v1.0.0 --to v1.1.0
`);
}

/**
 * 主函数
 */
async function main(): Promise<void> {
  const { fromTag, toTag, dryRun, help } = parseArgs();

  if (help) {
    showHelp();
    process.exit(0);
  }

  if (!fromTag || !toTag) {
    console.error("Error: --from 和 --to 参数是必填的\n");
    showHelp();
    process.exit(1);
  }

  logger.log("=".repeat(60));
  logger.log("发布通知 CLI");
  logger.log("=".repeat(60));
  logger.log(`从版本: ${fromTag}`);
  logger.log(`到版本: ${toTag}`);
  logger.log(`模式: ${dryRun ? "预览 (dry-run)" : "正式发送"}`);
  logger.log("=".repeat(60));

  try {
    // 创建 NestJS 应用
    const app = await NestFactory.createApplicationContext(CLIModule, {
      logger: ["error", "warn", "log"],
    });

    const releaseService = app.get(ReleaseService);

    // 执行发布流程
    const result = await releaseService.processRelease(fromTag, toTag, dryRun);

    // 输出结果
    logger.log("\n" + "=".repeat(60));
    logger.log("处理结果");
    logger.log("=".repeat(60));
    logger.log(`状态: ${result.success ? "成功" : "部分失败"}`);
    logger.log(`版本: ${result.version}`);
    logger.log(`模式: ${result.dryRun ? "预览" : "正式"}`);

    logger.log("\n发布说明:");
    logger.log(`  摘要: ${result.releaseNotes.summary}`);
    logger.log(`  亮点:`);
    result.releaseNotes.highlights.forEach((h, i) => {
      logger.log(`    ${i + 1}. ${h.title}: ${h.description}`);
    });
    logger.log(`  变更数量: ${result.releaseNotes.changes.length}`);

    if (!result.dryRun) {
      logger.log("\n通知发送:");
      logger.log(`  成功: ${result.notification.sent}`);
      logger.log(`  失败: ${result.notification.failed}`);
      if (result.notification.failedUsers?.length) {
        logger.log(`  失败用户: ${result.notification.failedUsers.join(", ")}`);
      }
    }

    logger.log("\n" + "=".repeat(60));

    // 输出完整 JSON（方便 CI/CD 解析）
    if (process.env.CI) {
      console.log("\n::group::Release Result JSON");
      console.log(JSON.stringify(result, null, 2));
      console.log("::endgroup::");
    }

    await app.close();
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    logger.error("发布通知处理失败", error);
    process.exit(1);
  }
}

// 执行主函数
main();
