import { PrismaClient, ReadStatus } from "@prisma/client";

const prisma = new PrismaClient();

// ============ Fixed UUIDs (valid UUID v4 format) ============
export const TEST_USER_ID = "557be1bd-62cb-4125-a028-5ba740b66aca";

export const TEST_IDS = {
  // ResearchTopic
  RESEARCH_TOPIC_MACRO: "a0000001-0000-4000-8000-000000000001",
  RESEARCH_TOPIC_TECH: "a0000001-0000-4000-8000-000000000002",
  RESEARCH_TOPIC_COMPANY: "a0000001-0000-4000-8000-000000000003",

  // Resource
  RESOURCE_PAPER: "b0000001-0000-4000-8000-000000000001",
  RESOURCE_BLOG: "b0000001-0000-4000-8000-000000000002",
  RESOURCE_NEWS: "b0000001-0000-4000-8000-000000000003",

  // Collection
  COLLECTION: "c0000001-0000-4000-8000-000000000001",
  COLLECTION_ITEM: "c1000001-0000-4000-8000-000000000001",

  // Topic (AI Teams)
  TOPIC_PUBLIC: "d0000001-0000-4000-8000-000000000001",
  TOPIC_PRIVATE: "d0000001-0000-4000-8000-000000000002",
  TOPIC_MEMBER_1: "d1000001-0000-4000-8000-000000000001",
  TOPIC_MEMBER_2: "d1000001-0000-4000-8000-000000000002",

  // KnowledgeBase
  KNOWLEDGE_BASE: "e0000001-0000-4000-8000-000000000001",

  // WritingProject
  WRITING_PROJECT: "f0000001-0000-4000-8000-000000000001",
} as const;

// ============ Seed Functions ============

async function seedResearchTopics() {
  console.log("Seeding ResearchTopics...");

  // MACRO type
  await prisma.researchTopic.upsert({
    where: { id: TEST_IDS.RESEARCH_TOPIC_MACRO },
    create: {
      id: TEST_IDS.RESEARCH_TOPIC_MACRO,
      userId: TEST_USER_ID,
      name: "[TEST] US AI Macro Insights",
      description: "Test macro research topic for UI patrol",
      type: "MACRO",
      status: "ACTIVE",
      visibility: "PRIVATE",
      language: "en",
      topicConfig: {
        country: "US",
        industry: "AI",
        domain: "Technology",
        focusAreas: ["Policy", "Investment", "Innovation"],
      },
      refreshFrequency: "MANUAL",
    },
    update: {
      name: "[TEST] US AI Macro Insights",
      description: "Test macro research topic for UI patrol",
      status: "ACTIVE",
    },
  });

  // TECHNOLOGY type
  await prisma.researchTopic.upsert({
    where: { id: TEST_IDS.RESEARCH_TOPIC_TECH },
    create: {
      id: TEST_IDS.RESEARCH_TOPIC_TECH,
      userId: TEST_USER_ID,
      name: "[TEST] Quantum Computing Technology",
      description: "Test technology research topic for UI patrol",
      type: "TECHNOLOGY",
      status: "DRAFT",
      visibility: "PRIVATE",
      language: "en",
      topicConfig: {
        technology: "Quantum Computing",
        maturityLevel: "Emerging",
        applicationAreas: ["Cryptography", "Drug Discovery", "Optimization"],
      },
      refreshFrequency: "MANUAL",
    },
    update: {
      name: "[TEST] Quantum Computing Technology",
      description: "Test technology research topic for UI patrol",
      status: "DRAFT",
    },
  });

  // COMPANY type
  await prisma.researchTopic.upsert({
    where: { id: TEST_IDS.RESEARCH_TOPIC_COMPANY },
    create: {
      id: TEST_IDS.RESEARCH_TOPIC_COMPANY,
      userId: TEST_USER_ID,
      name: "[TEST] OpenAI Company Analysis",
      description: "Test company research topic for UI patrol",
      type: "COMPANY",
      status: "ACTIVE",
      visibility: "PRIVATE",
      language: "en",
      topicConfig: {
        companyName: "OpenAI",
        companyType: "AI Research Lab",
        industry: "Artificial Intelligence",
        foundedYear: 2015,
      },
      refreshFrequency: "MANUAL",
    },
    update: {
      name: "[TEST] OpenAI Company Analysis",
      description: "Test company research topic for UI patrol",
      status: "ACTIVE",
    },
  });

  console.log("✓ ResearchTopics seeded");
}

