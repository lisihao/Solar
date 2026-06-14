# Debug

诊断和调试问题。

**问题**: $ARGUMENTS

## 诊断流程

```
1. 收集错误信息
   ├── 用户报告的症状
   ├── 后端日志 (Railway/控制台)
   ├── 前端控制台日志
   └── 相关代码上下文

2. 识别根因
   ├── API 错误 (4xx/5xx)
   ├── 数据库问题
   ├── 状态管理 Bug
   └── 逻辑错误

3. 追踪错误路径
   ├── Frontend → API call
   ├── Backend → Service layer
   ├── Service → Database
   └── External APIs

4. 修复 & 验证
```

## 调试检查清单

### API 问题

- [ ] 检查 Network 请求
- [ ] 验证请求参数
- [ ] 检查响应状态和内容
- [ ] 检查 CORS 错误
- [ ] 检查认证头

### 后端问题

- [ ] 检查 NestJS logger 输出
- [ ] 验证 service 方法被调用
- [ ] 检查数据库查询结果
- [ ] 检查未处理的 Promise rejection
- [ ] 检查外部 API 响应

### 数据库问题

- [ ] Prisma schema 是否同步
- [ ] 迁移是否有问题
- [ ] 数据类型是否匹配
- [ ] NULL 处理是否正确
- [ ] 是否有竞态条件

## 常用命令

```bash
# 本地后端日志
npm run dev:backend

# 数据库查看
npx prisma studio

# 类型检查
npm run type-check
```

## 输出

提供根因分析和修复建议，或直接修复问题。
