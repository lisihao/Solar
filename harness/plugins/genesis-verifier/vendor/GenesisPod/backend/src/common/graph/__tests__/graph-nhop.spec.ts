/**
 * GraphService.nHopNeighbors Unit Tests
 *
 * 离线单测：mock $queryRawUnsafe，验证白名单拦截、SQL 构造（环路检测 + scope/relType
 * 过滤）、参数顺序、行映射。真实递归 CTE 行为（含环不死循环）属部署/集成态（需 Postgres）。
 */

import { Test, TestingModule } from "@nestjs/testing";
import { GraphService } from "../graph.service";
import { PrismaService } from "../../prisma/prisma.service";

/** 测试用边表名 — 在 beforeEach 动态注入 EDGE_TABLE_REGISTRY */
const TEST_EDGE_TABLE = "test_edges";

describe("GraphService.nHopNeighbors", () => {
  let service: GraphService;
  let queryRawUnsafe: jest.Mock;

  beforeEach(async () => {
    queryRawUnsafe = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GraphService,
        {
          provide: PrismaService,
          useValue: { $queryRawUnsafe: queryRawUnsafe },
        },
      ],
    }).compile();
    service = module.get(GraphService);
    // 注入测试用边表（替代已删除的 industry_relations）
    (
      GraphService as unknown as {
        EDGE_TABLE_REGISTRY: Record<string, unknown>;
      }
    )["EDGE_TABLE_REGISTRY"][TEST_EDGE_TABLE] = {
      source: "source_id",
      target: "target_id",
      relType: "relation_type",
      scope: "chain_id",
    };
  });

  it("拒绝未登记白名单的边表（防 SQL 注入）", async () => {
    await expect(
      service.nHopNeighbors({
        rootId: "n1",
        depth: 2,
        edgeTable: "users; DROP TABLE x", // 注入尝试
      }),
    ).rejects.toThrow(/not allow-listed/);
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("构造的递归 CTE 含环路检测 + 正确表/列", async () => {
    queryRawUnsafe.mockResolvedValueOnce([{ node_id: "n2" }]); // traverse
    queryRawUnsafe.mockResolvedValueOnce([]); // edges
    await service.nHopNeighbors({
      rootId: "n1",
      depth: 3,
      edgeTable: TEST_EDGE_TABLE,
    });
    const sql = queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toContain("WITH RECURSIVE traverse");
    expect(sql).toContain("NOT (nb.neighbor = ANY(t.path))"); // 环路检测
    expect(sql).toContain(`"${TEST_EDGE_TABLE}"`);
    expect(sql).toContain('"source_id"');
    expect(sql).toContain('"target_id"');
    // 参数：rootId, depth
    expect(queryRawUnsafe.mock.calls[0].slice(1)).toEqual(["n1", 3]);
  });

  it("scopeValue + relationTypes 进入 SQL 过滤与参数", async () => {
    queryRawUnsafe.mockResolvedValueOnce([]);
    queryRawUnsafe.mockResolvedValueOnce([]);
    await service.nHopNeighbors({
      rootId: "n1",
      depth: 2,
      edgeTable: TEST_EDGE_TABLE,
      scopeValue: "chain-1",
      relationTypes: ["SUPPLIES"],
    });
    const [sql, ...args] = queryRawUnsafe.mock.calls[0];
    expect(sql).toContain('e."chain_id" = $3');
    expect(sql).toContain('e."relation_type" = ANY($4::text[])');
    expect(args).toEqual(["n1", 2, "chain-1", ["SUPPLIES"]]);
  });

  it("映射可达节点与边", async () => {
    queryRawUnsafe.mockResolvedValueOnce([
      { node_id: "n2" },
      { node_id: "n3" },
    ]);
    queryRawUnsafe.mockResolvedValueOnce([
      { source: "n1", target: "n2", relationType: "SUPPLIES" },
    ]);
    const res = await service.nHopNeighbors({
      rootId: "n1",
      depth: 2,
      edgeTable: TEST_EDGE_TABLE,
    });
    expect(res.nodeIds).toEqual(["n2", "n3"]);
    expect(res.edges).toEqual([
      { source: "n1", target: "n2", relationType: "SUPPLIES" },
    ]);
    // 边查询限定在 root + 可达节点集合内
    expect(queryRawUnsafe.mock.calls[1][1]).toEqual(["n1", "n2", "n3"]);
  });

  it("depth 钳制到 [1,10]", async () => {
    queryRawUnsafe.mockResolvedValue([]);
    await service.nHopNeighbors({
      rootId: "n1",
      depth: 999,
      edgeTable: TEST_EDGE_TABLE,
    });
    expect(queryRawUnsafe.mock.calls[0][2]).toBe(10);
  });
});
