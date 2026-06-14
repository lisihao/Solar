# email

> 邮件发送基础设施。

## 定位

`email/` 只负责邮件发送 runtime、连接测试与 provider 适配。
`email/presets/` 负责基于 runtime 的预置邮件编排。

## 明确边界

- 允许：
  - SMTP / provider 发送
  - 邮件连接初始化与重载
  - 发送能力的统一入口
  - `presets/` 中的预置邮件编排

- 不允许：
  - 在 `email.service.ts` 内直接混入业务域邮件模板
  - 系统设置持久化

邮件配置资产归 `settings/`，站内通知归 `notifications/`，邮件专用预设归 `email/presets/`。
