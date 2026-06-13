import { NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { NarrativeController } from "../narrative.controller";
import { NarrativeService } from "../../../mission/services/briefing/narrative.service";
import { RadarTopicService } from "../../../mission/services/topic/radar-topic.service";

describe("NarrativeController.getNarrative", () => {
  let controller: NarrativeController;
  let svc: { getNarrativeThread: jest.Mock };
  let topics: { getOwnedById: jest.Mock };

  beforeEach(async () => {
    svc = { getNarrativeThread: jest.fn() };
    topics = { getOwnedById: jest.fn().mockResolvedValue({ id: "topic-1" }) };
    const moduleRef = await Test.createTestingModule({
      controllers: [NarrativeController],
      providers: [
        { provide: NarrativeService, useValue: svc },
        { provide: RadarTopicService, useValue: topics },
      ],
    }).compile();
    controller = moduleRef.get(NarrativeController);
  });

  it("throws NotFoundException when service returns null", async () => {
    svc.getNarrativeThread.mockResolvedValueOnce(null);
    await expect(
      controller.getNarrative(
        { user: { id: "u-1" } } as never,
        "topic-1",
        "narr-1",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
