import { Injectable, ExecutionContext } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * 可选的JWT认证守卫
 *
 * 与JwtAuthGuard不同：
 * - 如果提供了有效token，会验证并注入用户信息
 * - 如果没有提供token或token无效，不会抛出异常，只是不注入用户信息
 * - 适用于公开但可以个性化的接口（如：公开的收藏集，但登录用户可以看到更多信息）
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard("jwt") {
  canActivate(context: ExecutionContext) {
    // 总是返回true，允许请求通过
    return super.canActivate(context);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handleRequest(err: any, user: any) {
    // 如果有错误或没有用户，返回null而不是抛出异常
    // 这样路由处理器中req.user将是undefined，需要处理这种情况
    if (err || !user) {
      return null;
    }
    return user;
  }
}
