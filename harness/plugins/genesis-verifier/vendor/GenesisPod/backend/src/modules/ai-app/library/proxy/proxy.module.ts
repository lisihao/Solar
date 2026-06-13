import { Module } from "@nestjs/common";
import { ProxyController } from "./proxy.controller";
import { NewsExtractorService } from "./news-extractor.service";
import { PuppeteerFetcherService } from "./puppeteer-fetcher.service";
import { FlareSolverrService } from "./flaresolverr.service";
import { BrowserModule } from "../../../../common/browser/browser.module";

@Module({
  imports: [BrowserModule],
  controllers: [ProxyController],
  providers: [
    NewsExtractorService,
    PuppeteerFetcherService,
    FlareSolverrService,
  ],
  exports: [PuppeteerFetcherService, FlareSolverrService],
})
export class ProxyModule {}
