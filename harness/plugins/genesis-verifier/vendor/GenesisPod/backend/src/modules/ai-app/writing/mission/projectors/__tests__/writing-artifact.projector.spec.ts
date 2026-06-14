/**
 * writing-artifact.projector.spec.ts
 *
 * M5 回归：过滤掉中间 FAILED 章后，幸存章必须保留**真实章号**（不按数组下标
 * idx+1 重编号），否则标题/章号整体前移串位。
 */
import { WritingArtifactProjector } from "../writing-artifact.projector";
import type { WritingMissionContext } from "../../context/mission-context";

function makeCtx(
  revisedChapters: Array<{
    chapterId: string;
    chapterNumber: number;
    status: "REVISED" | "FAILED";
    wordCount: number;
  }>,
): WritingMissionContext {
  return {
    missionId: "m1",
    input: { projectId: "p1" },
    revisedChapters,
    chapterPlan: [
      { chapterNumber: 1, title: "第一章标题" },
      { chapterNumber: 2, title: "第二章标题" },
      { chapterNumber: 3, title: "第三章标题" },
    ],
  } as unknown as WritingMissionContext;
}

describe("WritingArtifactProjector — buildSections chapter numbering (M5)", () => {
  const projector = new WritingArtifactProjector();

  it("中间章 FAILED 时，幸存章保留真实章号与标题（不前移串位）", () => {
    const artifact = projector.project(
      makeCtx([
        {
          chapterId: "c1",
          chapterNumber: 1,
          status: "REVISED",
          wordCount: 100,
        },
        { chapterId: "c2", chapterNumber: 2, status: "FAILED", wordCount: 0 },
        {
          chapterId: "c3",
          chapterNumber: 3,
          status: "REVISED",
          wordCount: 300,
        },
      ]),
    );

    expect(artifact.sections).toHaveLength(2);
    // 幸存的第 3 章必须仍是章号 3 + 第三章标题（旧 idx+1 会错成 2 + 第二章标题）
    expect(artifact.sections[1].chapterNumber).toBe(3);
    expect(artifact.sections[1].title).toBe("第三章标题");
    // 第一章不受影响
    expect(artifact.sections[0].chapterNumber).toBe(1);
    expect(artifact.sections[0].title).toBe("第一章标题");
  });

  it("全部 REVISED 且连续时维持正常编号", () => {
    const artifact = projector.project(
      makeCtx([
        {
          chapterId: "c1",
          chapterNumber: 1,
          status: "REVISED",
          wordCount: 100,
        },
        {
          chapterId: "c2",
          chapterNumber: 2,
          status: "REVISED",
          wordCount: 200,
        },
      ]),
    );
    expect(artifact.sections.map((s) => s.chapterNumber)).toEqual([1, 2]);
    expect(artifact.sections.map((s) => s.title)).toEqual([
      "第一章标题",
      "第二章标题",
    ]);
  });
});
