/**
 * 测试事件转换 - 模拟 task:awaiting_review 事件处理
 */

// 模拟 SlidesMissionEvent
const mockTaskEvent = {
  type: "task:awaiting_review" as const,
  missionId: "test-mission",
  timestamp: new Date().toISOString(),
  data: {
    task: {
      id: "task-3",
      skillId: "slides-page-pipeline",
      title: "生成页面内容",
      status: "awaiting_review",
      result: {
        pages: [
          {
            pageNumber: 1,
            title: "封面页",
            html: "<div>封面HTML内容...</div>",
            status: "completed",
            templateId: "N-001",
            duration: 2,
          },
          {
            pageNumber: 2,
            title: "目录",
            html: "<div>目录HTML内容...</div>",
            status: "completed",
            templateId: "N-004",
            duration: 1,
          },
          {
            pageNumber: 3,
            title: "核心内容",
            html: "<div>核心内容HTML...</div>",
            status: "completed",
            templateId: "S-003",
            duration: 1,
          },
        ],
        totalPages: 3,
        completedPages: 3,
        failedPages: 0,
        totalDuration: 4,
      },
    },
    result: {
      pages: [
        {
          pageNumber: 1,
          title: "封面页",
          html: "<div>封面HTML内容...</div>",
          status: "completed",
          templateId: "N-001",
          duration: 2,
        },
        {
          pageNumber: 2,
          title: "目录",
          html: "<div>目录HTML内容...</div>",
          status: "completed",
          templateId: "N-004",
          duration: 1,
        },
        {
          pageNumber: 3,
          title: "核心内容",
          html: "<div>核心内容HTML...</div>",
          status: "completed",
          templateId: "S-003",
          duration: 1,
        },
      ],
      totalPages: 3,
      completedPages: 3,
      failedPages: 0,
      totalDuration: 4,
    },
  },
};

// 模拟 SlidesEngineService 的事件转换逻辑
function transformSlidesMissionEvent(
  event: {
    type: string;
    missionId: string;
    timestamp: string;
    data: typeof mockTaskEvent.data;
  },
  sessionId: string,
) {
  const events: { type: string; data: unknown }[] = [];
  const { type, data } = event;

  console.log(`\n=== 处理事件: ${type} ===`);
  console.log(
    `data.task: ${JSON.stringify(data.task ? { id: data.task.id, skillId: data.task.skillId, status: data.task.status } : null)}`,
  );
  console.log(`data.result exists: ${!!data.result}`);
  console.log(
    `data.task.result exists: ${!!(data.task as { result?: unknown })?.result}`,
  );

  switch (type) {
    case "task:awaiting_review":
    case "task:completed": {
      const task = data.task as {
        skillId?: string;
        title?: string;
        result?: unknown;
      };

      console.log(`\n检查 skillId: "${task?.skillId}"`);
      console.log(
        `是否匹配 slides-page-pipeline: ${task?.skillId === "slides-page-pipeline"}`,
      );

      // 添加 agent:completed 事件
      events.push({
        type: "agent:completed",
        data: { result: `${task?.title || "unknown"} 完成` },
      });

      // 只有 page-pipeline 任务才提取 HTML
      if (
        task?.skillId === "slides-page-pipeline" ||
        task?.skillId === "page-pipeline"
      ) {
        const taskResult = data.result || task?.result;
        console.log(`\n★ 提取页面，taskResult exists: ${!!taskResult}`);
        extractPagesFromTaskResult(taskResult, sessionId, events);
      } else {
        console.log(`\n跳过非 page-pipeline 任务: ${task?.skillId}`);
      }
      break;
    }
  }

  return events;
}

function extractPagesFromTaskResult(
  result: unknown,
  _sessionId: string,
  events: { type: string; data: unknown }[],
) {
  console.log(`\n--- extractPagesFromTaskResult ---`);
  console.log(`result type: ${typeof result}`);

  if (!result || typeof result !== "object") {
    console.log(`❌ result 无效`);
    return;
  }

  const resultObj = result as Record<string, unknown>;
  console.log(`result keys: ${Object.keys(resultObj).join(", ")}`);

  const pages = resultObj.pages as unknown[];
  console.log(
    `pages exists: ${!!pages}, isArray: ${Array.isArray(pages)}, length: ${pages?.length || 0}`,
  );

  if (pages && Array.isArray(pages)) {
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i] as {
        html?: string;
        pageNumber?: number;
        title?: string;
        status?: string;
      };
      const html = page.html;
      console.log(
        `  Page ${i}: status=${page.status}, htmlLength=${html?.length || 0}`,
      );

      if (html) {
        events.push({
          type: "slide:generated",
          data: {
            pageNumber: page.pageNumber || i + 1,
            title: page.title || `第 ${i + 1} 页`,
            contentLength: html.length,
            html,
          },
        });
        console.log(`  ✓ 添加 slide:generated 事件`);
      } else {
        console.log(`  ✗ 无 HTML 内容`);
      }
    }
  }
}

// 运行测试
console.log("=== 事件转换测试 ===");
const sessionId = "test-session";
const outputEvents = transformSlidesMissionEvent(mockTaskEvent, sessionId);

console.log(`\n=== 输出事件 (${outputEvents.length} 个) ===`);
for (const e of outputEvents) {
  if (e.type === "slide:generated") {
    const d = e.data as {
      pageNumber: number;
      title: string;
      contentLength: number;
    };
    console.log(
      `${e.type}: Page ${d.pageNumber} - ${d.title} (${d.contentLength} chars)`,
    );
  } else {
    console.log(`${e.type}: ${JSON.stringify(e.data)}`);
  }
}
