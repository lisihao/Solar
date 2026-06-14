# Testing Guide - Content Enhancement Features

## 概述

本文档提供内容增强功能的完整测试指南，包括单元测试、集成测试和端到端测试。

## 测试环境设置

### 1. 测试依赖（已配置）

本项目已配置测试环境，无需额外安装依赖。

**后端测试栈:**

- Framework: Jest
- 工具: @nestjs/testing, ts-jest, supertest
- 覆盖率: 当前阈值 50%

**前端测试栈:**

- Framework: Vitest
- 工具: @testing-library/react, @testing-library/dom
- 环境: jsdom
- 覆盖率: 当前阈值 50%

### 2. 配置测试数据库

**backend/.env.test:**

```env
DATABASE_URL="postgresql://user:password@localhost:5432/genesis_test"
AI_SERVICE_URL="http://localhost:5001"
```

### 3. 测试数据库迁移

```bash
cd backend
DATABASE_URL="postgresql://user:password@localhost:5432/genesis_test" npx prisma migrate deploy
```

---

## 后端测试

### 单元测试

#### NotesService 测试

**位置:** `backend/src/notes/notes.service.spec.ts`

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { NotesService } from "./notes.service";
import { PrismaService } from "../prisma/prisma.service";

describe("NotesService", () => {
  let service: NotesService;
  let prisma: PrismaService;

  const mockPrismaService = {
    note: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    resource: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotesService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<NotesService>(NotesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("create", () => {
    it("should create a note", async () => {
      const createDto = {
        resourceId: "resource-1",
        title: "Test Note",
        content: "Test content",
      };

      const mockResource = { id: "resource-1", title: "Resource 1" };
      const mockNote = { id: "note-1", ...createDto, userId: "user-1" };

      mockPrismaService.resource.findUnique.mockResolvedValue(mockResource);
      mockPrismaService.note.create.mockResolvedValue(mockNote);

      const result = await service.create("user-1", createDto);

      expect(prisma.resource.findUnique).toHaveBeenCalledWith({
        where: { id: createDto.resourceId },
      });
      expect(prisma.note.create).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          ...createDto,
        },
        include: { resource: true },
      });
      expect(result).toEqual(mockNote);
    });

    it("should throw error if resource not found", async () => {
      mockPrismaService.resource.findUnique.mockResolvedValue(null);

      await expect(
        service.create("user-1", {
          resourceId: "invalid",
          title: "Test",
          content: "Test",
        }),
      ).rejects.toThrow("Resource not found");
    });
  });

  describe("findUserNotes", () => {
    it("should return user notes", async () => {
      const mockNotes = [
        { id: "note-1", title: "Note 1", userId: "user-1" },
        { id: "note-2", title: "Note 2", userId: "user-1" },
      ];

      mockPrismaService.note.findMany.mockResolvedValue(mockNotes);

      const result = await service.findUserNotes("user-1");

      expect(prisma.note.findMany).toHaveBeenCalledWith({
        where: { userId: "user-1" },
        include: { resource: true },
        orderBy: { updatedAt: "desc" },
      });
      expect(result).toEqual(mockNotes);
    });
  });

  describe("update", () => {
    it("should update a note", async () => {
      const updateDto = { title: "Updated Title" };
      const mockNote = { id: "note-1", userId: "user-1", ...updateDto };

      mockPrismaService.note.findUnique.mockResolvedValue(mockNote);
      mockPrismaService.note.update.mockResolvedValue(mockNote);

      const result = await service.update("note-1", "user-1", updateDto);

      expect(result).toEqual(mockNote);
    });

    it("should throw error if note not found", async () => {
      mockPrismaService.note.findUnique.mockResolvedValue(null);

      await expect(
        service.update("invalid", "user-1", { title: "Test" }),
      ).rejects.toThrow("Note not found");
    });
  });

  describe("requestAIExplanation", () => {
    it("should return AI explanation", async () => {
      const mockNote = {
        id: "note-1",
        userId: "user-1",
        resource: { title: "Resource 1" },
      };

      mockPrismaService.note.findUnique.mockResolvedValue(mockNote);

      // Mock fetch
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ response: "AI explanation" }),
      });

      const result = await service.requestAIExplanation("note-1", {
        text: "Test text",
      });

      expect(result.explanation).toBe("AI explanation");
    });

    it("should handle AI service error", async () => {
      mockPrismaService.note.findUnique.mockResolvedValue({
        id: "note-1",
        userId: "user-1",
      });

      global.fetch = jest.fn().mockRejectedValue(new Error("Network error"));

      const result = await service.requestAIExplanation("note-1", {
        text: "Test text",
      });

      expect(result.explanation).toBe("AI服务暂时不可用，请稍后再试");
    });
  });
});
```

#### CommentsService 测试

**位置:** `backend/src/comments/comments.service.spec.ts`

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { CommentsService } from "./comments.service";
import { PrismaService } from "../prisma/prisma.service";

describe("CommentsService", () => {
  let service: CommentsService;
  let prisma: PrismaService;

  const mockPrismaService = {
    comment: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<CommentsService>(CommentsService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe("createComment", () => {
    it("should create a top-level comment", async () => {
      const createDto = {
        resourceId: "resource-1",
        content: "Test comment",
      };

      const mockComment = {
        id: "comment-1",
        userId: "user-1",
        ...createDto,
      };

      mockPrismaService.comment.create.mockResolvedValue(mockComment);

      const result = await service.createComment("user-1", createDto);

      expect(prisma.comment.create).toHaveBeenCalled();
      expect(result).toEqual(mockComment);
    });

    it("should create a reply and increment parent reply count", async () => {
      const createDto = {
        resourceId: "resource-1",
        content: "Test reply",
        parentId: "comment-1",
      };

      const mockParent = {
        id: "comment-1",
        replyCount: 5,
      };

      mockPrismaService.comment.findUnique.mockResolvedValue(mockParent);
      mockPrismaService.comment.create.mockResolvedValue({
        id: "comment-2",
        ...createDto,
      });
      mockPrismaService.comment.update.mockResolvedValue({
        ...mockParent,
        replyCount: 6,
      });

      const result = await service.createComment("user-1", createDto);

      expect(prisma.comment.update).toHaveBeenCalledWith({
        where: { id: "comment-1" },
        data: { replyCount: { increment: 1 } },
      });
    });

    it("should throw error if parent not found", async () => {
      mockPrismaService.comment.findUnique.mockResolvedValue(null);

      await expect(
        service.createComment("user-1", {
          resourceId: "resource-1",
          content: "Test",
          parentId: "invalid",
        }),
      ).rejects.toThrow("Parent comment not found");
    });
  });

  describe("getResourceComments", () => {
    it("should return nested comments tree", async () => {
      const mockComments = [
        {
          id: "comment-1",
          content: "Top comment",
          replies: [
            {
              id: "comment-2",
              content: "Reply 1",
              replies: [
                {
                  id: "comment-3",
                  content: "Reply 2",
                  replies: [],
                },
              ],
            },
          ],
        },
      ];

      mockPrismaService.comment.findMany.mockResolvedValue(mockComments);

      const result = await service.getResourceComments("resource-1");

      expect(prisma.comment.findMany).toHaveBeenCalledWith({
        where: {
          resourceId: "resource-1",
          parentId: null,
        },
        include: expect.objectContaining({
          user: true,
          replies: expect.any(Object),
        }),
        orderBy: { createdAt: "desc" },
      });
      expect(result).toEqual(mockComments);
    });
  });

  describe("deleteComment", () => {
    it("should soft delete comment", async () => {
      const mockComment = {
        id: "comment-1",
        userId: "user-1",
        content: "Test comment",
        isDeleted: false,
      };

      mockPrismaService.comment.findUnique.mockResolvedValue(mockComment);
      mockPrismaService.comment.update.mockResolvedValue({
        ...mockComment,
        isDeleted: true,
        content: "[此评论已被删除]",
      });

      await service.deleteComment("comment-1", "user-1");

      expect(prisma.comment.update).toHaveBeenCalledWith({
        where: { id: "comment-1" },
        data: {
          isDeleted: true,
          content: "[此评论已被删除]",
        },
      });
    });
  });

  describe("upvoteComment", () => {
    it("should increment upvote count", async () => {
      const mockComment = {
        id: "comment-1",
        upvoteCount: 5,
      };

      mockPrismaService.comment.update.mockResolvedValue({
        ...mockComment,
        upvoteCount: 6,
      });

      const result = await service.upvoteComment("comment-1");

      expect(prisma.comment.update).toHaveBeenCalledWith({
        where: { id: "comment-1" },
        data: { upvoteCount: { increment: 1 } },
      });
      expect(result.upvoteCount).toBe(6);
    });
  });

  describe("getCommentStats", () => {
    it("should return comment statistics", async () => {
      mockPrismaService.comment.count
        .mockResolvedValueOnce(25) // total
        .mockResolvedValueOnce(10) // topLevel
        .mockResolvedValueOnce(15); // replies

      const result = await service.getCommentStats("resource-1");

      expect(result).toEqual({
        total: 25,
        topLevel: 10,
        replies: 15,
      });
    });
  });
});
```

