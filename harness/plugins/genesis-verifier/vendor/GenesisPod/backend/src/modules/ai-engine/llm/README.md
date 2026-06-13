# llm

> 大模型调用与 provider 能力边界。

## 定位

`llm/` 负责模型调用、provider 适配、输出解析、选型、定价、prompt 适配与模型相关配置。

## 明确边界

- 允许：
  - provider / adapter / factory
  - prompt template 与输出解析
  - `user-config/` 用户模型配置
  - `key-health/` 模型 key 健康与轮转辅助

- 不允许：
  - 顶层 `credentials/` 回流
  - agent loop / mission / session 编排

`credentials/` 的边界归 `platform`（L1，真实目录 `modules/platform/credentials/`）；这里只保留 LLM 配套能力。
