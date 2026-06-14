# settings

> 系统配置资产边界。

## 定位

`settings/` 负责数据库中的系统设置、缓存、加密设置值与管理员配置入口。

当前是单聚合目录：

- `settings.service.ts`：配置资产读写、缓存与分类访问
- `settings.controller.ts`：管理员设置接口
- `settings.module.ts`：模块装配

## 明确边界

- 允许：
  - email / smtp / site / ai / security / storage 这类系统级设置
  - 设置值的加解密与诊断
  - 设置缓存刷新

- 不允许：
  - 业务域专用配置聚合长期堆进这里
  - app 级功能开关直接以专题/产品线命名塞入 core

后续如果继续增长，优先拆成按类别的读写器，而不是继续扩张单个超大 service。
