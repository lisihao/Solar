# storage

> `platform` 下的存储能力分两类：对象存储 runtime，与存储治理。

## 结构

```text
storage/
├── runtime/
│   └── object-storage.service.ts
├── governance/
│   ├── storage-governance.service.ts
│   ├── storage-governance.controller.ts
│   ├── storage-inventory.service.ts
│   └── storage-offload.service.ts
└── storage.module.ts
```

## 边界

- `runtime/`
  - 面向对象存储适配与文件上传下载能力
  - 不承载业务域治理策略

- `governance/`
  - 面向 offload、盘点、清理、治理任务
  - 允许知道表、字段、R2 prefix，但不应演化成 app 业务服务

- `governance/storage-governance.service.ts`
  - 当前存储治理聚合
  - 后续继续拆分为更细的治理服务

- `governance/storage-governance.controller.ts`
  - 存储治理管理入口
  - 不承载对象存储 runtime 适配职责

## 后续收敛

- 将 `storage-governance.service.ts` 中的治理逻辑继续拆到更细的 `governance/` 服务
- 将明显的单业务对象包装器留在 app 侧，不回流 platform core