async function seedResources() {
  console.log("Seeding Resources...");

  // PAPER
  await prisma.resource.upsert({
    where: { id: TEST_IDS.RESOURCE_PAPER },
    create: {
      id: TEST_IDS.RESOURCE_PAPER,
      type: "PAPER",
      title: "[TEST] Deep Learning Survey Paper",
      abstract:
        "A comprehensive survey of deep learning techniques and applications",
      sourceUrl: "https://example.com/test-paper",
      publishedAt: new Date("2024-01-15"),
    },
    update: {
      title: "[TEST] Deep Learning Survey Paper",
      abstract:
        "A comprehensive survey of deep learning techniques and applications",
    },
  });

  // BLOG
  await prisma.resource.upsert({
    where: { id: TEST_IDS.RESOURCE_BLOG },
    create: {
      id: TEST_IDS.RESOURCE_BLOG,
      type: "BLOG",
      title: "[TEST] AI Engineering Best Practices",
      abstract: "Best practices for building production AI systems",
      sourceUrl: "https://example.com/test-blog",
      publishedAt: new Date("2024-06-20"),
    },
    update: {
      title: "[TEST] AI Engineering Best Practices",
      abstract: "Best practices for building production AI systems",
    },
  });

  // NEWS
  await prisma.resource.upsert({
    where: { id: TEST_IDS.RESOURCE_NEWS },
    create: {
      id: TEST_IDS.RESOURCE_NEWS,
      type: "NEWS",
      title: "[TEST] AI Industry Update 2026",
      abstract: "Latest developments in the AI industry",
      sourceUrl: "https://example.com/test-news",
      publishedAt: new Date("2026-01-30"),
    },
    update: {
      title: "[TEST] AI Industry Update 2026",
      abstract: "Latest developments in the AI industry",
    },
  });

  console.log("✓ Resources seeded");
}

async function seedCollections() {
  console.log("Seeding Collections...");

  // Collection
  await prisma.collection.upsert({
    where: { id: TEST_IDS.COLLECTION },
    create: {
      id: TEST_IDS.COLLECTION,
      userId: TEST_USER_ID,
      name: "[TEST] AI Research Collection",
      description: "Test collection for UI patrol",
      isPublic: false,
    },
    update: {
      name: "[TEST] AI Research Collection",
      description: "Test collection for UI patrol",
    },
  });

  // CollectionItem - link PAPER to collection
  await prisma.collectionItem.upsert({
    where: { id: TEST_IDS.COLLECTION_ITEM },
    create: {
      id: TEST_IDS.COLLECTION_ITEM,
      collectionId: TEST_IDS.COLLECTION,
      resourceId: TEST_IDS.RESOURCE_PAPER,
      note: "Important paper for research",
      position: 0,
      readStatus: ReadStatus.UNREAD,
    },
    update: {
      note: "Important paper for research",
    },
  });

  console.log("✓ Collections seeded");
}

async function seedTopics() {
  console.log("Seeding Topics (AI Teams)...");

  // PUBLIC Topic
  await prisma.topic.upsert({
    where: { id: TEST_IDS.TOPIC_PUBLIC },
    create: {
      id: TEST_IDS.TOPIC_PUBLIC,
      name: "[TEST] AI Research Discussion",
      description: "Public test topic for AI team discussions",
      type: "PUBLIC",
      createdById: TEST_USER_ID,
    },
    update: {
      name: "[TEST] AI Research Discussion",
      description: "Public test topic for AI team discussions",
    },
  });

  // PUBLIC Topic Member
  await prisma.topicMember.upsert({
    where: { id: TEST_IDS.TOPIC_MEMBER_1 },
    create: {
      id: TEST_IDS.TOPIC_MEMBER_1,
      topicId: TEST_IDS.TOPIC_PUBLIC,
      userId: TEST_USER_ID,
      role: "OWNER",
    },
    update: {
      role: "OWNER",
    },
  });

  // PRIVATE Topic
  await prisma.topic.upsert({
    where: { id: TEST_IDS.TOPIC_PRIVATE },
    create: {
      id: TEST_IDS.TOPIC_PRIVATE,
      name: "[TEST] Private Team Chat",
      description: "Private test topic for team discussions",
      type: "PRIVATE",
      createdById: TEST_USER_ID,
    },
    update: {
      name: "[TEST] Private Team Chat",
      description: "Private test topic for team discussions",
    },
  });

  // PRIVATE Topic Member
  await prisma.topicMember.upsert({
    where: { id: TEST_IDS.TOPIC_MEMBER_2 },
    create: {
      id: TEST_IDS.TOPIC_MEMBER_2,
      topicId: TEST_IDS.TOPIC_PRIVATE,
      userId: TEST_USER_ID,
      role: "OWNER",
    },
    update: {
      role: "OWNER",
    },
  });

  console.log("✓ Topics seeded");
}

