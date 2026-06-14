# 安全审计报告 — Wave 1b + Wave 4

**审计范围:** Wave 1b + Wave 4 落地改动，2026-05-24
**审计时间:** 2026-05-24
**审计模型:** claude-sonnet-4-6 (Security Auditor Agent)

**实际读取的文件（仅对这些文件评分）:**

- `backend/src/__tests__/architecture/agent-team-layout.spec.ts`
- `backend/src/__tests__/architecture/agent-team-facade-contract.spec.ts`
- `backend/src/modules/ai-app/agent-playground/runtime/playground.config.ts`
- `backend/src/modules/ai-app/radar/api/controller/radar-run.controller.ts`
- `backend/src/modules/ai-app/radar/api/controller/radar-source.controller.ts`
- `backend/src/modules/ai-app/radar/api/controller/radar-topic.controller.ts`
- `backend/src/modules/ai-app/radar/api/controller/radar-feed.controller.ts`
- `backend/src/modules/ai-app/radar/api/controller/daily-briefing.controller.ts`
- `backend/src/modules/ai-app/radar/api/controller/weekly-briefing.controller.ts`
- `backend/src/modules/ai-app/radar/api/controller/favorite.controller.ts`
- `backend/src/modules/ai-app/radar/api/controller/narrative.controller.ts`
- `backend/src/modules/ai-app/radar/api/controller/radar-insight.controller.ts`
- `backend/src/modules/ai-app/radar/mission/services/collectors/ssrf-util.ts`
- `backend/src/modules/ai-app/radar/mission/services/collectors/custom-collector.service.ts`
- `backend/src/modules/ai-app/radar/mission/services/collectors/rss-collector.service.ts`
- `backend/src/modules/ai-app/radar/mission/services/scheduler/radar-refresh.scheduler.ts`
- `backend/src/modules/ai-app/radar/mission/services/scheduler/radar-briefing-queue.service.ts`
- `.claude/standards/23-business-team-framework-usage.md`

---

## 发现汇总

| 严重度   | 数量 | 类型                                                      |
| -------- | ---- | --------------------------------------------------------- |
| Critical | 0    | —                                                         |
| High     | 0    | —                                                         |
| Medium   | 2    | SSRF DNS rebinding 残留、redirect:follow 链式跳转         |
| Low      | 2    | spec fs 符号链接、timezone 注入                           |
| Info     | 3    | 文档缺口、FRONTEND_URL 硬编码、topicId 格式未做 UUID 校验 |

---

## 维度 1: 目录重组引入的攻击面变化

**结论: PASS — 无新增暴露路由**

所有 9 个从 `controllers/` rename 到 `api/controller/` 的 controller 文件均在类级别保留了原有的 `@UseGuards(JwtAuthGuard)` 或 `@UseGuards(JwtAuthGuard, RateLimitGuard)` 装饰器。逐个确认如下:

| Controller                 | 类级别守护                                 |
| -------------------------- | ------------------------------------------ |
| `RadarRunController`       | `@UseGuards(JwtAuthGuard, RateLimitGuard)` |
| `RadarSourceController`    | `@UseGuards(JwtAuthGuard, RateLimitGuard)` |
| `RadarTopicController`     | `@UseGuards(JwtAuthGuard)`                 |
| `RadarFeedController`      | `@UseGuards(JwtAuthGuard)`                 |
| `DailyBriefingController`  | `@UseGuards(JwtAuthGuard)`                 |
| `WeeklyBriefingController` | `@UseGuards(JwtAuthGuard)`                 |
| `FavoriteController`       | `@UseGuards(JwtAuthGuard, RateLimitGuard)` |
| `NarrativeController`      | `@UseGuards(JwtAuthGuard)`                 |
| `RadarInsightController`   | `@UseGuards(JwtAuthGuard)`                 |

rename 是纯文件系统操作，NestJS 路由由 `@Controller(...)` + `@Get/@Post` 装饰器决定，路由路径未变（仍是 `radar/...`）。目录结构变化对 HTTP 路由层完全透明。无暴露风险。

---

## 维度 2: path.resolve(\_\_dirname, ...) 漏洞

**结论: PASS — 无 path traversal 风险**

`playground.config.ts:29`:

