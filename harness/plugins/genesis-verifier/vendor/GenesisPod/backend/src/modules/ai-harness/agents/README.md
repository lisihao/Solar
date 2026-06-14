# agents

> agent 定义、装配与内建能力入口。

## 定位

`agents/` 负责 agent spec、factory、builtin skills、subagent、learning 与开发工具。

## 禁止事项

- 禁止把 engine 原子能力实现沉到这里
- 禁止把 app 级专题工作流直接挂成 agent core
