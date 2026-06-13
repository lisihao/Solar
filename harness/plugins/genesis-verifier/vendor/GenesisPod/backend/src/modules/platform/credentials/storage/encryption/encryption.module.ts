import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EncryptionService } from "./encryption.service";
import { KEK_PROVIDER, IKekProvider } from "./kek/kek-provider.interface";
import { EnvKekProvider } from "./kek/env-kek-provider";

/**
 * 全局模块：所有需要存储敏感凭据的模块（Secrets / UserApiKeys / AIModel apiKey ...）
 * 都复用同一个 EncryptionService 实例，保证加密 Key 和算法完全一致。
 *
 * 2026-05-28 PR-1：按 GENESIS_EDITION 装载 KEK provider（信封加密 G2）。
 *  - onprem / dev → EnvKekProvider（KEK 取自 env/文件，客户自管）
 *  - cloud        → AwsKmsKekProvider（PR-6 接入；当前回退 Env）
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: KEK_PROVIDER,
      useFactory: (config: ConfigService): IKekProvider => {
        // PR-6 将为 edition==="cloud" 返回 AwsKmsKekProvider。
        return new EnvKekProvider(config);
      },
      inject: [ConfigService],
    },
    EncryptionService,
  ],
  exports: [EncryptionService, KEK_PROVIDER],
})
export class EncryptionModule {}