### 运行单元测试

```bash
# 后端测试
cd backend
npm test

# 运行特定测试文件
npm test -- notes.service.spec.ts

# 快速测试（跳过慢速测试）
npm run test:quick

# 生成覆盖率报告
npm run test:coverage

# 前端测试
cd frontend
npm test

# 监听模式
npm run test:watch

# 生成覆盖率报告
npm run test:coverage
```

---

### 集成测试

#### Notes API 集成测试

**位置:** `backend/test/notes.e2e-spec.ts`

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { AppModule } from "./../src/app.module";
import { PrismaService } from "./../src/prisma/prisma.service";

describe("Notes API (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    prisma = app.get<PrismaService>(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    // 清理测试数据
    await prisma.note.deleteMany();
    await prisma.resource.deleteMany();
    await prisma.user.deleteMany();
  });

  describe("/api/v1/notes (POST)", () => {
    it("should create a note", async () => {
      // 创建测试资源
      const resource = await prisma.resource.create({
        data: {
          title: "Test Resource",
          type: "PDF",
          url: "https://example.com/test.pdf",
        },
      });

      const response = await request(app.getHttpServer())
        .post("/api/v1/notes")
        .send({
          resourceId: resource.id,
          title: "Test Note",
          content: "# Test Content",
        })
        .expect(201);

      expect(response.body).toHaveProperty("id");
      expect(response.body.title).toBe("Test Note");
      expect(response.body.content).toBe("# Test Content");
    });

    it("should return 400 if resource not found", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/notes")
        .send({
          resourceId: "invalid-id",
          title: "Test",
          content: "Test",
        })
        .expect(400);
    });
  });

  describe("/api/v1/notes/my (GET)", () => {
    it("should return user notes", async () => {
      // 创建测试数据
      const resource = await prisma.resource.create({
        data: { title: "Resource 1", type: "PDF", url: "https://..." },
      });

      await prisma.note.create({
        data: {
          userId: "test-user",
          resourceId: resource.id,
          title: "Note 1",
          content: "Content 1",
        },
      });

      const response = await request(app.getHttpServer())
        .get("/api/v1/notes/my")
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].title).toBe("Note 1");
    });
  });

  describe("/api/v1/notes/:id (PATCH)", () => {
    it("should update a note", async () => {
      const resource = await prisma.resource.create({
        data: { title: "Resource 1", type: "PDF", url: "https://..." },
      });

      const note = await prisma.note.create({
        data: {
          userId: "test-user",
          resourceId: resource.id,
          title: "Original Title",
          content: "Original Content",
        },
      });

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/notes/${note.id}`)
        .send({ title: "Updated Title" })
        .expect(200);

      expect(response.body.title).toBe("Updated Title");
      expect(response.body.content).toBe("Original Content");
    });
  });

  describe("/api/v1/notes/:id (DELETE)", () => {
    it("should delete a note", async () => {
      const resource = await prisma.resource.create({
        data: { title: "Resource 1", type: "PDF", url: "https://..." },
      });

      const note = await prisma.note.create({
        data: {
          userId: "test-user",
          resourceId: resource.id,
          title: "Test Note",
          content: "Test Content",
        },
      });

      await request(app.getHttpServer())
        .delete(`/api/v1/notes/${note.id}`)
        .expect(200);

      const deletedNote = await prisma.note.findUnique({
        where: { id: note.id },
      });
      expect(deletedNote).toBeNull();
    });
  });
});
```

### 运行集成测试

```bash
cd backend
npm run test:e2e
```

---

## 前端测试

### 组件测试

#### CommentInput 测试

**位置:** `frontend/components/__tests__/CommentInput.test.tsx`

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommentInput from '../CommentInput';

// Mock fetch
global.fetch = jest.fn();

describe('CommentInput', () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockClear();
  });

  it('renders comment input', () => {
    render(<CommentInput resourceId="resource-1" />);

    expect(screen.getByPlaceholderText('写下你的评论...')).toBeInTheDocument();
    expect(screen.getByText('评论')).toBeInTheDocument();
  });

  it('shows error if content is empty', async () => {
    render(<CommentInput resourceId="resource-1" />);

    const submitButton = screen.getByText('评论');
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('评论内容不能为空')).toBeInTheDocument();
    });
  });

  it('submits comment successfully', async () => {
    const mockOnCommentAdded = jest.fn();
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'comment-1', content: 'Test comment' }),
    });

    render(
      <CommentInput
        resourceId="resource-1"
        onCommentAdded={mockOnCommentAdded}
      />
    );

    const textarea = screen.getByPlaceholderText('写下你的评论...');
    await userEvent.type(textarea, 'Test comment');

    const submitButton = screen.getByText('评论');
    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/comments'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            resourceId: 'resource-1',
            content: 'Test comment',
          }),
        })
      );
      expect(mockOnCommentAdded).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'comment-1' })
      );
    });
  });

  it('shows cancel button when parentId is provided', () => {
    const mockOnCancel = jest.fn();
    render(
      <CommentInput
        resourceId="resource-1"
        parentId="comment-1"
        onCancel={mockOnCancel}
      />
    );

    const cancelButton = screen.getByText('取消');
    fireEvent.click(cancelButton);

    expect(mockOnCancel).toHaveBeenCalled();
  });
});
```

#### CommentItem 测试

**位置:** `frontend/components/__tests__/CommentItem.test.tsx`

```typescript
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CommentItem from '../CommentItem';