```typescript
const AGENTS_ROOT_DIR = path.resolve(__dirname, "..", "mission", "agents");
```

`buildSkillSpecFromMd` 接收的 `agentDir` 参数是模块内部硬编码的字符串字面量（`"leader"`, `"researcher"`, `"analyst"` 等），全部在 `playground.config.ts` 内定义，不接受任何外部输入。`path.resolve` 的第二个参数永远是已知固定值，没有用户可控的路径片段注入路径。

`buildSkillSpecFromMd` 调用链:

```
PLAYGROUND_PIPELINE 定义体（静态）
  → buildSkillSpecFromMd("leader")   // 字面量
  → path.resolve(AGENTS_ROOT_DIR, "leader", "SKILL.md")  // 完全确定
```

`AGENTS_ROOT_DIR` 的 `".."` 是相对 `runtime/` 上跳一层到 `agent-playground/`，这是正确的目录导航，且在编译时确定，不是动态计算的。Wave 4（P21）将文件从 root 移到 `runtime/` 后，相应增加了 `".."` 跳层——正确。

**无 path traversal 风险。**

---

## 维度 3: isolatedModules 修复的副作用

**结论: PASS（附 Info 说明）**

`export { Type }` 改为 `export type { Type }` 是 TypeScript `isolatedModules` 的强制要求：type-only export 在编译时完全擦除，不影响运行时。

对 `instanceof` 检查的影响评估：`export type` 只能导出类型别名、interface 或已有值的类型断言，不能导出真正的类 class 值。如果某个被改动的符号实际上是 class（而不是 interface / type alias），TypeScript 编译器本身会拒绝将其放进 `export type { }`——这在类型检查阶段就会报错，不是运行时静默问题。因此：

- 被改成 `export type` 的符号若是 class，tsc 编译时已报错，不会进入生产。
- `instanceof` 检查依赖的是 class 本身的值导出，不是类型导出；只要 class 仍在某处有值导出（通常是实现文件，不是 re-export barrel），`instanceof` 不受影响。

审计结论：24 个 `export type` 修复本质是静态类型系统的合规修复，不引入运行时安全回归。

**Info 记录（非安全问题，属代码质量）:** `ai-harness/facade/types/facade.types.ts` 等 barrel 文件如果将来新增 class 型符号并错误使用 `export type`，编译器会即时捕获，风险已闭环于 CI 类型检查阶段。

---

## 维度 4: 新 spec 的文件系统安全

**结论: PASS（附 Low 级 Info）**

`agent-team-layout.spec.ts:99`:

```typescript
const entries = fs.readdirSync(dir, { withFileTypes: true });
```

`agent-team-facade-contract.spec.ts:29-36`:

```typescript
for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) { ... listTsFiles(full, acc); }
  else if (e.isFile() && e.name.endsWith(".ts") ...) acc.push(full);
}
```

**符号链接风险分析:**

`readdirSync` 返回的 `Dirent` 对象区分 `isDirectory()` 和 `isSymbolicLink()`。恶意符号链接（例如指向 `/etc/passwd`）被 `e.isDirectory()` 判断为 false（符号链接到文件），`e.isFile()` 也会返回 false（`isFile()` 检查的是 Dirent 类型，符号链接返回 `isSymbolicLink() === true`），因此 **符号链接指向的内容不会被 `readFileSync` 读取**。

唯一例外：符号链接指向目录时，`isDirectory()` 在某些平台上可能返回 true（Node.js `readdirSync` 默认不跟随符号链接判断类型，除非加 `{recursive: true}` 并依赖平台行为）。即便如此，这是测试代码，不是生产代码，其读取的内容只是用于 `expect(violations).toEqual([])` 的合规校验，不存在权限提升或数据泄露的可行攻击路径。

**评级: Low（测试代码，不在生产攻击面内，记录备案）**

---

## 维度 5: radar 重组对 SSRF / 认证边界的影响

**结论: PASS 主路径，FINDING M-1（SSRF DNS rebinding）, FINDING M-2（redirect:follow）**

