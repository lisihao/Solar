import { Test, TestingModule } from "@nestjs/testing";
import axios from "axios";
import {
  HackernewsCommentsService,
  HNComment,
} from "../hackernews-comments.service";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("HackernewsCommentsService", () => {
  let service: HackernewsCommentsService;

  const mockStoryData = {
    id: 12345,
    by: "user1",
    title: "Test Story",
    type: "story",
    time: 1700000000,
    kids: [100, 101, 102, 103],
    score: 200,
  };

  const mockCommentData = {
    id: 100,
    by: "commenter1",
    text: "This is a great comment about <b>AI</b>",
    score: 50,
    time: 1700001000,
    kids: [200, 201],
    type: "comment",
  };

  const mockChildComment = {
    id: 200,
    by: "commenter2",
    text: "Reply to comment",
    score: 10,
    time: 1700002000,
    kids: [],
    type: "comment",
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [HackernewsCommentsService],
    }).compile();

    service = module.get<HackernewsCommentsService>(HackernewsCommentsService);
  });

  // =========================================================================
  // fetchTopComments
  // =========================================================================

  describe("fetchTopComments", () => {
    it("should fetch top comments for a story", async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes("/item/12345")) {
          return { data: mockStoryData };
        }
        if (url.includes("/item/100")) {
          return { data: { ...mockCommentData, kids: [] } };
        }
        if (url.includes("/item/101")) {
          return {
            data: {
              id: 101,
              by: "user2",
              text: "comment 2",
              score: 30,
              time: 1700001500,
              kids: [],
              type: "comment",
            },
          };
        }
        if (url.includes("/item/102")) {
          return {
            data: {
              id: 102,
              by: "user3",
              text: "comment 3",
              score: 20,
              time: 1700001600,
              kids: [],
              type: "comment",
            },
          };
        }
        return { data: null };
      });

      const comments = await service.fetchTopComments(12345, 3);

      expect(comments).toBeDefined();
      expect(comments.length).toBeGreaterThan(0);
      // Sorted by score descending
      if (comments.length > 1) {
        expect(comments[0].score).toBeGreaterThanOrEqual(comments[1].score);
      }
    });

    it("should return empty array when story has no comments", async () => {
      mockedAxios.get.mockResolvedValue({
        data: { ...mockStoryData, kids: undefined },
      });

      const comments = await service.fetchTopComments(12345);
      expect(comments).toEqual([]);
    });

    it("should return empty array when story has empty kids array", async () => {
      mockedAxios.get.mockResolvedValue({
        data: { ...mockStoryData, kids: [] },
      });

      const comments = await service.fetchTopComments(12345);
      expect(comments).toEqual([]);
    });

    it("should return empty array when story fetch fails", async () => {
      mockedAxios.get.mockRejectedValue(new Error("Network error"));

      const comments = await service.fetchTopComments(12345);
      expect(comments).toEqual([]);
    });

    it("should return empty array when story data is null", async () => {
      mockedAxios.get.mockResolvedValue({ data: null });

      const comments = await service.fetchTopComments(12345);
      expect(comments).toEqual([]);
    });

    it("should limit comments to the requested count", async () => {
      const storyWithManyKids = {
        ...mockStoryData,
        kids: [100, 101, 102, 103, 104, 105],
      };

      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes("/item/12345")) return { data: storyWithManyKids };
        const idMatch = url.match(/\/item\/(\d+)/);
        if (idMatch) {
          return {
            data: {
              id: parseInt(idMatch[1]),
              by: "user",
              text: "comment",
              score: 10,
              time: 1700001000,
              kids: [],
              type: "comment",
            },
          };
        }
        return { data: null };
      });

      const comments = await service.fetchTopComments(12345, 3);
      expect(comments.length).toBeLessThanOrEqual(3);
    });

    it("should fetch comments with nested replies", async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes("/item/12345")) {
          return { data: { ...mockStoryData, kids: [100] } };
        }
        if (url.includes("/item/100")) {
          return { data: mockCommentData }; // Has kids: [200, 201]
        }
        if (url.includes("/item/200")) {
          return { data: mockChildComment };
        }
        if (url.includes("/item/201")) {
          return {
            data: {
              id: 201,
              by: "user3",
              text: "another reply",
              score: 5,
              time: 1700002500,
              kids: [],
            },
          };
        }
        return { data: null };
      });

      const comments = await service.fetchTopComments(12345, 1, 2);

      expect(comments).toHaveLength(1);
      expect(comments[0].replies).toBeDefined();
    });
  });

  // =========================================================================
  // fetchItem retry logic
  // =========================================================================

  describe("retry logic", () => {
    it("should retry on failure and succeed", async () => {
      let attempts = 0;
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes("/item/12345")) {
          attempts++;
          if (attempts < 2) throw new Error("Temporary failure");
          return { data: { ...mockStoryData, kids: [] } };
        }
        return { data: null };
      });

      const comments = await service.fetchTopComments(12345);
      expect(comments).toEqual([]);
    }, 30000);

    it("should return null for comment after all retries fail", async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes("/item/12345")) {
          return { data: { ...mockStoryData, kids: [100] } };
        }
        // comment always fails
        throw new Error("Persistent failure");
      });

      const comments = await service.fetchTopComments(12345, 1);
      // Null comments are filtered out
      expect(comments).toHaveLength(0);
    }, 30000);
  });

  // =========================================================================
  // generateCommentsSummary
  // =========================================================================

  describe("generateCommentsSummary", () => {
    const mockComments: HNComment[] = [
      {
        id: 1,
        author: "user1",
        text: "Great article about AI and machine learning.",
        score: 100,
        timestamp: new Date(),
        depth: 0,
        childCount: 2,
        replies: [
          {
            id: 11,
            author: "user2",
            text: "I agree!",
            score: 20,
            timestamp: new Date(),
            depth: 1,
            childCount: 0,
          },
        ],
      },
      {
        id: 2,
        author: "user3",
        text: "Interesting perspective",
        score: 50,
        timestamp: new Date(),
        depth: 0,
        childCount: 0,
        replies: [],
      },
    ];

    it("should return empty string for empty comments", async () => {
      const result = await service.generateCommentsSummary([]);
      expect(result).toBe("");
    });

    it("should generate summary with comment count", async () => {
      const result = await service.generateCommentsSummary(mockComments);
      expect(result).toContain("2");
      expect(result).toContain("user1");
    });

    it("should include reply count when comments have replies", async () => {
      const result = await service.generateCommentsSummary(mockComments);
      expect(result).toContain("1 条回复");
    });

    it("should limit to 10 comments in summary", async () => {
      const manyComments: HNComment[] = Array.from({ length: 15 }, (_, i) => ({
        id: i + 1,
        author: `user${i + 1}`,
        text: `Comment ${i + 1}`,
        score: 10,
        timestamp: new Date(),
        depth: 0,
        childCount: 0,
        replies: [],
      }));

      const result = await service.generateCommentsSummary(manyComments);
      // Only first 10 authors should appear
      expect(result).toContain("user1");
      expect(result).toContain("user10");
      expect(result).not.toContain("user11");
    });

    it("should not include reply section when comment has no replies", async () => {
      const commentsNoReplies: HNComment[] = [
        {
          id: 1,
          author: "user1",
          text: "No replies here",
          score: 10,
          timestamp: new Date(),
          depth: 0,
          childCount: 0,
          replies: [],
        },
      ];

      const result = await service.generateCommentsSummary(commentsNoReplies);
      expect(result).not.toContain("条回复");
    });
  });

  // =========================================================================
  // HTML cleaning
  // =========================================================================

  describe("cleanCommentText (via generateCommentsSummary)", () => {
    it("should clean HTML tags from comment text", async () => {
      const comments: HNComment[] = [
        {
          id: 1,
          author: "user1",
          text: "<p>This is <b>bold</b> text with <a href='url'>link</a></p>",
          score: 10,
          timestamp: new Date(),
          depth: 0,
          childCount: 0,
          replies: [],
        },
      ];

      const result = await service.generateCommentsSummary(comments);
      expect(result).not.toContain("<p>");
      expect(result).not.toContain("<b>");
      expect(result).toContain("This is bold text with link");
    });

    it("should decode HTML entities", async () => {
      const comments: HNComment[] = [
        {
          id: 1,
          author: "user1",
          text: "&quot;quoted&quot; &amp; more &lt;special&gt; &#39;chars&#39;",
          score: 10,
          timestamp: new Date(),
          depth: 0,
          childCount: 0,
          replies: [],
        },
      ];

      const result = await service.generateCommentsSummary(comments);
      expect(result).toContain('"quoted"');
      expect(result).toContain("&");
      expect(result).toContain("<special>");
    });

    it("should truncate long comment text to 300 chars", async () => {
      const longText = "A".repeat(400);
      const comments: HNComment[] = [
        {
          id: 1,
          author: "user1",
          text: longText,
          score: 10,
          timestamp: new Date(),
          depth: 0,
          childCount: 0,
          replies: [],
        },
      ];

      const result = await service.generateCommentsSummary(comments);
      // The truncated text should include "..."
      expect(result).toContain("...");
    });

    it("should handle empty text gracefully", async () => {
      const comments: HNComment[] = [
        {
          id: 1,
          author: "user1",
          text: "",
          score: 10,
          timestamp: new Date(),
          depth: 0,
          childCount: 0,
          replies: [],
        },
      ];

      const result = await service.generateCommentsSummary(comments);
      expect(result).toBeDefined();
      expect(result).toContain("user1");
    });
  });

  // =========================================================================
  // integrateCommentsIntoContent
  // =========================================================================

  describe("integrateCommentsIntoContent", () => {
    it("should integrate comments into story content", async () => {
      const storyText = "This is the story content.";
      const comments: HNComment[] = [
        {
          id: 1,
          author: "user1",
          text: "Great story!",
          score: 20,
          timestamp: new Date(),
          depth: 0,
          childCount: 0,
          replies: [],
        },
      ];

      const result = await service.integrateCommentsIntoContent(
        storyText,
        comments,
      );

      expect(result).toContain(storyText);
      expect(result).toContain("---");
      expect(result).toContain("HackerNews");
      expect(result).toContain("user1");
    });

    it("should handle empty comments", async () => {
      const storyText = "Story content.";
      const result = await service.integrateCommentsIntoContent(storyText, []);

      expect(result).toContain(storyText);
      expect(result).toContain("---");
      // Empty summary
    });
  });

  // =========================================================================
  // Comment structure
  // =========================================================================

  describe("comment structure", () => {
    it("should create correct comment structure from API data", async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes("/item/12345")) {
          return { data: { ...mockStoryData, kids: [100] } };
        }
        if (url.includes("/item/100")) {
          return { data: { ...mockCommentData, kids: [] } };
        }
        return { data: null };
      });

      const comments = await service.fetchTopComments(12345, 1, 1);

      expect(comments[0]).toMatchObject({
        id: 100,
        author: "commenter1",
        score: 50,
        depth: 0,
      });
      expect(comments[0].timestamp).toBeInstanceOf(Date);
    });

    it("should handle deleted or null comments gracefully", async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes("/item/12345")) {
          return { data: { ...mockStoryData, kids: [100, 101] } };
        }
        if (url.includes("/item/100")) {
          return { data: null }; // null comment
        }
        if (url.includes("/item/101")) {
          return {
            data: {
              id: 101,
              by: "user",
              text: "Valid comment",
              score: 5,
              time: 1700001000,
              kids: [],
            },
          };
        }
        return { data: null };
      });

      const comments = await service.fetchTopComments(12345, 2, 1);
      // Null comment should be filtered out
      expect(comments.every((c) => c !== null)).toBe(true);
    });

    it("should use 'unknown' as author when by is missing", async () => {
      mockedAxios.get.mockImplementation(async (url: string) => {
        if (url.includes("/item/12345")) {
          return { data: { ...mockStoryData, kids: [100] } };
        }
        if (url.includes("/item/100")) {
          return {
            data: {
              id: 100,
              text: "Anonymous comment",
              score: 5,
              time: 1700001000,
              kids: [],
            },
          };
        }
        return { data: null };
      });

      const comments = await service.fetchTopComments(12345, 1, 1);
      expect(comments[0].author).toBe("unknown");
    });
  });
});
