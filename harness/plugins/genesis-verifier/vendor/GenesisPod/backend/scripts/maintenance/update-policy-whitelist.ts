import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function updatePolicyWhitelist() {
  console.log("Updating POLICY whitelist...");

  // 查找现有的 POLICY 白名单
  const existing = await prisma.sourceWhitelist.findFirst({
    where: { resourceType: "POLICY" },
  });

  if (!existing) {
    console.log("No existing POLICY whitelist found, creating new one...");
  } else {
    console.log("Found existing POLICY whitelist:", existing.id);
  }

  const newDomains = [
    // 美国政府机构
    "whitehouse.gov",
    "*.whitehouse.gov",
    "congress.gov",
    "senate.gov",
    "house.gov",
    "federalregister.gov",
    "*.federalregister.gov",
    "gao.gov",
    "*.gao.gov",
    "cbo.gov",
    "crsreports.congress.gov",
    // 联邦机构
    "commerce.gov",
    "*.commerce.gov",
    "bis.doc.gov",
    "ustr.gov",
    "treasury.gov",
    "state.gov",
    "defense.gov",
    "*.defense.gov",
    "darpa.mil",
    "*.darpa.mil",
    "ai.mil",
    "energy.gov",
    "*.energy.gov",
    "nist.gov",
    "*.nist.gov",
    "nsf.gov",
    "*.nsf.gov",
    "ai.gov",
    "ftc.gov",
    "*.ftc.gov",
    // 智库和研究机构
    "brookings.edu",
    "*.brookings.edu",
    "cfr.org",
    "*.cfr.org",
    "csis.org",
    "*.csis.org",
    "rand.org",
    "*.rand.org",
    "cnas.org",
    "*.cnas.org",
    "heritage.org",
    "*.heritage.org",
    "aei.org",
    "*.aei.org",
    "carnegieendowment.org",
    "*.carnegieendowment.org",
    // 科技政策研究
    "itif.org",
    "*.itif.org",
    "cset.georgetown.edu",
    "*.georgetown.edu",
    "ash.harvard.edu",
    "*.harvard.edu",
    "cyber.harvard.edu",
    "law.stanford.edu",
    "*.stanford.edu",
    // 新闻和分析
    "politico.com",
    "*.politico.com",
    "axios.com",
    "*.axios.com",
    "thehill.com",
    "rollcall.com",
    // 国际组织
    "oecd.org",
    "*.oecd.org",
    "wto.org",
    "*.wto.org",
    "europa.eu",
    "*.europa.eu",
    // 行业组织
    "semiconductors.org",
    "*.semiconductors.org",
  ];

  if (existing) {
    // 更新现有白名单
    await prisma.sourceWhitelist.update({
      where: { id: existing.id },
      data: {
        allowedDomains: newDomains,
        updatedAt: new Date(),
      },
    });
    console.log(
      "✅ Updated POLICY whitelist with",
      newDomains.length,
      "domains",
    );
  } else {
    // 创建新白名单
    await prisma.sourceWhitelist.create({
      data: {
        resourceType: "POLICY",
        allowedDomains: newDomains,
        isActive: true,
        description:
          "US Tech Policy: White House, Congress, Federal Register, Commerce, Defense, Think tanks, Universities, etc.",
      },
    });
    console.log(
      "✅ Created new POLICY whitelist with",
      newDomains.length,
      "domains",
    );
  }

  // 验证
  const updated = await prisma.sourceWhitelist.findFirst({
    where: { resourceType: "POLICY" },
  });
  console.log(
    "\nVerification - POLICY whitelist now has",
    (updated?.allowedDomains as any[])?.length,
    "domains",
  );
  console.log(
    "federalregister.gov included:",
    (updated?.allowedDomains as any[])?.includes("federalregister.gov"),
  );
}

updatePolicyWhitelist()
  .catch((e) => {
    console.error("Error:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
