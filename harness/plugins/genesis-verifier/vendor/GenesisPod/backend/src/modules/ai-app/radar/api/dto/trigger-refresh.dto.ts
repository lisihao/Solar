/**
 * 手动触发刷新入口 body 占位 DTO。
 *
 * 2026-05-17 R3 评审：原 `force?: boolean` 字段从未被 controller / dispatcher
 * 消费（controller 用 `_dto` 前缀刻意忽略整个 body），属 dead 校验 = 给前端
 * "参数有效"的误导。删除字段保留 class 是为了 controller 仍能 `@Body()` 触发
 * NestJS ValidationPipe 的 whitelist strip（拒前端误传未知字段）。
 *
 * 未来真要 admin 调试绕过 dedup window，再加字段时**必须同步在 service 层接入**。
 */
export class TriggerRefreshDto {}
