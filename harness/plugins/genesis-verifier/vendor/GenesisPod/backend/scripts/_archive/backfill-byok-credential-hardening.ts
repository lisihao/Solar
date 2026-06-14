/**
 * BYOK 凭据加固 backfill（一次性，可重放）。
 *
 * 作用：secrets(系统) / user_api_keys / secret_keys / secret_versions 中 enc_version!=2
 *      的 legacy 行 → 原地升 v2（decrypt master → encryptEnvelope）。
 * 注：原 secrets(user)→user_credentials 迁移已随 W5（user_credentials 退役）移除。
 *
 * 安全：
 *  - 默认 DRY-RUN（只统计不写）；加 --apply 才真正写库。
 *  - 解密失败的行跳过并计入 errors（绝不写坏行 / 不删源行）。
 *  - 幂等：只处理 enc_version!=2 的行；重跑安全。
 *  - ★ 运行前务必先做数据库快照（方案 §7 回滚点）。
 *
 * 用法：
 *   tsx scripts/backfill-byok-credential-hardening.ts            # dry-run
 *   tsx scripts/backfill-byok-credential-hardening.ts --apply    # 实际执行
 */
import { PrismaClient } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { EncryptionService } from "../src/modules/ai-infra/encryption/encryption.service";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();
const encryption = new EncryptionService({
  get: (key: string) => process.env[key],
} as unknown as ConfigService);

interface Stats {
  scanned: number;
  upgraded: number;
  skipped: number;
  errors: number;
}
const newStats = (): Stats => ({
  scanned: 0,
  upgraded: 0,
  skipped: 0,
  errors: 0,
});

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

/** 原地把 legacy v1 行升 v2（master 解密 → 信封重加密）。 */
async function upgradeTable(
  table: "secret" | "userApiKey" | "secretKey" | "secretVersion",
): Promise<Stats> {
  const stats = newStats();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (prisma as any)[table];
  const rows: Array<{
    id: string;
    encryptedValue: string;
    iv: string;
    encVersion: number | null;
    userId?: string | null;
  }> = await model.findMany({ where: { encVersion: { not: 2 } } });

  for (const row of rows) {
    stats.scanned++;
    // secrets 系统行 userId=null 走 master；用户行用 per-user 加密，此处只升级系统行
    if (table === "secret" && row.userId) {
      stats.skipped++;
      continue;
    }
    const value = await encryption.decryptAny(row);
    if (value === null) {
      log(`  [${table}] decrypt FAILED id=${row.id}`);
      stats.errors++;
      continue;
    }
    if (!APPLY) {
      stats.upgraded++;
      continue;
    }
    const env = await encryption.encryptEnvelope(value);
    await model.update({
      where: { id: row.id },
      data: {
        encryptedValue: env.encryptedValue,
        iv: env.iv,
        authTag: env.authTag,
        wrappedDek: env.wrappedDek,
        encVersion: env.encVersion,
        kekVersion: env.kekVersion,
      },
    });
    stats.upgraded++;
  }
  return stats;
}

async function main(): Promise<void> {
  log(
    `=== BYOK credential hardening backfill (${APPLY ? "APPLY" : "DRY-RUN"}) ===`,
  );
  if (!APPLY) {
    log("DRY-RUN：仅统计，不写库。加 --apply 实际执行（务必先做 DB 快照）。");
  }

  for (const t of [
    "secret",
    "userApiKey",
    "secretKey",
    "secretVersion",
  ] as const) {
    const s = await upgradeTable(t);
    log(
      `${t} v1→v2: scanned=${s.scanned} upgraded=${s.upgraded} skipped=${s.skipped} errors=${s.errors}`,
    );
  }

  log("=== done ===");
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error("backfill failed:", e);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
