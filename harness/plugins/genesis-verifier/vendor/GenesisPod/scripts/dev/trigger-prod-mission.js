#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * 一次性 dev 工具：用 prod admin user 触发一个 deep+thorough+ mission
 * 使用：DATABASE_URL=... JWT_SECRET=... node scripts/dev/trigger-prod-mission.js
 */
const { PrismaClient } = require("@prisma/client");
const jwt = require("jsonwebtoken");

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "hello@gens.team";
const JWT_SECRET = process.env.JWT_SECRET;
const API_BASE = process.env.API_BASE || "https://api.gens.team";

if (!JWT_SECRET) {
  console.error("JWT_SECRET required");
  process.exit(1);
}

(async () => {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({
      where: { email: ADMIN_EMAIL },
      select: { id: true, email: true, username: true },
    });
    if (!user) throw new Error(`admin user ${ADMIN_EMAIL} not found`);
    console.log(`admin user: id=${user.id} email=${user.email}`);

    const token = jwt.sign(
      { sub: user.id, email: user.email, username: user.username ?? "admin" },
      JWT_SECRET,
      { expiresIn: "1h" },
    );

    const body = {
      topic: "2026 年全球大模型推理成本下降趋势与企业 AI 落地策略",
      depth: "deep",
      language: "zh-CN",
      budgetProfile: "high",
      styleProfile: "executive",
      lengthProfile: "epic",
      audienceProfile: "executive",
      withFigures: true,
      auditLayers: "thorough+",
      concurrency: 4,
      viewMode: "continuous",
      maxCredits: 8000,
      budgetMultiplierOverride: 2.5,
    };

    console.log("triggering team/run with body:");
    console.log(JSON.stringify(body, null, 2));

    const res = await fetch(`${API_BASE}/api/v1/agent-playground/team/run`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    console.log(`status=${res.status}`);
    console.log(`body=${text}`);
    if (!res.ok) process.exit(2);
    const data = JSON.parse(text);
    console.log(`\nMISSION_ID=${data.missionId}\n`);
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error("fatal:", e.message);
  process.exit(1);
});
