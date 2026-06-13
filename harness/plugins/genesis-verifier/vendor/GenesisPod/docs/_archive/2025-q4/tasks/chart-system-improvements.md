# 图表系统遗留问题

> 创建时间: 2025-01-27
> 关联提交: 50de9c26 feat(research): implement comprehensive chart system

## 优先级：中

### 1. 前端验证工具集成

**文件**: `frontend/lib/chart-validation.ts`

**问题**:

- `validateChartData` 和 `cleanChartData` 函数已创建但未被渲染组件直接调用
- 数据清洗仅在后端进行，前端可增加一层防御

**建议方案**:

```typescript
// FigureRenderer.tsx 渲染前调用
const cleanedChart = cleanChartData(chart);
return <ReportChartRenderer chart={cleanedChart} />;
```

**预估工作量**: 0.5h

---

### 2. ReportValidationService API 暴露

**文件**: `backend/src/modules/ai-app/research/topic-research/services/report-validation.service.ts`

**问题**:

- 服务已创建但未被 Controller 调用
- 前端无法主动触发报告验证

**建议方案**:

1. 在 `topic-research.controller.ts` 添加端点:

   ```typescript
   @Get(':topicId/reports/:reportId/validate')
   async validateReport(@Param('topicId') topicId: string, @Param('reportId') reportId: string) {
     return this.reportValidationService.validateReport(topicId, reportId);
   }
   ```

2. 前端添加 "验证报告" 按钮（可选）

**预估工作量**: 1h

---

## 优先级：低

### 3. 图表验证结果展示

**问题**:

- 验证结果目前只在日志中
- 用户无法看到验证警告（如饼图百分比不等于 100%）

**建议方案**:

- 在报告页面添加验证状态指示器
- 点击后显示详细验证结果

**预估工作量**: 2h

---

### 4. 图表数据缓存优化

**问题**:

- 大量图表时可能有性能问题
- 目前未使用 React Query 或 SWR 缓存

**建议方案**:

- 评估是否需要图表数据缓存
- 考虑 lazy loading 大型图表

**预估工作量**: 3h

---

## 已完成事项

- [x] ChartErrorBoundary 错误边界组件
- [x] FigureRenderer 类型验证
- [x] enableFigures 配置传递
- [x] ReportValidationService 验证层
- [x] chart-validation.ts 前端工具
- [x] 性能优化 (memoization)
- [x] 空状态和错误提示改进
- [x] 可访问性改进 (ARIA)
- [x] console.log 清理

---

## 相关文件

| 模块     | 文件路径                                                        |
| -------- | --------------------------------------------------------------- |
| 错误边界 | `frontend/components/ai-research/charts/ChartErrorBoundary.tsx` |
| 图表渲染 | `frontend/components/ai-research/charts/FigureRenderer.tsx`     |
| 前端验证 | `frontend/lib/chart-validation.ts`                              |
| 后端验证 | `backend/.../services/report-validation.service.ts`             |
| 图表提取 | `backend/.../services/figure-extractor.service.ts`              |
