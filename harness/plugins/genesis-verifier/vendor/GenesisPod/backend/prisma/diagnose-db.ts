/**
 * Database connection diagnostic script
 * Run this to debug Railway deployment issues
 */

import { PrismaClient } from "@prisma/client";
import * as dns from "dns";
import * as net from "net";

async function diagnose() {
  console.log("🔍 Starting database connection diagnostics...\n");

  // 1. Check environment variables
  console.log("📋 Environment Variables:");
  console.log(`NODE_ENV: ${process.env.NODE_ENV || "not set"}`);
  console.log(`PORT: ${process.env.PORT || "not set"}`);

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    // Parse the URL
    try {
      const url = new URL(dbUrl);
      console.log(`DATABASE_URL (parsed):`);
      console.log(`  - Protocol: ${url.protocol}`);
      console.log(`  - Host: ${url.hostname}`);
      console.log(`  - Port: ${url.port}`);
      console.log(`  - Database: ${url.pathname.slice(1)}`);
      console.log(`  - Username: ${url.username}`);
      console.log(`  - Password: ${url.password ? "****" : "not set"}`);
    } catch (e) {
      console.error(`  ❌ Failed to parse DATABASE_URL: ${e}`);
    }
  } else {
    console.error(`  ❌ DATABASE_URL is not set!`);
    process.exit(1);
  }

  // 2. DNS resolution test
  const hostname = new URL(dbUrl).hostname;
  const port = parseInt(new URL(dbUrl).port || "5432", 10);
  console.log(`\n🌐 DNS Resolution for ${hostname}:`);
  try {
    const addresses = await dns.promises.resolve(hostname);
    console.log(`  IPv4 (A records): ${JSON.stringify(addresses)}`);
  } catch (e: unknown) {
    console.log(
      `  IPv4 (A records): FAILED - ${e instanceof Error ? e.message : e}`,
    );
  }
  try {
    const addresses6 = await dns.promises.resolve6(hostname);
    console.log(`  IPv6 (AAAA records): ${JSON.stringify(addresses6)}`);
  } catch (e: unknown) {
    console.log(
      `  IPv6 (AAAA records): FAILED - ${e instanceof Error ? e.message : e}`,
    );
  }
  try {
    const all = await dns.promises.lookup(hostname, { all: true });
    console.log(`  dns.lookup (all): ${JSON.stringify(all)}`);
  } catch (e: unknown) {
    console.log(`  dns.lookup: FAILED - ${e instanceof Error ? e.message : e}`);
  }

  // 3. Raw TCP connection test
  console.log(`\n🔗 TCP Connection test to ${hostname}:${port}:`);
  await new Promise<void>((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(5000);
    socket.on("connect", () => {
      console.log(
        `  TCP connect: SUCCESS (${socket.remoteAddress}:${socket.remotePort}, family: ${socket.remoteFamily})`,
      );
      socket.destroy();
      resolve();
    });
    socket.on("timeout", () => {
      console.log(`  TCP connect: TIMEOUT after 5s`);
      socket.destroy();
      resolve();
    });
    socket.on("error", (err) => {
      console.log(`  TCP connect: FAILED - ${err.message}`);
      socket.destroy();
      resolve();
    });
    socket.connect(port, hostname);
  });

  console.log("\n🔌 Attempting Prisma connect...");

  const prisma = new PrismaClient({
    log: ["query", "info", "warn", "error"],
  });

  try {
    const startTime = Date.now();
    await prisma.$connect();
    const duration = Date.now() - startTime;
    console.log(`✅ Connection successful! (${duration}ms)`);

    // Test a simple query
    console.log("\n🧪 Testing database query...");
    const result = await prisma.$queryRaw<
      Array<{ version: string }>
    >`SELECT version()`;
    console.log(`✅ Database version: ${result[0]?.version}`);

    // Check migrations table
    console.log("\n📊 Checking migrations status...");
    const migrations = await prisma.$queryRaw<
      Array<{ migration_name: string; finished_at: Date | null }>
    >`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      ORDER BY started_at DESC
      LIMIT 5
    `;
    console.log(`Found ${migrations.length} recent migrations:`);
    migrations.forEach((m) => {
      console.log(
        `  - ${m.migration_name}: ${m.finished_at ? "✅ completed" : "⚠️  incomplete"}`,
      );
    });

    await prisma.$disconnect();
    console.log("\n✅ All diagnostics passed!");
    process.exit(0);
  } catch (error: unknown) {
    console.error(`\n❌ Connection failed!`);

    if (error instanceof Error) {
      console.error(`Error type: ${error.constructor.name}`);
      console.error(`Error message: ${error.message}`);

      // Prisma errors have a code property
      if (
        "code" in error &&
        typeof (error as Record<string, unknown>).code === "string"
      ) {
        console.error(`Error code: ${(error as Record<string, unknown>).code}`);
      }
    } else {
      console.error(`Error: ${String(error)}`);
    }

    // Additional diagnostics
    console.log("\n🔍 Additional diagnostics:");
    console.log(`Current working directory: ${process.cwd()}`);
    console.log(`Node version: ${process.version}`);
    console.log(`Platform: ${process.platform}`);

    await prisma.$disconnect();
    process.exit(1);
  }
}

diagnose().catch((error) => {
  console.error("❌ Diagnostic script failed:", error);
  process.exit(1);
});
