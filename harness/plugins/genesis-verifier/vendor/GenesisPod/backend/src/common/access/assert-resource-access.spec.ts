import { NotFoundException } from "@nestjs/common";
import { ContentVisibility } from "@prisma/client";
import { assertResourceAccess } from "./assert-resource-access";

describe("assertResourceAccess", () => {
  const requester = { userId: "user-1" };

  it("放行：own（resource.userId === requester.userId）", () => {
    expect(() =>
      assertResourceAccess(
        { userId: "user-1", visibility: ContentVisibility.PRIVATE },
        requester,
      ),
    ).not.toThrow();
  });

  it("放行：own 即使 visibility 缺省（按 PRIVATE 处理）", () => {
    expect(() =>
      assertResourceAccess({ userId: "user-1" }, requester),
    ).not.toThrow();
  });

  it("404：他人 PRIVATE", () => {
    expect(() =>
      assertResourceAccess(
        { userId: "owner-x", visibility: ContentVisibility.PRIVATE },
        requester,
      ),
    ).toThrow(NotFoundException);
  });

  it("404：visibility 缺省（按 PRIVATE）且非所有者", () => {
    expect(() =>
      assertResourceAccess({ userId: "owner-x" }, requester),
    ).toThrow(NotFoundException);
  });

  it("404：他人 SHARED（SHARED 不再放行非所有者）", () => {
    expect(() =>
      assertResourceAccess(
        { userId: "owner-x", visibility: ContentVisibility.SHARED },
        requester,
      ),
    ).toThrow(NotFoundException);
  });

  it("放行：PUBLIC", () => {
    expect(() =>
      assertResourceAccess(
        { userId: "owner-x", visibility: ContentVisibility.PUBLIC },
        requester,
      ),
    ).not.toThrow();
  });
});