async function seedKnowledgeBase() {
  console.log("Seeding KnowledgeBase...");

  await prisma.knowledgeBase.upsert({
    where: { id: TEST_IDS.KNOWLEDGE_BASE },
    create: {
      id: TEST_IDS.KNOWLEDGE_BASE,
      userId: TEST_USER_ID,
      name: "[TEST] AI Knowledge Base",
      description: "Test knowledge base for UI patrol",
      sourceType: "MANUAL",
      status: "READY",
      type: "PERSONAL",
    },
    update: {
      name: "[TEST] AI Knowledge Base",
      description: "Test knowledge base for UI patrol",
      status: "READY",
    },
  });

  console.log("✓ KnowledgeBase seeded");
}

async function seedWritingProject() {
  console.log("Seeding WritingProject...");

  await prisma.writingProject.upsert({
    where: { id: TEST_IDS.WRITING_PROJECT },
    create: {
      id: TEST_IDS.WRITING_PROJECT,
      ownerId: TEST_USER_ID,
      name: "[TEST] AI History Novel",
      description: "Test writing project about AI history",
      genre: "science-fiction",
      targetWords: 100000,
      currentWords: 15000,
      status: "WRITING",
      visibility: "PRIVATE",
    },
    update: {
      name: "[TEST] AI History Novel",
      description: "Test writing project about AI history",
      status: "WRITING",
    },
  });

  console.log("✓ WritingProject seeded");
}

// ============ Clean Functions ============

async function cleanTestData() {
  console.log("Cleaning test data...");

  try {
    // Delete in reverse order of dependencies
    await prisma.topicMember.deleteMany({
      where: {
        id: {
          in: [TEST_IDS.TOPIC_MEMBER_1, TEST_IDS.TOPIC_MEMBER_2],
        },
      },
    });
    console.log("✓ TopicMembers deleted");

    await prisma.topic.deleteMany({
      where: {
        id: {
          in: [TEST_IDS.TOPIC_PUBLIC, TEST_IDS.TOPIC_PRIVATE],
        },
      },
    });
    console.log("✓ Topics deleted");

    await prisma.collectionItem.deleteMany({
      where: { id: TEST_IDS.COLLECTION_ITEM },
    });
    console.log("✓ CollectionItems deleted");

    await prisma.collection.deleteMany({
      where: { id: TEST_IDS.COLLECTION },
    });
    console.log("✓ Collections deleted");

    await prisma.resource.deleteMany({
      where: {
        id: {
          in: [
            TEST_IDS.RESOURCE_PAPER,
            TEST_IDS.RESOURCE_BLOG,
            TEST_IDS.RESOURCE_NEWS,
          ],
        },
      },
    });
    console.log("✓ Resources deleted");

    await prisma.researchTopic.deleteMany({
      where: {
        id: {
          in: [
            TEST_IDS.RESEARCH_TOPIC_MACRO,
            TEST_IDS.RESEARCH_TOPIC_TECH,
            TEST_IDS.RESEARCH_TOPIC_COMPANY,
          ],
        },
      },
    });
    console.log("✓ ResearchTopics deleted");

    await prisma.knowledgeBase.deleteMany({
      where: { id: TEST_IDS.KNOWLEDGE_BASE },
    });
    console.log("✓ KnowledgeBase deleted");

    await prisma.writingProject.deleteMany({
      where: { id: TEST_IDS.WRITING_PROJECT },
    });
    console.log("✓ WritingProject deleted");

    console.log("\n✅ All test data cleaned successfully");
  } catch (error) {
    console.error("Error during cleanup:", error);
    throw error;
  }
}

// ============ Main Function ============

async function main() {
  const isCleanMode = process.argv.includes("--clean");

  try {
    if (isCleanMode) {
      console.log("🧹 Running in CLEAN mode\n");
      await cleanTestData();
    } else {
      console.log("🌱 Seeding UI Patrol test data\n");
      console.log(`Using demo user ID: ${TEST_USER_ID}\n`);

      await seedResearchTopics();
      await seedResources();
      await seedCollections();
      await seedTopics();
      await seedKnowledgeBase();
      await seedWritingProject();

      console.log("\n✅ All test data seeded successfully");
      console.log("\n📋 Test IDs created:");
      console.log(JSON.stringify(TEST_IDS, null, 2));
    }
  } catch (error) {
    console.error("\n❌ Error during seeding:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run main function
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