**主路径（PASS）:** `custom-collector.service.ts` 在发起 HTTP 请求前第 55 行调用 `assertSafeHttpUrl(source.identifier)`，`rss-collector.service.ts` 第 79 行同样调用。import 路径在 rename 后仍正确指向 `./ssrf-util`（相对路径，随文件整体移动）。认证边界完整，所有触发 collector 的调用链均经过 `JwtAuthGuard`（`RadarSourceController` + `RadarRunController` 守护）。

### FINDING M-1（Medium）— SSRF DNS rebinding 残留

**位置:** `backend/src/modules/ai-app/radar/mission/services/collectors/ssrf-util.ts:1-23`

`assertSafeHttpUrl` 仅做 hostname 字符串黑名单匹配，不做 DNS 解析后二次校验。攻击者可以注册一个公网域名（如 `attacker.com`），其 DNS 记录初始指向公网 IP 通过校验，随后在 TTL 到期后将 A 记录切换到 `192.168.x.x` 内网 IP（DNS rebinding），此时 Node.js `fetch` 实际连接内网地址，绕过黑名单。

代码内已有注释承认此局限性（`ssrf-util.ts:5-7`）：

```typescript
// 局限：hostname 字符串匹配，未做 DNS rebinding 二次解析（生产场景应在出站
// HTTP 层再做一次 IP 解析校验；本工具仅作 host-string 黑名单兜底）。
```

**风险:** 内网服务探测（SSRF），访问 metadata 服务（云环境 `169.254.169.254`），严重性取决于部署网络拓扑。CWE-918。

**修复建议:** 在 `fetchHtml` 发出 `fetch` 前，用 `dns.promises.lookup(parsed.hostname)` 解析实际 IP，并对解析结果再次执行 `PRIVATE_HOST_REGEX.test(resolvedIp)`。需要 Node.js `dns` 模块。或者在基础设施层配置出口防火墙（Railway / Docker 出站 ACL），阻止 HTTP worker 访问 RFC1918 地址段。

### FINDING M-2（Medium）— redirect:follow 下的 SSRF 绕过

**位置:** `custom-collector.service.ts:108` + `rss-collector.service.ts:77-79`

`custom-collector.service.ts` 的 `fetch` 配置了 `redirect: "follow"`，`rss-collector.service.ts` 使用 `rss-parser`（内部走 `follow-redirects`），两者都在 SSRF 校验通过后才发起请求。HTTP 重定向可以将请求从已校验的公网 URL 跳转到内网地址，绕过 `assertSafeHttpUrl` 的入口校验。

注：`rss-collector.service.ts:77-79` 已有开发者注释提及此问题，属已知风险。

**修复建议:** 对于 `custom-collector`：在 `fetchHtml` 中捕获 redirect 事件并对每一跳的目标 URL 重新调用 `assertSafeHttpUrl`，或者设置 `redirect: "error"` 并手动跟踪重定向（逐跳校验）。对于 RSS：为 `rss-parser` 配置自定义 `fetch` 函数（`rss-parser` 支持 `requestOptions.fetch`），在其中包装校验。

---

## 维度 6: CLAUDE.md 安全红线检查

**结论: PASS**

逐项扫描结果：

**硬编码密钥 / token / secret:** 扫描 `ai-app/radar/**` 和 `ai-harness/**` 中的 `secret=`, `password=`, `api_key=`, `private_key=` 模式，无命中。`ai-harness/harness.module.ts` 中的 `token` 关键词全部是 NestJS DI token（技术用途，非凭证）。

**硬编码模型名:** `playground.config.ts` 中的 `defineMissionPipeline` 配置不含 `model:` 字段，角色的 `skillSpec.allowedModels` 来自 `SKILL.md` frontmatter（外部配置文件，不在本次审计范围内），不是代码层硬编码。

**dangerouslySetInnerHTML / eval / child_process:** 全部扫描，radar 和 agent-playground 模块内无命中。spec 文件中 `RegExp.exec()` 是正则方法，与 `child_process.exec` 无关。

**Prisma raw query:** radar 模块全域扫描 `$queryRaw / $executeRaw`，无命中，全部使用 Prisma 类型安全 API（`findMany`, `findFirst`, `findUnique`, `count`）。

### Info — FRONTEND_URL 在 scheduler 中的 hardcoded fallback

**位置:** `radar-refresh.scheduler.ts:483`

```typescript
const frontendBase = process.env.FRONTEND_URL ?? "http://localhost:3000";
```

