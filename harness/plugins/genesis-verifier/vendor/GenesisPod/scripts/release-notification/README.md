# 发布通知脚本

自动化发布通知系统，在发布新版本时收集 Git 变更、使用 AI 生成发布说明并推送通知。

## 功能

1. **收集 Git 变更** - 分析两个 tag 之间的 commits
2. **AI 生成发布说明** - 使用 AI 将技术变更转换为用户友好的说明
3. **批量推送通知** - 向所有活跃用户发送更新通知

## 使用方式

### Shell 脚本（推荐）

```bash
# 预览发布说明（不发送通知）
./scripts/release-notification/trigger-release-notification.sh v1.0.0 v1.1.0 --dry-run

# 正式发送通知
./scripts/release-notification/trigger-release-notification.sh v1.0.0 v1.1.0
```

### NPM 脚本

```bash
cd backend

# 预览发布说明
npm run release:preview -- --from v1.0.0 --to v1.1.0

# 正式发送通知
npm run release:notify -- --from v1.0.0 --to v1.1.0
```

### TypeScript 直接执行

```bash
cd backend

# 预览模式
npx ts-node scripts/send-release-notification.ts --from v1.0.0 --to v1.1.0 --dry-run

# 正式发送
npx ts-node scripts/send-release-notification.ts --from v1.0.0 --to v1.1.0
```

## 参数说明

| 参数           | 必填 | 说明                               |
| -------------- | ---- | ---------------------------------- |
| `--from <tag>` | 是   | 起始版本 tag                       |
| `--to <tag>`   | 是   | 目标版本 tag                       |
| `--dry-run`    | 否   | 预览模式，只生成发布说明不发送通知 |
| `--help`       | 否   | 显示帮助信息                       |

## 工作流程

```
1. 验证 Git tags 存在
2. 收集 commits: git log <from>..<to>
3. 收集变更统计: git diff <from>..<to> --stat
4. 解析 Conventional Commits 格式
5. 调用 AI 生成用户友好的发布说明
6. 获取活跃用户列表（30天内登录）
7. 批量发送通知
```

## AI 生成的发布说明格式

```json
{
  "version": "v1.1.0",
  "summary": "本次更新带来了全新的 AI 写作助手功能",
  "highlights": [
    { "title": "AI 写作", "description": "智能辅助内容创作" },
    { "title": "性能优化", "description": "页面加载速度提升 50%" }
  ],
  "changes": [
    { "type": "feat", "scope": "writing", "description": "新增 AI 写作助手" },
    { "type": "fix", "scope": "auth", "description": "修复登录偶发失败问题" }
  ]
}
```

## 环境要求

- Node.js 18+
- Git（用于执行 git log/diff 命令）
- 已配置的 `.env` 文件：
  - 数据库连接（PostgreSQL）
  - AI API Key（用于生成发布说明）

## CI/CD 集成

GitHub Actions 会在发布新 Release 时自动触发：

```yaml
# .github/workflows/release-notification.yml
on:
  release:
    types: [published]
```

也支持手动触发：

```yaml
on:
  workflow_dispatch:
    inputs:
      from_tag:
        required: true
      to_tag:
        required: true
```

## 故障排除

### Git tag 不存在

```bash
# 查看所有 tags
git tag -l

# 创建新 tag
git tag v1.1.0
git push origin v1.1.0
```

### AI 生成失败

脚本会自动降级生成基础发布说明，不会阻塞通知发送。

### 部分通知发送失败

脚本会记录失败的用户 ID，可以在日志中查看并手动重试。
