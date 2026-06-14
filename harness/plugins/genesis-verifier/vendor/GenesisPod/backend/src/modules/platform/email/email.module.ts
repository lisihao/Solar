import { Module, Global } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { EmailService } from "./email.service";
import { EmailNotificationPresetsService } from "./presets/email-notification-presets.service";
import { HandlebarsRendererService } from "./rendering/handlebars-renderer.service";

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    EmailService,
    EmailNotificationPresetsService,
    HandlebarsRendererService,
  ],
  exports: [
    EmailService,
    EmailNotificationPresetsService,
    HandlebarsRendererService,
  ],
})
export class EmailModule {}
