import { Module } from "@nestjs/common";
import { FeedController } from "./feed.controller";
import { FeedService } from "./feed.service";
import { PrismaModule } from "../../../../common/prisma/prisma.module";

/**
 * Feed 流模块
 */
@Module({
  imports: [PrismaModule],
  controllers: [FeedController],
  providers: [FeedService],
  exports: [FeedService],
})
export class FeedModule {}
