# skills

> Skill 定义、注册与执行适配边界。

## 定位

`skills/` 负责 skill contract、registry、loader、sandbox、runtime adapter。

## 明确边界

- `runtime/` 允许存在少量面向 harness 的倒置依赖适配器
- 这类适配器必须是窄口 adapter，不能把 harness 编排逻辑拉回 engine

## 禁止事项

- 禁止出现第二套 skill registry
- 禁止把 app 业务 skill 直接写成 engine core
