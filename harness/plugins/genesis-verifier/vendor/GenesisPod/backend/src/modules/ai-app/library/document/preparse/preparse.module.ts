/**
 * PreparseModule (W1 v2.0 rebuild)
 *
 * 给 RAGModule / WikiModule 提供 PreparseService。
 * 依赖 ContentFetchModule（直接 import 而非走 AiEngineModule god-module）—
 * 后者在 prod 启动期触发 ContentProcessingModule 循环加载（见 prod
 * NestJS bootstrap "ContentFetchModule.imports[0] is undefined" 事故，
 * 2026-05-12）。AiEngineModule 拉太多东西，加上 PreparseModule 这条新边
 * 让 evaluation 排序穿过 ContentProcessingModule 之前。
 */

import { Module } from "@nestjs/common";
import { PrismaModule } from "../../../../../common/prisma/prisma.module";
import { ContentFetchModule } from "../../../../ai-engine/content/fetch/content-fetch.module";
import { PreparseService } from "./preparse.service";

@Module({
  imports: [PrismaModule, ContentFetchModule],
  providers: [PreparseService],
  exports: [PreparseService],
})
export class PreparseModule {}
