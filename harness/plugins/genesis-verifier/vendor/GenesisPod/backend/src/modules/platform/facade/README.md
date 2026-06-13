# facade

> `ai-infra` 对外稳定入口。

## 定位

`facade/` 只负责导出可被上层消费的稳定符号。

## 允许内容

- service 导出
- DTO / token / abstraction 导出
- 受控的兼容性 re-export

## 禁止内容

- 新业务实现
- Module 组合逻辑
- 为绕过层边界而添加的内部路径穿透
