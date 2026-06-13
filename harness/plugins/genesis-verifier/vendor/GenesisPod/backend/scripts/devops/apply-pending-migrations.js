/* eslint-disable no-console, @typescript-eslint/no-require-imports */
/**
 * Apply all pending Prisma migrations directly via SQL execution.
 * Workaround for `prisma migrate deploy` not finding migrations folder
 * when schema is multi-file (prisma/schema/*).
 */
const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

async function execSql(sql) {
  // Split on `;` at end-of-line and run each non-empty statement.
  // Preserve $$ ... $$ blocks as a single statement.
  const stmts = [];
  let buf = "";
  let inDollar = false;
  for (const line of sql.split(/\r?\n/)) {
    if (line.includes("$$")) inDollar = !inDollar;
    buf += line + "\n";
    const trim = buf.trimEnd();
    if (!inDollar && trim.endsWith(";")) {
      stmts.push(trim);
      buf = "";
    }
  }
  if (buf.trim()) stmts.push(buf.trim());
  for (const s of stmts) {
    if (!s || s.startsWith("--")) continue;
    await prisma.$executeRawUnsafe(s);
  }
}

async function main() {
  const applied = await prisma.$queryRawUnsafe(
    "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL",
  );
  const appliedSet = new Set(applied.map((r) => r.migration_name));
  const dir = "prisma/migrations";
  const all = fs
    .readdirSync(dir)
    .filter(
      (f) => fs.statSync(path.join(dir, f)).isDirectory() && f !== "manual",
    )
    .sort();
  const missing = all.filter((m) => !appliedSet.has(m));
  console.log("Missing:", missing.length);
  let ok = 0,
    fail = 0;
  for (const mig of missing) {
    const sqlPath = path.join(dir, mig, "migration.sql");
    if (!fs.existsSync(sqlPath)) {
      console.log("SKIP no sql:", mig);
      continue;
    }
    const sql = fs.readFileSync(sqlPath, "utf8");
    try {
      await execSql(sql);
      await prisma.$executeRawUnsafe(
        `INSERT INTO _prisma_migrations (id, checksum, migration_name, started_at, finished_at, applied_steps_count) VALUES (gen_random_uuid()::text, '0', '${mig}', NOW(), NOW(), 1)`,
      );
      ok++;
      console.log("OK:", mig);
    } catch (e) {
      fail++;
      const msg = String(e.message || e).slice(0, 250);
      console.log("FAIL:", mig, "—", msg);
    }
  }
  console.log(`done: ok=${ok} fail=${fail}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
