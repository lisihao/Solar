# GenesisPod - Service Management Scripts

## 使用说明

### 停止所有服务

```bash
stop-all.bat
```

这个脚本会：

- 检测端口 3000, 3001, 4000, 5000, 5001 是否被占用
- 如果有进程占用，自动杀掉这些进程
- 等待端口完全释放

### 启动所有服务

```bash
start-all.bat
```

这个脚本会：

1. 自动调用 `stop-all.bat` 清理现有服务
2. 按顺序启动三个服务：
   - **Frontend** (端口 3000) - Next.js 应用
   - **Backend** (端口 4000) - NestJS API
   - **AI Service** (端口 5000) - FastAPI AI服务
3. 验证所有服务是否成功启动
4. 显示访问URL

### 服务端口配置

- Frontend: http://localhost:3000
- Backend: http://localhost:4000/api/v1
- AI Service: http://localhost:5000/docs

## 注意事项

1. 脚本使用 UTF-8 编码（`chcp 65001`），支持中文显示
2. 建议在 Windows 命令提示符（cmd.exe）中运行这些脚本
3. 每次启动服务前会自动清理端口冲突
4. 服务启动顺序已优化，确保依赖关系正确

## 最近修复

- **AI Service Unicode 编码错误**：修复了 Windows 环境下 emoji 显示问题
- **端口冲突处理**：自动检测并清理端口占用
- **固定端口配置**：确保服务始终在指定端口启动
