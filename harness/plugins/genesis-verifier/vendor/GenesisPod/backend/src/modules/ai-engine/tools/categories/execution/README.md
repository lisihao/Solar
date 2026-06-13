# Python Executor Tool

Python 代码执行工具 - 在安全沙箱中执行 Python 代码

## 功能特性

- ✅ 安全的代码执行环境
- ✅ 支持传递上下文变量
- ✅ 自动捕获 stdout 和 stderr
- ✅ 支持 matplotlib 图表自动捕获
- ✅ 超时控制（默认 30 秒）
- ✅ 内存限制（默认 512 MB）
- ✅ 基本的安全检查（禁止危险模块）

## 使用示例

### 基本用法

```typescript
import { PythonExecutorTool } from "./python-executor.tool";

const tool = new PythonExecutorTool();

const result = await tool.execute(
  {
    code: `
print("Hello, World!")
result = 2 + 2
print(f"2 + 2 = {result}")
_result = result  # 将作为返回值
    `,
  },
  {
    taskId: "test-task",
  },
);

console.log(result.data?.stdout);
// 输出:
// Hello, World!
// 2 + 2 = 4

console.log(result.data?.returnValue);
// 输出: 4
```

### 传递上下文变量

```typescript
const result = await tool.execute(
  {
    code: `
print(f"用户名: {username}")
print(f"年龄: {age}")

# 使用传入的数据
data_sum = sum(numbers)
_result = {
    'username': username,
    'age': age,
    'sum': data_sum
}
    `,
    context: {
      variables: {
        username: "Alice",
        age: 30,
        numbers: [1, 2, 3, 4, 5],
      },
    },
  },
  {
    taskId: "test-task",
  },
);

console.log(result.data?.returnValue);
// 输出: { username: 'Alice', age: 30, sum: 15 }
```

### 数据分析

```typescript
const result = await tool.execute(
  {
    code: `
import numpy as np
import pandas as pd

# 创建数据
data = pd.DataFrame({
    'name': ['Alice', 'Bob', 'Charlie'],
    'age': [25, 30, 35],
    'salary': [50000, 60000, 70000]
})

# 统计分析
_result = {
    'mean_age': data['age'].mean(),
    'mean_salary': data['salary'].mean(),
    'total_salary': data['salary'].sum()
}
    `,
  },
  {
    taskId: "test-task",
  },
);

console.log(result.data?.returnValue);
// 输出: { mean_age: 30, mean_salary: 60000, total_salary: 180000 }
```

### 生成图表

```typescript
const result = await tool.execute(
  {
    code: `
import matplotlib.pyplot as plt
import numpy as np

# 生成数据
x = np.linspace(0, 10, 100)
y = np.sin(x)

# 绘制图表
plt.figure(figsize=(10, 6))
plt.plot(x, y, label='sin(x)')
plt.xlabel('x')
plt.ylabel('y')
plt.title('Sine Wave')
plt.legend()
plt.grid(True)

# 图表会自动被捕获
    `,
  },
  {
    taskId: "test-task",
  },
);

// 图表数据
const figures = result.data?.figures;
if (figures && figures.length > 0) {
  const figure = figures[0];
  console.log(`图表格式: ${figure.format}`);
  console.log(`图表数据 (Base64): ${figure.data.substring(0, 50)}...`);

  // 可以将 Base64 数据转换为图片文件或直接在前端显示
}
```

### 设置超时和内存限制

```typescript
const result = await tool.execute(
  {
    code: `
import time

# 模拟长时间运行的任务
for i in range(10):
    print(f"Processing {i}...")
    time.sleep(0.5)

_result = "完成"
    `,
    options: {
      timeout: 10000, // 10 秒超时
      memoryLimit: 256, // 256 MB 内存限制
    },
  },
  {
    taskId: "test-task",
  },
);
```

## 安全限制

为了保证安全性，以下操作会被禁止：

### 禁止的模块

- `os` - 操作系统接口
- `subprocess` - 子进程管理
- `sys` - 系统特定参数
- `shutil` - 高级文件操作
- `socket` - 网络通信
- `urllib`, `requests`, `http` - HTTP 请求
- `ftplib`, `telnetlib` - 网络协议
- `pickle`, `marshal` - 对象序列化
- `ctypes` - C 语言接口

### 禁止的函数

- `eval()` - 动态执行代码
- `exec()` - 动态执行代码
- `compile()` - 编译代码
- `open()` - 文件操作
- `__import__()` - 动态导入

## 输出格式

### 成功执行

```typescript
{
  success: true,
  stdout: "标准输出内容",
  stderr: "",
  returnValue: { /* 返回值 */ },
  figures: [
    {
      type: "image",
      format: "png",
      data: "base64编码的图片数据"
    }
  ],
  executionTime: 1234 // 毫秒
}
```

### 执行失败

```typescript
{
  success: false,
  stdout: "部分输出",
  stderr: "错误信息",
  returnValue: undefined,
  figures: [],
  executionTime: 100
}
```

## 返回值约定

代码可以通过以下方式设置返回值：

1. 使用 `_result` 变量（推荐）

   ```python
   _result = {"key": "value"}
   ```

2. 最后一个表达式的值（如果有）
   ```python
   # 这个值可能被自动捕获
   some_value
   ```

## 依赖要求

### Python 环境

- Python 3.7+
- 必需库：无（使用标准库即可）
- 可选库：
  - `numpy` - 数值计算
  - `pandas` - 数据分析
  - `matplotlib` - 数据可视化

### Node.js 模块

- `child_process` - 进程管理
- `path` - 路径处理

## 注意事项

1. **安全性**：代码在子进程中执行，但仍需谨慎处理用户输入
2. **超时**：长时间运行的任务会被自动终止
3. **内存**：需要合理设置内存限制，避免资源耗尽
4. **图表**：只有使用 matplotlib 的图表会被自动捕获
5. **错误处理**：Python 异常会被捕获并返回在 stderr 中

## 故障排查

### 问题：Python 不可用

**症状**：执行失败，错误信息 "spawn python3 ENOENT"

**解决方案**：

- 确保系统安装了 Python 3
- 检查 `python3` 命令是否在 PATH 中
- 或修改代码使用 `python` 而不是 `python3`

### 问题：图表没有被捕获

**症状**：`figures` 数组为空

**解决方案**：

- 确保安装了 matplotlib
- 不要使用 `plt.show()`，直接创建图表即可
- 检查 matplotlib 后端设置

### 问题：超时错误

**症状**：执行被中断，"Execution timeout" 错误

**解决方案**：

- 增加 `options.timeout` 值
- 优化代码，减少执行时间
- 对于长时间任务，考虑分批处理

## 开发计划

- [ ] 支持更多的图表库（plotly, seaborn 等）
- [ ] 支持文件上传和下载
- [ ] 更精细的安全沙箱（容器化）
- [ ] 支持多个代码块的顺序执行
- [ ] 代码执行历史和缓存
