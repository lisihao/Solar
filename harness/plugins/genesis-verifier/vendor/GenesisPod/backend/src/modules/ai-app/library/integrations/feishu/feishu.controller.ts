/**
 * Feishu Event Subscription Controller
 *
 * Handles:
 * 1. URL verification (challenge-response)
 * 2. Event callbacks (messages, etc.)
 *
 * Setup:
 * 1. Create a Feishu app at https://open.feishu.cn
 * 2. Set Event Subscription URL to: https://your-domain/api/v1/feishu/callback
 * 3. Configure Encrypt Key and Verification Token
 * 4. Subscribe to im.message.receive_v1 event
 */

import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  Logger,
  HttpStatus,
  Res,
  Req,
} from "@nestjs/common";
import { Request, Response } from "express";
import { ApiTags } from "@nestjs/swagger";
import { FeishuService } from "./feishu.service";
import { FeishuCryptoService } from "./feishu-crypto.service";
import { FeishuAuthService } from "./feishu-auth.service";
import { Public } from "../../../../../common/decorators/public.decorator";

/**
 * Feishu event callback body structure
 */
interface FeishuCallbackBody {
  // Challenge verification
  challenge?: string;
  token?: string;
  type?: string;

  // Encrypted payload (v2)
  encrypt?: string;

  // Event v2 schema (plaintext)
  schema?: string;
  header?: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event?: Record<string, unknown>;
}

@ApiTags("Feishu Integration")
@Controller("feishu")
export class FeishuController {
  private readonly logger = new Logger(FeishuController.name);

  constructor(
    private readonly feishuService: FeishuService,
    private readonly cryptoService: FeishuCryptoService,
    private readonly authService: FeishuAuthService,
  ) {}

  /**
   * Feishu Event Subscription callback (POST)
   * Handles both challenge verification and event dispatch
   */
  @Public()
  @Post("callback")
  async handleCallback(
    @Req() req: Request,
    @Body() body: FeishuCallbackBody,
    @Headers("x-lark-request-timestamp") timestamp: string,
    @Headers("x-lark-request-nonce") nonce: string,
    @Headers("x-lark-signature") signature: string,
    @Res() res: Response,
  ) {
    this.logger.log(
      `Feishu callback: type=${body.type || "event"}, encrypted=${!!body.encrypt}`,
    );

    // Step 1: Handle challenge verification
    if (body.type === "url_verification" && body.challenge) {
      this.logger.log("URL verification challenge received");
      return res.status(HttpStatus.OK).json({ challenge: body.challenge });
    }

    // Step 2: Handle encrypted events
    let eventBody: FeishuCallbackBody = body;
    if (body.encrypt) {
      try {
        // Verify signature if headers present
        if (timestamp && nonce && signature) {
          // Use raw body for signature verification (JSON.stringify may alter field order)
          const rawBody =
            (req as Request & { rawBody?: Buffer }).rawBody?.toString(
              "utf-8",
            ) || JSON.stringify(body);
          const isValid = this.cryptoService.verifySignature(
            timestamp,
            nonce,
            signature,
            rawBody,
          );
          if (!isValid) {
            this.logger.warn("Feishu signature verification failed");
            return res.status(HttpStatus.OK).json({});
          }
        }

        const decrypted = this.cryptoService.decrypt(body.encrypt);
        eventBody = JSON.parse(decrypted);

        // Decrypted content may also be a challenge
        if (eventBody.type === "url_verification" && eventBody.challenge) {
          this.logger.log("URL verification challenge (encrypted)");
          return res
            .status(HttpStatus.OK)
            .json({ challenge: eventBody.challenge });
        }
      } catch (error) {
        this.logger.error(`Failed to decrypt event: ${error}`);
        return res.status(HttpStatus.OK).json({});
      }
    }

    // Step 3: Dispatch event
    if (eventBody.header && eventBody.event) {
      const eventType = eventBody.header.event_type;
      this.logger.log(
        `Event: type=${eventType}, id=${eventBody.header.event_id}`,
      );

      // Process async, respond immediately (Feishu requires response within 3s)
      this.feishuService
        .handleEvent(eventType, eventBody.event, eventBody.header)
        .catch((error) => {
          this.logger.error(`Error processing event ${eventType}: ${error}`);
        });
    }

    return res.status(HttpStatus.OK).json({});
  }

  /**
   * Health check
   */
  @Public()
  @Get("health")
  healthCheck() {
    const isConfigured = this.authService.isConfigured();
    return {
      status: isConfigured ? "ready" : "not_configured",
      appId: isConfigured ? this.authService.getMaskedAppId() : null,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Send message (internal API)
   */
  @Post("send")
  async sendMessage(
    @Body()
    body: {
      receiveId: string;
      receiveIdType?: "open_id" | "user_id" | "union_id" | "email" | "chat_id";
      msgType: "text" | "post" | "interactive";
      content: string;
    },
  ) {
    try {
      const result = await this.feishuService.sendMessage({
        receiveId: body.receiveId,
        receiveIdType: body.receiveIdType || "open_id",
        msgType: body.msgType,
        content: body.content,
      });
      return result;
    } catch (error) {
      this.logger.error(`Failed to send message: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
