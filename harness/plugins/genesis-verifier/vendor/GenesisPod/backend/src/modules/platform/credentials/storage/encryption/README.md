# encryption

> 加解密原语与密钥轮换基础设施。

## 定位

`encryption/` 提供系统级加解密能力，供 `settings/`、`secrets/` 等目录复用。

## 明确边界

- 允许：
  - 对称加解密
  - key version 管理
  - 数据重加密与轮换支持

- 不允许：
  - Secret 资产管理
  - 设置分类读写

资产管理归 `secrets/`，配置资产归 `settings/`。