const mockComment = {
  id: 'comment-1',
  content: 'Test comment',
  userId: 'user-1',
  user: {
    id: 'user-1',
    username: 'john_doe',
    fullName: 'John Doe',
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  upvoteCount: 5,
  replyCount: 2,
  isEdited: false,
  isDeleted: false,
  replies: [],
};

describe('CommentItem', () => {
  it('renders comment content', () => {
    render(<CommentItem comment={mockComment} resourceId="resource-1" />);

    expect(screen.getByText('Test comment')).toBeInTheDocument();
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument(); // upvote count
  });

  it('shows reply input when reply button clicked', () => {
    render(<CommentItem comment={mockComment} resourceId="resource-1" />);

    const replyButton = screen.getByText('回复');
    fireEvent.click(replyButton);

    expect(screen.getByPlaceholderText(/回复 @john_doe/)).toBeInTheDocument();
  });

  it('enters edit mode when edit button clicked', () => {
    render(<CommentItem comment={mockComment} resourceId="resource-1" />);

    const editButton = screen.getByText('编辑');
    fireEvent.click(editButton);

    expect(screen.getByDisplayValue('Test comment')).toBeInTheDocument();
    expect(screen.getByText('保存')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();
  });

  it('upvotes comment', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({ ok: true });

    render(<CommentItem comment={mockComment} resourceId="resource-1" />);

    const upvoteButton = screen.getByRole('button', { name: /5/ });
    fireEvent.click(upvoteButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/upvote'),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('shows deleted state', () => {
    const deletedComment = { ...mockComment, isDeleted: true };
    render(<CommentItem comment={deletedComment} resourceId="resource-1" />);

    expect(screen.getByText('[此评论已被删除]')).toBeInTheDocument();
    expect(screen.queryByText('Test comment')).not.toBeInTheDocument();
  });

  it('renders nested replies', () => {
    const commentWithReplies = {
      ...mockComment,
      replies: [
        {
          ...mockComment,
          id: 'comment-2',
          content: 'Reply comment',
          replies: [],
        },
      ],
    };

    render(
      <CommentItem comment={commentWithReplies} resourceId="resource-1" />
    );

    expect(screen.getByText('Test comment')).toBeInTheDocument();
    expect(screen.getByText('Reply comment')).toBeInTheDocument();
  });
});
```

### 运行前端测试

```bash
cd frontend

# 运行所有测试
npm test

# 监听模式（开发时推荐）
npm run test:watch

# 生成覆盖率报告
npm run test:coverage

# CI 环境运行
npm run test:ci
```

---

## 端到端 (E2E) 测试

### 使用 Playwright

**安装:**

```bash
cd frontend
npm install --save-dev @playwright/test
npx playwright install
```

**配置:** `frontend/playwright.config.ts`

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  use: {
    baseURL: "http://localhost:3000",
  },
  webServer: {
    command: "npm run dev",
    port: 3000,
  },
});
```

### E2E 测试用例

**位置:** `frontend/e2e/notes.spec.ts`

```typescript
import { test, expect } from "@playwright/test";

test.describe("Notes Feature", () => {
  test("create and edit note", async ({ page }) => {
    // 导航到资源详情页
    await page.goto("/resources/test-resource-id");

    // 等待 ResourceDetailPanel 加载
    await expect(page.locator("text=笔记")).toBeVisible();

    // 输入笔记标题
    await page.fill('[placeholder="笔记标题"]', "My Test Note");

    // 输入笔记内容
    await page.fill(
      '[placeholder="开始记笔记..."]',
      "# Chapter 1\n\nTest content",
    );

    // 保存笔记
    await page.click("text=保存");

    // 验证保存成功
    await expect(page.locator("text=保存成功")).toBeVisible();

    // 切换到 AI 助手标签
    await page.click("text=AI助手");

    // 请求 AI 解释
    await page.fill('[placeholder="输入要解释的文本"]', "Test content");
    await page.click("text=请求解释");

    // 等待 AI 响应
    await expect(page.locator(".ai-explanation")).toBeVisible({
      timeout: 10000,
    });
  });

  test("view notes in library", async ({ page }) => {
    // 导航到图书馆页面
    await page.goto("/library");

    // 等待笔记列表加载
    await expect(page.locator("text=我的笔记")).toBeVisible();

    // 验证笔记显示
    await expect(page.locator(".note-item").first()).toBeVisible();

    // 点击笔记查看详情
    await page.click(".note-item:first-child");

    // 验证导航到笔记详情
    await expect(page).toHaveURL(/\/resources\//);
  });
});
```

**位置:** `frontend/e2e/comments.spec.ts`

```typescript
import { test, expect } from "@playwright/test";

test.describe("Comments Feature", () => {
  test("post and reply to comment", async ({ page }) => {
    // 导航到资源详情页
    await page.goto("/resources/test-resource-id");

    // 切换到评论标签
    await page.click("text=评论");

    // 发表评论
    await page.fill(
      '[placeholder="写下你的评论..."]',
      "This is a great resource!",
    );
    await page.click("text=评论");

    // 验证评论显示
    await expect(page.locator("text=This is a great resource!")).toBeVisible();

    // 点击回复按钮
    await page.click("text=回复");

    // 输入回复内容
    await page.fill('[placeholder*="回复 @"]', "I agree!");
    await page.click("text=回复", { nth: 1 });

    // 验证回复显示
    await expect(page.locator("text=I agree!")).toBeVisible();
  });

  test("edit and delete comment", async ({ page }) => {
    await page.goto("/resources/test-resource-id");
    await page.click("text=评论");

    // 发表评论
    await page.fill('[placeholder="写下你的评论..."]', "Original comment");
    await page.click("text=评论");

    // 编辑评论
    await page.click("text=编辑");
    await page.fill("textarea", "Updated comment");
    await page.click("text=保存");

    // 验证更新
    await expect(page.locator("text=Updated comment")).toBeVisible();
    await expect(page.locator("text=(已编辑)")).toBeVisible();

    // 删除评论
    page.on("dialog", (dialog) => dialog.accept());
    await page.click("text=删除");

    // 验证软删除
    await expect(page.locator("text=[此评论已被删除]")).toBeVisible();
  });

  test("upvote comment", async ({ page }) => {
    await page.goto("/resources/test-resource-id");
    await page.click("text=评论");

    // 找到点赞按钮
    const upvoteButton = page.locator('button:has-text("0")').first();
    await upvoteButton.click();

    // 验证点赞数增加
    await expect(page.locator("text=1").first()).toBeVisible();
  });
});
```

### 运行 E2E 测试

```bash
cd frontend
npx playwright test

# 运行特定测试
npx playwright test notes.spec.ts

# 调试模式
npx playwright test --debug

# 生成报告
npx playwright test --reporter=html
```

---

## 性能测试

### 使用 k6 进行负载测试

**安装 k6:**

```bash
# macOS
brew install k6

# Windows
choco install k6

# Linux
sudo apt-get install k6
```

**测试脚本:** `backend/test/load/notes.js`

```javascript
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "30s", target: 10 }, // 10用户30秒
    { duration: "1m", target: 50 }, // 50用户1分钟
    { duration: "30s", target: 0 }, // 逐渐降到0
  ],
};

const BASE_URL = "http://localhost:4000/api/v1";

export default function () {
  // 创建笔记
  let createRes = http.post(
    `${BASE_URL}/notes`,
    JSON.stringify({
      resourceId: "test-resource-id",
      title: "Load Test Note",
      content: "# Test Content",
    }),
    { headers: { "Content-Type": "application/json" } },
  );

  check(createRes, {
    "note created": (r) => r.status === 201,
    "response time < 500ms": (r) => r.timings.duration < 500,
  });

  let noteId = JSON.parse(createRes.body).id;

  sleep(1);

  // 获取笔记
  let getRes = http.get(`${BASE_URL}/notes/${noteId}`);

  check(getRes, {
    "note retrieved": (r) => r.status === 200,
    "response time < 200ms": (r) => r.timings.duration < 200,
  });

  sleep(1);

  // 更新笔记
  let updateRes = http.patch(
    `${BASE_URL}/notes/${noteId}`,
    JSON.stringify({ title: "Updated Title" }),
    { headers: { "Content-Type": "application/json" } },
  );

  check(updateRes, {
    "note updated": (r) => r.status === 200,
    "response time < 300ms": (r) => r.timings.duration < 300,
  });

  sleep(1);
}
```

**运行负载测试:**

```bash
k6 run backend/test/load/notes.js
```

---

## 测试覆盖率目标

| 类型     | 目标覆盖率    |
| -------- | ------------- |
| 单元测试 | ≥ 80%         |
| 集成测试 | ≥ 70%         |
| E2E 测试 | 关键路径 100% |

---

## 持续集成 (CI)

### GitHub Actions 配置

**位置:** `.github/workflows/test.yml`

```yaml
name: Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  backend-test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: genesis_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: |
          cd backend
          npm ci

      - name: Run migrations
        run: |
          cd backend
          npx prisma migrate deploy
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/genesis_test

      - name: Run tests
        run: |
          cd backend
          npm test -- --coverage
        env:
          DATABASE_URL: postgresql://postgres:postgres@localhost:5432/genesis_test

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./backend/coverage/lcov.info

  frontend-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: |
          cd frontend
          npm ci

      - name: Run tests
        run: |
          cd frontend
          npm test -- --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./frontend/coverage/lcov.info

  e2e-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: "18"

      - name: Install dependencies
        run: |
          cd frontend
          npm ci
          npx playwright install --with-deps

      - name: Run E2E tests
        run: |
          cd frontend
          npx playwright test

      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: playwright-report
          path: frontend/playwright-report/
```

---

## 测试最佳实践

### 1. 测试命名

```typescript
// Good
describe("NotesService", () => {
  describe("create", () => {
    it("should create a note with valid data", () => {});
    it("should throw error if resource not found", () => {});
  });
});

// Bad
describe("test", () => {
  it("works", () => {});
});
```

### 2. 测试隔离

```typescript
// 每个测试前清理数据
beforeEach(async () => {
  await prisma.note.deleteMany();
});

// 使用独立的测试数据
const createTestNote = () => ({
  title: `Test Note ${Date.now()}`,
  content: "Test content",
});
```

### 3. Mock 外部依赖

```typescript
// Mock AI service
jest.mock("@/lib/ai-service", () => ({
  getExplanation: jest.fn().mockResolvedValue("Mock explanation"),
}));
```

### 4. 断言具体内容

```typescript
// Good
expect(response.body).toEqual({
  id: expect.any(String),
  title: "Test Note",
  content: "Test content",
  createdAt: expect.any(String),
});

// Bad
expect(response.status).toBe(200);
```

---

## 总结

完整的测试策略包括：

✅ 单元测试（Services）
✅ 集成测试（API endpoints）
✅ 组件测试（React components）
✅ E2E 测试（用户流程）
✅ 负载测试（性能）
✅ CI/CD 集成

**目标覆盖率:**

- 后端：80%+
- 前端：70%+
- 关键路径：100%
