import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./strategies/jwt.strategy";
import { GoogleStrategy } from "./strategies/google.strategy";
import { PrismaModule } from "../../../common/prisma/prisma.module";
import { GoogleAuthGuard } from "./guards/google-auth.guard";

/**
 * 认证模块
 */
@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const jwtSecret = configService.get<string>("JWT_SECRET");
        if (!jwtSecret) {
          throw new Error(
            "JWT_SECRET environment variable is required but not set. " +
              "Set it in your .env file or environment configuration.",
          );
        }
        return {
          secret: jwtSecret,
          signOptions: {
            expiresIn: configService.get<string>("JWT_EXPIRES_IN", "7d"),
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  // AuthController（auth/*）已上提到 open-api/system（System HTTP → L4）。
  // AuthService/Strategy/Guard 留 L1 platform；导出 GoogleAuthGuard 供上提的
  // controller 在 open-api/system 注入（OAuth 回调端点 @UseGuards(GoogleAuthGuard)）。
  providers: [AuthService, JwtStrategy, GoogleStrategy, GoogleAuthGuard],
  exports: [AuthService, PassportModule, JwtModule, GoogleAuthGuard],
})
export class AuthModule {}
