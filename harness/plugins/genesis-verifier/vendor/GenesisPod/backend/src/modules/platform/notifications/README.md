# notifications

> `platform/notifications` 负责通用通知内核，以及受控的预置通知模板。

## 结构

```text
notifications/
├── dto/
├── presets/
│   └── notification-presets.service.ts
├── notification.controller.ts
├── notification.module.ts
└── notification.service.ts
```

## 边界

- `notification.service.ts`
  - 通用通知 CRUD、批量发送、已读状态、偏好设置
  - 不直接承载 topic / research / credits 等具体业务模板

- `presets/notification-presets.service.ts`
  - 受控的预置通知模板
  - 允许基于通用通知内核封装常用模板
  - 不应继续无约束膨胀为 app 侧业务编排中心

## 后续收敛

- 若模板持续按业务域增长，应继续按 bounded context 下沉或细分子目录
