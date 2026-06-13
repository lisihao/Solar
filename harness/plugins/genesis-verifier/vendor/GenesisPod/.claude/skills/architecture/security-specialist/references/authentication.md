# Authentication Implementation

## JWT Configuration

```typescript
// auth.module.ts
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get("JWT_SECRET"),
        signOptions: {
          expiresIn: config.get("JWT_EXPIRES_IN", "1h"),
          issuer: "genesis-ai",
          audience: "genesis-users",
        },
      }),
    }),
    PassportModule.register({ defaultStrategy: "jwt" }),
  ],
  providers: [AuthService, JwtStrategy, LocalStrategy],
  exports: [AuthService],
})
export class AuthModule {}
```

## JWT Payload Structure

```typescript
interface JwtPayload {
  sub: string; // User ID
  email: string;
  roles: string[];
  permissions?: string[];
  iat: number; // Issued at
  exp: number; // Expiration
  jti: string; // Token ID (for revocation)
}

interface TokenPair {
  accessToken: string; // Short-lived (1h)
  refreshToken: string; // Long-lived (7d)
}
```

## Token Generation

```typescript
@Injectable()
export class AuthService {
  async generateTokens(user: User): Promise<TokenPair> {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      roles: user.roles,
      jti: crypto.randomUUID(),
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: "1h",
    });

    const refreshToken = this.jwtService.sign(
      { sub: user.id, jti: crypto.randomUUID() },
      { expiresIn: "7d", secret: this.configService.get("JWT_REFRESH_SECRET") },
    );

    // Store refresh token hash for revocation
    await this.storeRefreshToken(user.id, refreshToken);

    return { accessToken, refreshToken };
  }

  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    const payload = this.jwtService.verify(refreshToken, {
      secret: this.configService.get("JWT_REFRESH_SECRET"),
    });

    // Verify token not revoked
    const isValid = await this.verifyRefreshToken(payload.sub, refreshToken);
    if (!isValid) {
      throw new UnauthorizedException("Refresh token revoked");
    }

    const user = await this.usersService.findById(payload.sub);
    return this.generateTokens(user);
  }

  async revokeAllTokens(userId: string): Promise<void> {
    await this.tokenStore.delete(`refresh:${userId}`);
  }
}
```

## JWT Strategy

```typescript
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get("JWT_SECRET"),
      issuer: "genesis-ai",
      audience: "genesis-users",
    });
  }

  async validate(payload: JwtPayload): Promise<User> {
    const user = await this.usersService.findById(payload.sub);

    if (!user || !user.isActive) {
      throw new UnauthorizedException("User not found or inactive");
    }

    // Check if token was issued before password change
    if (
      user.passwordChangedAt &&
      payload.iat < user.passwordChangedAt.getTime() / 1000
    ) {
      throw new UnauthorizedException("Password changed, please re-login");
    }

    return user;
  }
}
```

## Rate Limiting

```typescript
@Module({
  imports: [
    ThrottlerModule.forRoot([
      { name: "short", ttl: 1000, limit: 10 }, // 10/second
      { name: "medium", ttl: 10000, limit: 50 }, // 50/10 seconds
      { name: "long", ttl: 60000, limit: 200 }, // 200/minute
    ]),
  ],
})
export class AppModule {}

// Sensitive endpoints
@Controller("auth")
export class AuthController {
  @Post("login")
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5/minute
  login(@Body() dto: LoginDto) {}

  @Post("forgot-password")
  @Throttle({ default: { limit: 3, ttl: 300000 } }) // 3/5 minutes
  forgotPassword(@Body() dto: ForgotPasswordDto) {}
}
```
