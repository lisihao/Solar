# db-governance

> 数据库治理边界。

## 定位

`db-governance/` 负责数据库清单、诊断、保留策略与治理操作。

## 当前结构

```text
db-governance/
├── dto/
├── db-governance.controller.ts
├── db-governance.module.ts
├── db-governance.service.ts
└── data-retention.service.ts
```

## 明确边界

- 允许：
  - 表统计、体积估算、治理诊断
  - retention / cleanup policy
  - 管理员治理入口

- 不允许：
  - 具体 app 域的数据运营逻辑
  - 将业务流程包装成“数据库治理”
