# secrets

> 系统级密钥资产边界。

## 定位

`secrets/` 负责系统 Secret 的存储、加密、审计、命名归一和查询。

它和 `credentials/` 的区别是：

- `secrets/` 管系统级密钥资产
- `credentials/` 管用户 key、分发 key、assignment、runtime key resolution

## 当前文件职责

- `secrets.service.ts`：密钥资产的核心读写、审计、版本管理
- `secrets.controller.ts`：管理员入口
- `secret-name.catalog.ts`：系统 Secret 命名归一与元数据映射
- `dto/`：输入输出对象

## 禁止事项

- 禁止把用户自有 API key CRUD 放进 `secrets/`
- 禁止在上层模块直接硬编码系统 Secret 名称而绕过这里的命名归一
