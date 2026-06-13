import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function clean() {
  console.log("Cleaning UI patrol test data...");

  // Delete in dependency order to respect foreign key constraints.
  // Use two-step pattern: find IDs first, then delete by ID.
  // Each operation is wrapped in try-catch to continue cleanup on partial failure.

  // 1. CollectionItems linked to [TEST] collections
  try {
    const testCollections = await prisma.collection.findMany({
      where: { name: { startsWith: "[TEST]" } },
      select: { id: true },
    });
    const collectionIds = testCollections.map((c) => c.id);
    if (collectionIds.length > 0) {
      const collectionItems = await prisma.collectionItem.deleteMany({
        where: { collectionId: { in: collectionIds } },
      });
      console.log(`  Deleted ${collectionItems.count} collection items`);
    } else {
      console.log("  No test collection items to delete");
    }
  } catch (error) {
    console.warn(
      "  Warning: Could not delete collection items:",
      error instanceof Error ? error.message : error,
    );
  }

  // 2. TopicMembers linked to [TEST] topics
  try {
    const testTopics = await prisma.topic.findMany({
      where: { name: { startsWith: "[TEST]" } },
      select: { id: true },
    });
    const topicIds = testTopics.map((t) => t.id);
    if (topicIds.length > 0) {
      const topicMembers = await prisma.topicMember.deleteMany({
        where: { topicId: { in: topicIds } },
      });
      console.log(`  Deleted ${topicMembers.count} topic members`);
    } else {
      console.log("  No test topic members to delete");
    }
  } catch (error) {
    console.warn(
      "  Warning: Could not delete topic members:",
      error instanceof Error ? error.message : error,
    );
  }

  // 3. Parent entities
  try {
    const collections = await prisma.collection.deleteMany({
      where: { name: { startsWith: "[TEST]" } },
    });
    console.log(`  Deleted ${collections.count} collections`);
  } catch (error) {
    console.warn(
      "  Warning: Could not delete collections:",
      error instanceof Error ? error.message : error,
    );
  }

  try {
    const topics = await prisma.topic.deleteMany({
      where: { name: { startsWith: "[TEST]" } },
    });
    console.log(`  Deleted ${topics.count} topics`);
  } catch (error) {
    console.warn(
      "  Warning: Could not delete topics:",
      error instanceof Error ? error.message : error,
    );
  }

  try {
    const resources = await prisma.resource.deleteMany({
      where: { title: { startsWith: "[TEST]" } },
    });
    console.log(`  Deleted ${resources.count} resources`);
  } catch (error) {
    console.warn(
      "  Warning: Could not delete resources:",
      error instanceof Error ? error.message : error,
    );
  }

  try {
    const researchTopics = await prisma.researchTopic.deleteMany({
      where: { name: { startsWith: "[TEST]" } },
    });
    console.log(`  Deleted ${researchTopics.count} research topics`);
  } catch (error) {
    console.warn(
      "  Warning: Could not delete research topics:",
      error instanceof Error ? error.message : error,
    );
  }

  try {
    const knowledgeBases = await prisma.knowledgeBase.deleteMany({
      where: { name: { startsWith: "[TEST]" } },
    });
    console.log(`  Deleted ${knowledgeBases.count} knowledge bases`);
  } catch (error) {
    console.warn(
      "  Warning: Could not delete knowledge bases:",
      error instanceof Error ? error.message : error,
    );
  }

  try {
    const writingProjects = await prisma.writingProject.deleteMany({
      where: { name: { startsWith: "[TEST]" } },
    });
    console.log(`  Deleted ${writingProjects.count} writing projects`);
  } catch (error) {
    console.warn(
      "  Warning: Could not delete writing projects:",
      error instanceof Error ? error.message : error,
    );
  }

  console.log("Done.");
}

clean()
  .catch((e) => {
    console.error("Clean failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
