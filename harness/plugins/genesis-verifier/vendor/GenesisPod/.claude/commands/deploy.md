# Deploy & Validate

一站式部署验证。有限次循环，绝不无限监控。

**操作**: $ARGUMENTS

## 部署平台

| 服务     | 平台    | 健康检查路径   |
| -------- | ------- | -------------- |
| Backend  | Railway | /api/v1/health |
| Frontend | Railway | /api/health    |
| AI Svc   | Railway | /              |

## 部署流程（严格执行）

### Step 1: 前置检查

```bash
npm run type-check    # 类型检查
npm run test:quick    # 快速测试
```

如果任一失败，**停止部署**，先修复问题。

### Step 2: 推送

```bash
git push origin main
```

### Step 3: 等待构建（最多 3 轮，每轮 60 秒）

```bash
# 等待 90 秒让构建启动
sleep 90

# 然后最多检查 3 次，每次间隔 60 秒
railway logs --num 30
```

如果 3 轮后构建仍未完成，**停止并报告构建日志**，不继续等。

### Step 4: 健康验证（最多 3 次，间隔 30 秒）

```bash
curl -sf "${API_URL}/api/v1/health"     # 后端
curl -sf "${FRONTEND_URL}/api/health"   # 前端
```

### Step 5: 结果报告

输出格式：

```
=== 部署结果 ===
构建状态: 成功/失败
后端健康: 200 OK / 失败 (错误信息)
前端健康: 200 OK / 失败 (错误信息)
总耗时: X 分钟
异常日志: 无 / [具体错误]
```

---

## 硬性限制

- **最多 10 次外部命令调用**（railway logs / curl），超过立即停止
- **绝不无限循环**监控日志
- 如有异常，给出具体文件位置和修复建议，然后**停止**
- 如需持续监控，告知用户使用 `bash scripts/devops/monitor-production.sh`

## 回滚

如果部署后健康检查连续 2 次失败：

```bash
git revert HEAD --no-edit
git push origin main
```

报告回滚原因和失败日志。

## 离线监控

日常生产监控不要在交互会话中进行，使用：

```bash
# 一次性检查
bash scripts/devops/monitor-production.sh

# 静默模式（无异常不输出）
bash scripts/devops/monitor-production.sh --quiet

# 指定行数
bash scripts/devops/monitor-production.sh --lines 200
```
