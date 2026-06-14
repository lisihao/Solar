/**
 * Encryption Diagnosis Script
 * Run with: railway run node scripts/diagnose-encryption.js
 */

const { PrismaClient } = require("@prisma/client");
const crypto = require("crypto");

async function main() {
  console.log("Starting encryption diagnosis...");

  const prisma = new PrismaClient();
  const key = (
    process.env.SETTINGS_ENCRYPTION_KEY || "deepdive-default-encryption-key!"
  )
    .padEnd(32, "0")
    .substring(0, 32);

  console.log("Encryption key (first 10 chars):", key.substring(0, 10) + "...");

  const settings = await prisma.systemSetting.findMany({
    where: { encrypted: true },
  });
  console.log("Found encrypted settings:", settings.length);

  const failed = [];
  const success = [];

  for (const s of settings) {
    try {
      const parts = s.value ? s.value.split(":") : null;
      if (!parts || parts.length !== 2) {
        failed.push({ key: s.key, reason: "invalid format" });
        continue;
      }
      const iv = Buffer.from(parts[0], "hex");
      const decipher = crypto.createDecipheriv(
        "aes-256-cbc",
        Buffer.from(key),
        iv,
      );
      decipher.update(parts[1], "hex", "utf8");
      decipher.final("utf8");
      success.push(s.key);
    } catch (e) {
      failed.push({ key: s.key, reason: e.message });
    }
  }

  console.log("\n=== Results ===");
  console.log("Successfully decrypted:", success.length);
  console.log("Failed to decrypt:", failed.length);

  if (failed.length > 0) {
    console.log("\nFailed settings:");
    failed.forEach((f) => console.log("  -", f.key, ":", f.reason));
  }

  await prisma.$disconnect();
  console.log("\nDiagnosis complete.");
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});
