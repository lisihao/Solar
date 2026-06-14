const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  console.log("=== SLIDES SESSIONS ===");
  const sessions = await prisma.slidesSession.findMany({
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  sessions.forEach((s) => {
    console.log(
      `${s.id.slice(0, 8)}... | ${s.title?.slice(0, 30).padEnd(30)} | ${s.status}`,
    );
  });

  console.log("\n=== SLIDES CHECKPOINTS (Latest 10) ===");
  const checkpoints = await prisma.slidesCheckpoint.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { session: true },
  });

  checkpoints.forEach((c) => {
    const state = c.stateJson;
    const pagesCount = Array.isArray(state?.pages) ? state.pages.length : 0;
    const hasOutline = !!state?.outlinePlan;
    const outlineTitle = state?.outlinePlan?.title || "N/A";
    const firstPageHtml = state?.pages?.[0]?.html?.length || 0;

    console.log(
      `${c.id.slice(0, 8)}... | Session: ${c.session?.title?.slice(0, 20).padEnd(20)} | Type: ${c.type.padEnd(18)} | Pages: ${String(pagesCount).padStart(2)} | HTML: ${String(firstPageHtml).padStart(5)} | Outline: ${hasOutline ? outlineTitle?.slice(0, 15) : "NO"}`,
    );
  });

  // Find KANATA specifically
  console.log("\n=== SEARCHING FOR KANATA ===");
  const kanata = await prisma.slidesSession.findMany({
    where: { title: { contains: "KANATA", mode: "insensitive" } },
  });

  if (kanata.length > 0) {
    console.log("Found KANATA sessions:", kanata.length);
    for (const s of kanata) {
      console.log(`Session: ${s.id} | Title: ${s.title}`);

      const cps = await prisma.slidesCheckpoint.findMany({
        where: { sessionId: s.id },
        orderBy: { createdAt: "desc" },
      });

      console.log(`  Checkpoints: ${cps.length}`);
      cps.forEach((cp) => {
        const state = cp.stateJson;
        const pagesCount = Array.isArray(state?.pages) ? state.pages.length : 0;
        const pagesWithHtml = Array.isArray(state?.pages)
          ? state.pages.filter((p) => p.html && p.html.length > 0).length
          : 0;
        console.log(
          `  - ${cp.id.slice(0, 8)}... | ${cp.name?.slice(0, 30)} | Pages: ${pagesCount} (with HTML: ${pagesWithHtml})`,
        );
      });
    }
  } else {
    console.log("No KANATA sessions found");
  }
}

main()
  .catch((e) => console.error("Error:", e))
  .finally(() => prisma.$disconnect());
