# runner

> agent 单次执行主线。

## 定位

`runner/` 负责 loop、executor、context、prompt、env、plan execution、tool invocation。

## 禁止事项

- 禁止把 engine 原子能力实现沉到 runner
- 禁止把 app 业务脚本长期塞进 runner
