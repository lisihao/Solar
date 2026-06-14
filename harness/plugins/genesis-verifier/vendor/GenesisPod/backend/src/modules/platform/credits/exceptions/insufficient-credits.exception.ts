import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * 积分不足异常
 */
export class InsufficientCreditsException extends HttpException {
  constructor(required: number, available: number) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: "INSUFFICIENT_CREDITS",
        message: "Insufficient credits for this operation",
        required,
        available,
        deficit: required - available,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}

/**
 * 账户冻结异常
 */
export class AccountFrozenException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.FORBIDDEN,
        error: "ACCOUNT_FROZEN",
        message: "Credit account is frozen",
      },
      HttpStatus.FORBIDDEN,
    );
  }
}

/**
 * 已签到异常
 */
export class AlreadyCheckedInException extends HttpException {
  constructor() {
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        error: "ALREADY_CHECKED_IN",
        message: "You have already checked in today",
      },
      HttpStatus.CONFLICT,
    );
  }
}
