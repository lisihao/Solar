# release

> 版本发布与公告广播基础设施。

## 定位

`release/` 负责版本变化收集、发布说明生成、批量通知广播。

当前它仍是单聚合目录，但边界是清晰的：

- `release.service.ts` 负责发布流水线编排
- `dto/` 负责发布说明与结果对象

## 明确边界

- 允许：
  - Git 变更采集
  - 发布说明生成
  - 面向全体用户的系统级广播

- 不允许：
  - 具体业务域的活动/专题通知模板
  - app 级运营编排
  - 与 agent/mission 语义绑定的发布逻辑

后续如继续膨胀，应拆成 `change-collection/`、`notes-generation/`、`broadcast/`，但当前先保持单聚合。
