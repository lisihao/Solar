# facade

> `ai-engine` 对外稳定入口。

## 定位

`facade/` 只导出上层允许消费的引擎能力、token 与抽象。

## 禁止事项

- 禁止在这里新增业务逻辑实现
- 禁止把 app / harness 语义重新导回 engine
- 禁止为绕过层边界而增加内部路径穿透导出
