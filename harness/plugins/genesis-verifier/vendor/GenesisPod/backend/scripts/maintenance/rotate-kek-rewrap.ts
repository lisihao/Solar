/**
 * KEK 轮换 re-wrap 作业（加固方案 PR-6 / H5）。
 *
 * 信封加密的红利：轮换 KEK 只需 re-wrap 每条凭据的 DEK —— 解包旧 KEK 版本、用新版本
 * 重新包裹，**不碰明文 / 密文 / authTag / iv**。爆炸半径与停机都最小。
 *
 * 适用：env KEK provider 升级了版本（配了新的 SETTINGS_KEK_V{n} 且 SETTINGS_KEK_VERSION
 * 指向它）后，把所有 kek_version < currentVersion 的 v2 行 re-wrap 到当前版本。
 * （cloud KMS 同理，等 AwsKmsKekProvider 接入后复用本作业。）
 *
 * 安全：默认 DRY-RUN；--apply 才写库；unwrap 失败的行跳过计 errors（不写坏行）；
 * 幂等（只处理 kek_version<currentVersion 的 enc_version=2 行）。运行前做 DB 快照。
 *
 * 用法：
 *   SETTINGS_KEK_V1=... SETTINGS_KEK_V2=... SETTINGS_KEK_VERSION=2 \
 *     tsx scripts/rotate-kek-rewrap.ts            # dry-run
 *   ... tsx scripts/rotate-kek-rewrap.ts --apply  # 实际执行
 */
import { PrismaClient } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { EnvKekProvider } from "../src/modules/ai-infra/encryption/kek/env-kek-provider";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();
const kek = new EnvKekProvider({
  get: (key: string) => process.env[key],
} as unknown as ConfigService);

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

async function rewrapTable(
  table:
    | "userCredential"
    | "secret"
    | "userApiKey"
    | "secretKey"
    | "secretVersion",
): Promise<{ scanned: number; rewrapped: number; errors: number }> {
  const stats = { scanned: 0, rewrapped: 0, errors: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const model = (prisma as any)[table];
  const rows: Array<{
    id: string;
    wrappedDek: string | null;
    kekVersion: number | null;
  }> = await model.findMany({
    where: { encVersion: 2, kekVersion: { lt: kek.currentVersion } },
  });

  for (const row of rows) {
    stats.scanned++;
    if (!row.wrappedDek) {
      stats.errors++;
      continue;
    }
    try {
      const dek = await kek.unwrap(row.wrappedDek, row.kekVersion ?? 1);
      const { wrapped, kekVersion } = await kek.wrap(dek);
      if (APPLY) {
        await model.update({
          where: { id: row.id },
          data: { wrappedDek: wrapped, kekVersion },
        });
      }
      stats.rewrapped++;
    } catch (e) {
      log(`  [${table}] re-wrap FAILED id=${row.id}: ${(e as Error).message}`);
      stats.errors++;
    }
  }
  return stats;
}

async function main(): Promise<void> {
  log(
    `=== KEK rotation re-wrap (${APPLY ? "APPLY" : "DRY-RUN"}) → currentVersion=${kek.currentVersion} ===`,
  );
  for (const t of [
    "userCredential",
    "secret",
    "userApiKey",
    "secretKey",
    "secretVersion",
  ] as const) {
    const s = await rewrapTable(t);
    log(
      `${t}: scanned=${s.scanned} rewrapped=${s.rewrapped} errors=${s.errors}`,
    );
  }
  log("=== done ===");
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error("rotation failed:", e);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
