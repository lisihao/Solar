import { MissionSedimentService } from "../mission-sediment.service";
import type { NotesService } from "../../notes/notes.service";

describe("MissionSedimentService", () => {
  let notes: { createNote: jest.Mock };
  let service: MissionSedimentService;

  beforeEach(() => {
    notes = { createNote: jest.fn().mockResolvedValue({ id: "note-1" }) };
    service = new MissionSedimentService(notes as unknown as NotesService);
  });

  const base = {
    missionId: "m1",
    userId: "u1",
    title: "AI 趋势研究",
    content: "# 报告\n正文",
    source: "playground",
    tags: ["playground", "市场"],
  };

  it("成功路径：把报告落成一条 library note（title/content/source/tags 透传）", async () => {
    await service.sedimentMission(base);
    expect(notes.createNote).toHaveBeenCalledTimes(1);
    expect(notes.createNote).toHaveBeenCalledWith("u1", {
      title: "AI 趋势研究",
      content: "# 报告\n正文",
      source: "playground",
      tags: ["playground", "市场"],
      isPublic: false,
    });
  });

  it("空正文：跳过，不创建空 note", async () => {
    await service.sedimentMission({ ...base, content: "   " });
    expect(notes.createNote).not.toHaveBeenCalled();
  });

  it("缺 title：回退默认标题", async () => {
    await service.sedimentMission({ ...base, title: "" });
    expect(notes.createNote).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ title: "AI 任务报告" }),
    );
  });

  it("缺 tags：透传空数组", async () => {
    const { tags: _omit, ...noTags } = base;
    await service.sedimentMission(noTags);
    expect(notes.createNote).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ tags: [] }),
    );
  });

  it("best-effort：createNote 抛错不冒泡（fire-and-forget 不阻断 mission）", async () => {
    notes.createNote.mockRejectedValueOnce(new Error("db down"));
    await expect(service.sedimentMission(base)).resolves.toBeUndefined();
  });
});
