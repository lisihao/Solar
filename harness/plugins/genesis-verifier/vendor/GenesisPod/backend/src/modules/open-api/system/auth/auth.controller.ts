import {
  Controller,
  Post,
  Body,
  Get,
  Patch,
  UseGuards,
  Request,
  Response,
  Logger,
  HttpCode,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from "@nestjs/swagger";
import { AuthService } from "@/modules/platform/auth/auth.service";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { RegisterDto } from "./dto/register.dto";
import { LoginDto } from "./dto/login.dto";
import { ExchangeCodeDto } from "./dto/exchange-code.dto";
import {
  AuthResponseDto,
  RefreshTokenResponseDto,
  ExchangeCodeResponseDto,
  UserDto,
  UserStatsDto,
} from "./dto/auth-response.dto";
import { AdminAuthService } from "@/common/services";
import { Public } from "@/common/decorators/public.decorator";
import { GoogleAuthGuard } from "@/modules/platform/auth/guards/google-auth.guard";

/**
 * Auth rate limit configuration
 * Protects against brute force attacks on login/register endpoints
 */
const AUTH_RATE_LIMIT = { default: { limit: 5, ttl: 60000 } }; // 5 requests per minute
const REFRESH_RATE_LIMIT = { default: { limit: 10, ttl: 60000 } }; // 10 requests per minute

/**
 * 认证控制器
 *
 * 公开端点(register, login, exchange, google OAuth) 标记 @Public()
 * 受保护端点(refresh, me, profile, stats) 由全局 JwtAuthGuard 保护
 */
@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly adminAuthService: AdminAuthService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * 用户注册
   * POST /api/v1/auth/register
   * Rate limited: 5 requests per minute to prevent abuse
   */
  @Public()
  @Post("register")
  @HttpCode(201)
  @Throttle(AUTH_RATE_LIMIT)
  @ApiOperation({
    summary: "用户注册",
    description: "使用邮箱、用户名和密码注册新账户",
  })
  @ApiBody({ type: RegisterDto })
  @ApiResponse({
    status: 201,
    description: "注册成功",
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 400, description: "无效的输入数据" })
  @ApiResponse({ status: 409, description: "邮箱或用户名已存在" })
  @ApiResponse({ status: 429, description: "请求过于频繁，请稍后再试" })
  async register(@Body() registerDto: RegisterDto) {
    this.logger.log(`Registration attempt: ${registerDto.email}`);
    return this.authService.register(
      registerDto.email,
      registerDto.username,
      registerDto.password,
    );
  }

  /**
   * 用户登录
   * POST /api/v1/auth/login
   * Rate limited: 5 requests per minute to prevent brute force attacks
   */
  @Public()
  @Post("login")
  @HttpCode(200)
  @Throttle(AUTH_RATE_LIMIT)
  @ApiOperation({ summary: "用户登录", description: "使用邮箱和密码登录" })
  @ApiBody({ type: LoginDto })
  @ApiResponse({
    status: 200,
    description: "登录成功",
    type: AuthResponseDto,
  })
  @ApiResponse({ status: 401, description: "邮箱或密码错误" })
  @ApiResponse({ status: 429, description: "请求过于频繁，请稍后再试" })
  async login(@Request() req: ExpressRequest, @Body() loginDto: LoginDto) {
    this.logger.log(`Login attempt: ${loginDto.email}`);

    // 获取请求信息用于记录登录历史
    const requestInfo = {
      ipAddress:
        req.headers["x-forwarded-for"]?.toString().split(",")[0] ||
        req.ip ||
        (req as ExpressRequest & { connection?: { remoteAddress?: string } })
          .connection?.remoteAddress,
      userAgent: req.headers["user-agent"],
    };

    return this.authService.login(
      loginDto.email,
      loginDto.password,
      requestInfo,
    );
  }

  /**
   * 刷新 token
   * POST /api/v1/auth/refresh
   * Rate limited: 10 requests per minute
   */
  @Post("refresh")
  @HttpCode(200)
  @Throttle(REFRESH_RATE_LIMIT)
  @UseGuards(AuthGuard("jwt"))
  @ApiBearerAuth()
  @ApiOperation({
    summary: "刷新访问令牌",
    description: "使用当前令牌刷新生成新的访问令牌",
  })
  @ApiResponse({
    status: 200,
    description: "令牌刷新成功",
    type: RefreshTokenResponseDto,
  })
  @ApiResponse({ status: 401, description: "未授权或令牌无效" })
  @ApiResponse({ status: 429, description: "请求过于频繁，请稍后再试" })
  async refresh(@Request() req: { user: { id: string } }) {
    return this.authService.refreshToken(req.user.id);
  }

  /**
   * 获取当前用户信息
   * GET /api/v1/auth/me
   */
  @Get("me")
  @UseGuards(AuthGuard("jwt"))
  @ApiBearerAuth()
  @ApiOperation({
    summary: "获取当前用户信息",
    description: "获取当前登录用户的个人信息",
  })
  @ApiResponse({
    status: 200,
    description: "成功获取用户信息",
    type: UserDto,
  })
  @ApiResponse({ status: 401, description: "未授权或令牌无效" })
  async getProfile(@Request() req: { user: { id: string } }) {
    // 从数据库获取完整用户信息（包括 fullName、avatarUrl 等）
    const user = await this.authService.getFullProfile(req.user.id);
    if (!user) {
      return req.user;
    }
    // 使用 AdminAuthService 统一检查管理员权限
    const isAdmin = this.adminAuthService.isAdmin(user);
    return { ...user, isAdmin };
  }

  /**
   * Google OAuth 登录
   * GET /api/v1/auth/google
   */
  @Public()
  @Get("google")
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({
    summary: "Google OAuth 登录",
    description: "重定向到 Google 进行 OAuth 认证",
  })
  @ApiResponse({ status: 302, description: "重定向到 Google 登录页面" })
  async googleAuth() {
    // Guard redirects to Google
  }

  /**
   * Google OAuth 回调
   * GET /api/v1/auth/google/callback
   */
  @Public()
  @Get("google/callback")
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({
    summary: "Google OAuth 回调",
    description: "Google OAuth 认证成功后的回调地址",
  })
  @ApiResponse({ status: 302, description: "重定向到前端，携带授权码" })
  @ApiResponse({ status: 401, description: "OAuth 认证失败" })
  async googleAuthCallback(
    @Request()
    req: ExpressRequest & {
      user: {
        user: { email: string; id: string };
        accessToken: string;
        refreshToken: string;
      };
    },
    @Response() res: ExpressResponse,
  ) {
    // 成功认证后，返回用户信息和tokens
    const { user, accessToken, refreshToken } = req.user;

    this.logger.log(`Google OAuth callback for user: ${user.email}`);

    // 生成短期授权码（存储在 Redis 中）
    const authCode = await this.authService.generateAuthCode(
      accessToken,
      refreshToken,
      user.id,
    );

    // 重定向到前端，只携带授权码
    const frontendUrl = this.configService.get<string>(
      "FRONTEND_URL",
      "http://localhost:3000",
    );
    const redirectUrl = `${frontendUrl}/auth/callback?code=${authCode}`;

    return res.redirect(redirectUrl);
  }

  /**
   * 用授权码换取 token
   * POST /api/v1/auth/exchange
   * Rate limited: 5 requests per minute
   */
  @Public()
  @Post("exchange")
  @HttpCode(200)
  @Throttle(AUTH_RATE_LIMIT)
  @ApiOperation({
    summary: "授权码换取令牌",
    description: "使用 OAuth 授权码交换访问令牌和刷新令牌",
  })
  @ApiBody({ type: ExchangeCodeDto })
  @ApiResponse({
    status: 200,
    description: "交换成功",
    type: ExchangeCodeResponseDto,
  })
  @ApiResponse({ status: 400, description: "无效的授权码" })
  @ApiResponse({ status: 401, description: "授权码已过期" })
  @ApiResponse({ status: 429, description: "请求过于频繁，请稍后再试" })
  async exchangeAuthCode(@Body("code") code: string) {
    this.logger.log(
      `Token exchange request with code: ${code.substring(0, 8)}...`,
    );
    return this.authService.exchangeAuthCode(code);
  }

  /**
   * 更新用户个人信息
   * PATCH /api/v1/auth/profile
   */
  @Patch("profile")
  @UseGuards(AuthGuard("jwt"))
  @ApiBearerAuth()
  @ApiOperation({
    summary: "更新个人信息",
    description: "更新当前用户的个人资料",
  })
  @ApiBody({ type: UpdateProfileDto })
  @ApiResponse({
    status: 200,
    description: "更新成功",
    type: UserDto,
  })
  @ApiResponse({ status: 400, description: "无效的输入数据" })
  @ApiResponse({ status: 401, description: "未授权或令牌无效" })
  async updateProfile(
    @Request() req: { user: { id: string } },
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    this.logger.log(`Profile update request for user: ${req.user.id}`);
    return this.authService.updateProfile(req.user.id, updateProfileDto);
  }

  /**
   * 获取用户统计数据
   * GET /api/v1/auth/stats
   */
  @Get("stats")
  @UseGuards(AuthGuard("jwt"))
  @ApiBearerAuth()
  @ApiOperation({
    summary: "获取用户统计",
    description: "获取当前用户的统计数据（资源、研究、团队等）",
  })
  @ApiResponse({
    status: 200,
    description: "成功获取统计数据",
    type: UserStatsDto,
  })
  @ApiResponse({ status: 401, description: "未授权或令牌无效" })
  async getUserStats(@Request() req: { user: { id: string } }) {
    this.logger.log(`Stats request for user: ${req.user.id}`);
    return this.authService.getUserStats(req.user.id);
  }
}
