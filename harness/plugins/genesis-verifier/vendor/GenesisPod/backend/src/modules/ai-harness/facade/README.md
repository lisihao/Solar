# facade

> `ai-harness` 对外稳定入口。

## 定位

`facade/` 是 `ai-app` / `open-api` 消费 harness 的唯一稳定入口。

## 禁止事项

- 禁止新增业务实现
- 禁止把内部目录穿透导出当成长久兼容方案

## 目录约定

- `index.ts`: 唯一 public barrel，只做聚合
- `domain/`: 对 app 暴露的领域 facade
- `sub-facades/`: facade 内部组装层，不直接对 app 建立契约
- `types/`: facade 自有类型和兼容前向类型

## 整理原则

- 先收口，后搬家：先用 grouped barrel 收敛导出，再做物理迁移
- 保持单向依赖：`ai-app -> ai-harness -> ai-engine`
- 兼容 re-export 必须是迁移过渡层，不是永久堆积区
