# 多素材AI报告生成功能 - 使用指南

## 功能概述

GenesisPod现在支持选择2-10个资源（论文/项目/新闻），使用AI生成综合分析报告。

## 快速开始

### 1. 启动所有服务

确保以下服务正在运行：

```bash
# 后端服务 (端口 4000)
cd backend && npm run dev

# 前端服务 (端口 3000)
cd frontend && npm run dev

# AI服务 (端口 5000)
cd ai-service && python -m uvicorn main:app --host 0.0.0.0 --port 5000 --reload
```

### 2. 访问测试页面

打开浏览器访问：http://localhost:3000/reports/test

### 3. 使用流程

#### 步骤1: 选择资源

- 页面会自动加载最近的20条资源
- 点击资源卡片进行选择（勾选框会高亮显示）
- 可以选择2-10个资源

#### 步骤2: 选择报告模板

- 选择足够的资源后，顶部会出现红色工具栏
- 点击"生成报告"按钮
- 在弹出的对话框中选择一个报告模板：
  - **对比分析** (2-5项，GPT-4，60-90秒)
  - **趋势报告** (3-8项，Grok，45-75秒)
  - **学习路径** (3-10项，Grok，50-80秒)
  - **文献综述** (5-10项，GPT-4，75-120秒)

#### 步骤3: 等待AI生成

- 点击"开始生成"后会显示加载动画
- AI需要30-120秒处理（取决于模板和资源数量）
- 请耐心等待，不要关闭页面

#### 步骤4: 查看报告

- 生成完成后会自动跳转到报告详情页
- 报告包含：
  - 标题和概要
  - 多个分析章节（Markdown格式）
  - 引用的资源列表
  - 导出为Markdown功能

## 故障排除

### 问题1: 页面显示空白，没有资源卡片

**可能原因**: 前端API配置错误或后端未返回数据

**解决方法**:

```bash
# 检查后端API
curl http://localhost:4000/api/v1/resources?take=5

# 应该返回JSON格式的资源列表
# 如果返回404或错误，检查后端是否正常运行
```

### 问题2: 点击"生成报告"后报错

**可能原因**: AI服务未启动或路由未注册

**解决方法**:

```bash
# 检查AI服务
curl http://localhost:5000/docs

# 应该返回FastAPI文档页面
# 检查是否有 /api/v1/ai/generate-report 端点
```

### 问题3: 后端无法启动 (EADDRINUSE错误)

**可能原因**: 端口4000被占用

**解决方法** (Windows):

```bash
# 查找占用端口的进程
netstat -ano | findstr ":4000"

# 停止进程 (PID是上一步返回的数字)
taskkill //F //PID <PID>

# 重新启动后端
cd backend && npm run dev
```

### 问题4: 报告生成失败

**可能原因**:

- AI服务配置问题
- API keys未正确设置
- 网络问题

**解决方法**:

1. 检查 `ai-service/.env` 文件是否包含正确的API keys
2. 查看 AI服务控制台日志
3. 确认GCP Secret Manager配置正确

## 已实现功能清单

### 前端

- [x] 多选功能 Hook (`useMultiSelect.ts`)
- [x] 报告模板配置 (`report-templates.ts`)
- [x] 模板选择对话框组件 (`ReportTemplateDialog.tsx`)
- [x] 报告详情页 (`/report/[id]/page.tsx`)
- [x] 测试页面 (`/reports/test/page.tsx`)
- [x] 修复资源列表加载 (data.data 路径)

### 后端

- [x] Report数据模型 (Prisma Schema)
- [x] 数据库迁移
- [x] Reports Module/Controller/Service
- [x] DTO验证 (`GenerateReportDto`)
- [x] 4个API端点：
  - POST /api/v1/reports/generate
  - GET /api/v1/reports/:id
  - GET /api/v1/reports
  - DELETE /api/v1/reports/:id

### AI服务

- [x] Report Router (`report.py`)
- [x] 4个报告模板提示词
- [x] JSON结构化输出
- [x] Grok和GPT-4双模型支持
- [x] 错误处理和重试逻辑

## 技术架构

```
┌─────────────┐         ┌──────────────┐         ┌─────────────┐
│             │         │              │         │             │
│  Frontend   │────────▶│   Backend    │────────▶│ AI Service  │
│  (Next.js)  │         │  (NestJS)    │         │  (FastAPI)  │
│  Port 3000  │         │  Port 4000   │         │  Port 5000  │
│             │         │              │         │             │
└─────────────┘         └──────────────┘         └─────────────┘
      │                       │                         │
      │                       │                         │
      ▼                       ▼                         ▼
  User选择资源            PostgreSQL               Grok / GPT-4
   触发报告生成           (Prisma ORM)              AI Models
```