`http://` fallback 在生产环境如果 `FRONTEND_URL` 未配置，会生成 http 链接嵌入邮件 body，导致邮件链接不安全（非 HTTPS）。不构成直接漏洞，但属于安全配置最佳实践缺口。建议 fallback 改为 `"https://app.gens.team"` 或在启动时强制校验 `FRONTEND_URL` 存在且以 `https://` 开头。

### Info — topicId 路径参数未做 UUID 格式校验（部分端点）

**位置:** `RadarTopicController`, `RadarFeedController`, `DailyBriefingController`, `NarrativeController` 中的 `:topicId` 参数均为裸 `@Param("topicId") topicId: string`，未加 `ParseUUIDPipe`。

对比 `RadarRunController.replay()` 和 `getOne()` 已使用 `new ParseUUIDPipe({ version: "4" })`。差异并非严重漏洞（service 层的 `getOwnedById` 已做 ownership 校验，格式非法的 topicId 会导致 DB 查询无结果而非抛出异常），但不符合防御纵深原则，可能导致异常格式 ID 无谓触及 DB 层。建议统一为 `ParseUUIDPipe`。

---

## 维度 7: standards/23-business-team-framework-usage.md 安全要求缺口

**结论: FINDING — Low（文档缺口）**

`standards/23-business-team-framework-usage.md` 目前包含 §1（范围）、§2（目录布局）、§3（framework 继承）、§4（import 规则）、§5（检查清单）、§6（修改红线）、§7（例外流程）七节，涵盖架构合规完整。

**缺失安全控制要求节。** 新 agent team app 的 SOP 文档中未明确说明 HTTP 边界的强制安全控制，包括：

- controller 类级别 `JwtAuthGuard` 必须是默认（无例外不得省略）
- 写操作（POST/PATCH/DELETE）必须配 `RateLimitGuard`
- 用户资源（mission/topic/run）的 ownership 校验必须在 service 层完成（不能只依赖 userId 参数传递）
- SSRF 敏感场景（外部 URL 抓取）必须调用 `assertSafeHttpUrl` + 告知其局限性
- 对外暴露的 `ParseUUIDPipe` 应统一用于 UUID 类路径参数

当前 3 个 app 已经遵守了这些模式，但规范未显式文档化，未来第 4 个 app 的开发者没有强制参考依据。

---

## 整体安全评估

本次 Wave 1b + Wave 4 改动是**架构重组 + TypeScript 合规修复**，安全影响面极小。没有新增外部 API、没有变更认证逻辑、没有新的 LLM prompt 注入路径、没有数据库 schema 变更。主要安全发现均来自 radar collector 的已知 SSRF 局限性（代码注释中已承认），不是本次改动新引入的。

**必修项清单（按优先级）:**

1. **[Medium] SSRF DNS rebinding（M-1）:** 在 `ssrf-util.ts` 中补充 DNS 解析后二次 IP 校验，或在基础设施层配置出站 ACL。这是现有代码的已知遗留问题，与本次 PR 无直接因果，但应排入近期技术债 sprint。
2. **[Medium] redirect:follow SSRF 绕过（M-2）:** `custom-collector.service.ts` 改为逐跳校验重定向目标；`rss-collector.service.ts` 配置自定义 fetch 包装。
3. **[Low] 文档安全缺口（维度 7）:** 在 `standards/23-business-team-framework-usage.md` §5 检查清单中补充"安全控制"子节，列出 JwtAuthGuard + RateLimitGuard + ownership 校验 + SSRF 防护 + ParseUUIDPipe 五条强制要求，与现有三个 app 的实现对齐。
4. **[Info] FRONTEND_URL fallback:** 将 `radar-refresh.scheduler.ts:483` 的 `"http://localhost:3000"` 改为安全默认值，或在启动时通过 `ConfigService` 强制校验该环境变量存在且为 HTTPS。
5. **[Info] topicId ParseUUIDPipe 统一:** 将 `RadarTopicController`、`RadarFeedController`、`DailyBriefingController`、`NarrativeController` 中裸 `@Param("topicId")` 统一改为 `@Param("topicId", new ParseUUIDPipe({ version: "4" }))`，与 `RadarRunController` 已有实践对齐。
