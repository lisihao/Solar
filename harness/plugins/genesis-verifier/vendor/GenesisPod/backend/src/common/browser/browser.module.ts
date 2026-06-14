import { Module } from "@nestjs/common";
import { BrowserService } from "./browser.service";
import { PuppeteerPoolService } from "./puppeteer-pool.service";

@Module({
  providers: [BrowserService, PuppeteerPoolService],
  exports: [BrowserService, PuppeteerPoolService],
})
export class BrowserModule {}
