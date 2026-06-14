import { StorageOffloadService } from "../storage-offload.service";
import { PrismaService } from "@/common/prisma/prisma.service";
import { ObjectStorageService } from "../../object-store/object-storage.service";
import { Prisma } from "@prisma/client";

interface OffloadTarget {
  name: string;
  list: (
    p: PrismaService,
    take: number,
  ) => Promise<Array<{ id: string; content: string; version?: number }>>;
  commit: (
    p: PrismaService,
    id: string,
    uri: string,
    size: number,
  ) => Promise<void>;
  recordSmall: (p: PrismaService, id: string, size: number) => Promise<void>;
  keyFor: (id: string, version?: number) => string;
  contentType: string;
}

interface OffloadInternals {
  buildTargets: () => OffloadTarget[];
}

function getTarget(
  service: StorageOffloadService,
  name: string,
): OffloadTarget {
  const targets = (service as unknown as OffloadInternals).buildTargets();
  const target = targets.find((entry) => entry.name === name);
  if (!target) throw new Error(`target not registered: ${name}`);
  return target;
}

describe("StorageOffloadService - playground targets", () => {
  const missionFindMany = jest.fn();
  const missionUpdate = jest.fn();
  const versionFindMany = jest.fn();
  const versionUpdate = jest.fn();
  const executeRawUnsafe = jest.fn();
  const mockPrisma = {
    agentPlaygroundMission: {
      findMany: missionFindMany,
      update: missionUpdate,
    },
    missionReportVersion: {
      findMany: versionFindMany,
      update: versionUpdate,
    },
    $executeRawUnsafe: executeRawUnsafe,
  } as unknown as PrismaService;

  const mockStorage = {
    isEnabled: () => true,
  } as unknown as ObjectStorageService;

  let service: StorageOffloadService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StorageOffloadService(mockPrisma, mockStorage);
  });

  it("registers playground mission and report version offload targets", () => {
    const targets = (service as unknown as OffloadInternals).buildTargets();
    const names = targets.map((target) => target.name);
    expect(names).toContain("agent_playground_missions.report_full");
    expect(names).toContain("agent_playground_missions.reconciliation_report");
    expect(names).toContain("agent_playground_missions.leader_journal");
    expect(names).toContain("agent_playground_missions.analyst_output");
    expect(names).toContain("agent_playground_missions.outline_plan");
    expect(names).toContain("mission_report_versions.report_full");
  });

  it("lists mission report_full rows with uri guard and JSON serialisation", async () => {
    const target = getTarget(service, "agent_playground_missions.report_full");
    missionFindMany.mockResolvedValue([
      { id: "m1", reportFull: { title: "A" }, reportFullUri: null },
      { id: "m2", reportFull: null, reportFullUri: null },
    ]);

    const rows = await target.list(mockPrisma, 25);

    expect(missionFindMany).toHaveBeenCalledWith({
      where: {
        reportFullUri: null,
        NOT: { reportFull: { equals: Prisma.DbNull } },
      },
      select: {
        id: true,
        reportFull: true,
        reportFullUri: true,
      },
      take: 25,
    });
    expect(rows).toEqual([
      {
        id: "m1",
        content: JSON.stringify({ title: "A" }),
      },
    ]);
    expect(target.keyFor("m1")).toBe("mission-records/m1/report_full.json");
    expect(target.contentType).toBe("application/json; charset=utf-8");
  });

  it("commits playground mission report_full offload via raw SQL", async () => {
    const target = getTarget(service, "agent_playground_missions.report_full");
    executeRawUnsafe.mockResolvedValue(1);

    await target.commit(
      mockPrisma,
      "m1",
      "mission-records/m1/report_full.json",
      8192,
    );

    expect(executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining(
        "UPDATE agent_playground_missions SET report_full=NULL, report_full_uri=$1, report_full_size=$2 WHERE id=$3",
      ),
      "mission-records/m1/report_full.json",
      8192,
      "m1",
    );
  });

  it("lists mission report versions with version-specific prefix", async () => {
    const target = getTarget(service, "mission_report_versions.report_full");
    versionFindMany.mockResolvedValue([
      { id: "rv1", reportFull: { title: "Version 1" }, reportFullUri: null },
    ]);

    const rows = await target.list(mockPrisma, 10);

    expect(versionFindMany).toHaveBeenCalledWith({
      where: {
        reportFullUri: null,
        NOT: { reportFull: { equals: Prisma.DbNull } },
      },
      select: {
        id: true,
        reportFull: true,
        reportFullUri: true,
      },
      take: 10,
    });
    expect(rows).toEqual([
      {
        id: "rv1",
        content: JSON.stringify({ title: "Version 1" }),
      },
    ]);
    expect(target.keyFor("rv1")).toBe("report-versions/rv1/report_full.json");
  });
});
