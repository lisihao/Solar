import { ExecutionContext, Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class GoogleAuthGuard extends AuthGuard("google") {
  override getAuthenticateOptions(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      query?: { login_hint?: string };
    }>();
    const loginHint = request.query?.login_hint?.trim();

    return {
      prompt: "select_account",
      ...(loginHint ? { loginHint, login_hint: loginHint } : {}),
    };
  }
}
