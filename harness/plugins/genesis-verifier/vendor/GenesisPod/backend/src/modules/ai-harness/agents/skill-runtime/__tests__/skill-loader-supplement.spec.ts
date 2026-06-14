/**
 * SkillLoader — branch coverage supplement
 *
 * Targets uncovered branches:
 *   b0  cond-expr line=37  (exists = false — built-in dir not accessible)
 *   b3  cond-expr line=57  (loadById ENOENT code check)
 *   b4  if line=68  (loadAll: !exists return [])
 *   b5  if line=76  (!entry.isDirectory() continue)
 *   b6  if line=82  (SkillParseError branch in catch)
 *   b7  if line=84  (ENOENT branch in per-file catch)
 *   b8  binary-expr line=85 (code === "ENOENT" check)
 *   b9  cond-expr line=95  (generic error branch in catch)
 *
 * Note: Because ts-jest uses isolatedModules, we cannot use jest.mock("fs")
 * with module-level mock. Instead, we spy on fs.promises methods.
 */

import * as fs from "fs";
import { SkillLoader } from "../skill-loader";
import { BuiltinSkillCatalog } from "../skill-registry";
import { SkillParseError } from "../skill-parser";

describe("SkillLoader — supplement (fs spies)", () => {
  let registry: BuiltinSkillCatalog;
  let loader: SkillLoader;

  beforeEach(() => {
    registry = new BuiltinSkillCatalog();
    loader = new SkillLoader(registry);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("loadAll()", () => {
    it("returns [] when BUILT_IN_DIR does not exist (access rejects)", async () => {
      jest
        .spyOn(fs.promises, "access")
        .mockRejectedValue(
          Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
        );
      const skills = await loader.loadAll();
      expect(skills).toEqual([]);
    });

    it("skips non-directory entries", async () => {
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest
        .spyOn(fs.promises, "readdir")
        .mockResolvedValue([
          { isDirectory: () => false, name: "file.txt" } as any,
        ]);
      const skills = await loader.loadAll();
      expect(skills).toEqual([]);
    });

    it("warns on SkillParseError and continues (branch b6)", async () => {
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest
        .spyOn(fs.promises, "readdir")
        .mockResolvedValue([
          { isDirectory: () => true, name: "bad-skill" } as any,
        ]);
      jest
        .spyOn(fs.promises, "readFile")
        .mockRejectedValue(new SkillParseError("frontmatter parse failed"));
      const skills = await loader.loadAll();
      expect(skills).toEqual([]);
    });

    it("warns on ENOENT for individual skill file (branch b7/b8)", async () => {
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest
        .spyOn(fs.promises, "readdir")
        .mockResolvedValue([
          { isDirectory: () => true, name: "no-skill-md" } as any,
        ]);
      const enoentError = Object.assign(new Error("no such file"), {
        code: "ENOENT",
      });
      jest.spyOn(fs.promises, "readFile").mockRejectedValue(enoentError);
      const skills = await loader.loadAll();
      expect(skills).toEqual([]);
    });

    it("warns on generic Error for skill file and continues (branch b9, Error path)", async () => {
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest
        .spyOn(fs.promises, "readdir")
        .mockResolvedValue([
          { isDirectory: () => true, name: "corrupt-skill" } as any,
        ]);
      jest
        .spyOn(fs.promises, "readFile")
        .mockRejectedValue(new Error("permission denied"));
      const skills = await loader.loadAll();
      expect(skills).toEqual([]);
    });

    it("warns on non-Error generic rejection (branch b9, non-Error path)", async () => {
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest
        .spyOn(fs.promises, "readdir")
        .mockResolvedValue([
          { isDirectory: () => true, name: "corrupt-skill" } as any,
        ]);
      jest.spyOn(fs.promises, "readFile").mockRejectedValue("raw string error");
      const skills = await loader.loadAll();
      expect(skills).toEqual([]);
    });

    it("object with non-ENOENT code → generic warn branch", async () => {
      jest.spyOn(fs.promises, "access").mockResolvedValue(undefined);
      jest
        .spyOn(fs.promises, "readdir")
        .mockResolvedValue([
          { isDirectory: () => true, name: "perm-denied" } as any,
        ]);
      const permErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
      jest.spyOn(fs.promises, "readFile").mockRejectedValue(permErr);
      const skills = await loader.loadAll();
      expect(skills).toEqual([]);
    });
  });

  describe("loadById()", () => {
    it("returns null for non-existent skill (ENOENT branch b3)", async () => {
      const enoentError = Object.assign(new Error("no such file"), {
        code: "ENOENT",
      });
      jest.spyOn(fs.promises, "readFile").mockRejectedValue(enoentError);
      const skill = await loader.loadById("non-existent");
      expect(skill).toBeNull();
    });

    it("non-ENOENT Error → warns and returns null", async () => {
      jest
        .spyOn(fs.promises, "readFile")
        .mockRejectedValue(new Error("permission denied"));
      const skill = await loader.loadById("some-skill");
      expect(skill).toBeNull();
    });

    it("non-Error rejection → warns with String() and returns null", async () => {
      jest.spyOn(fs.promises, "readFile").mockRejectedValue("raw error");
      const skill = await loader.loadById("some-skill");
      expect(skill).toBeNull();
    });

    it("object without ENOENT code → warns and returns null", async () => {
      const objErr = Object.assign(new Error("oops"), { code: "EPERM" });
      jest.spyOn(fs.promises, "readFile").mockRejectedValue(objErr);
      const skill = await loader.loadById("some-skill");
      expect(skill).toBeNull();
    });
  });

  describe("onModuleInit()", () => {
    it("handles loadAll returning empty gracefully", async () => {
      jest.spyOn(fs.promises, "access").mockRejectedValue(new Error("ENOENT"));
      await expect(loader.onModuleInit()).resolves.not.toThrow();
    });

    it("warns but does not throw when loadAll has generic error (non-Error warn path)", async () => {
      // Make onModuleInit() catch a non-Error
      jest.spyOn(loader, "loadAll").mockRejectedValue("raw string failure");
      await expect(loader.onModuleInit()).resolves.not.toThrow();
    });
  });
});


