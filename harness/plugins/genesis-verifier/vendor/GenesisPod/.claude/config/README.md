# Claude Code Config

> Agent 配置文件目录，包含各个 Agent 的运行时配置。

## 配置文件

| 文件                | 用途             | Agent         |
| ------------------- | ---------------- | ------------- |
| `monitoring.yml`    | 生产环境监控配置 | monitoring    |
| `merge-to-main.yml` | 代码合并策略配置 | merge-to-main |

## 配置规范

### YAML 格式要求

- 使用 2 空格缩进
- 字符串值使用双引号（如包含特殊字符）
- 布尔值使用 `true` / `false`
- 列表使用 `-` 前缀

### 环境变量支持

配置文件支持环境变量引用：

```yaml
database:
  host: "${DATABASE_HOST}"
  port: ${DATABASE_PORT:-5432} # 默认值
```

### 配置覆盖

本地开发时可创建 `*.local.yml` 文件覆盖配置：

```
config/
├── monitoring.yml         # 基础配置
├── monitoring.local.yml   # 本地覆盖（不提交）
└── merge-to-main.yml
```

## 使用方式

Agent 会自动读取对应的配置文件：

```
Agent: merge-to-main
  → 读取: .claude/config/merge-to-main.yml
  → 读取: .claude/config/merge-to-main.local.yml (如存在)
```

---

**最后更新**: 2025-01-15
