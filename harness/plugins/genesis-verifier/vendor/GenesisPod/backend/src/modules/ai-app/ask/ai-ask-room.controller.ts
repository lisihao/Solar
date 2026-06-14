/**
 * AskRoomController - 房间专属 REST 端点
 *
 * 设计：teams-mode.md §8 API
 * 注意：会话列表 / 详情仍走 AiAskController 的 /sessions（评审收敛 §8.0）。
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "@/common/guards/jwt-auth.guard";
import { AskRoomService } from "./ai-ask-room.service";
import { AskRoomRuntimeService } from "./ai-ask-room-runtime.service";
import { AskRoomGateway } from "./ai-ask-room.gateway";
import { CreateRoomDto } from "./dto/create-room.dto";
import { UpdateRoomDto } from "./dto/update-room.dto";
import { AddMemberDto, UpdateMemberDto } from "./dto/add-member.dto";
import { SendRoomMessageDto } from "./dto/send-room-message.dto";

@ApiTags("AI Ask Room")
@Controller("ask/rooms")
@UseGuards(JwtAuthGuard)
export class AskRoomController {
  constructor(
    private readonly roomService: AskRoomService,
    private readonly runtime: AskRoomRuntimeService,
    private readonly gateway: AskRoomGateway,
  ) {}

  @Post()
  @ApiOperation({ summary: "创建房间或将 SOLO 升级为房间" })
  async createRoom(
    @Request() req: { user: { id: string } },
    @Body() dto: CreateRoomDto,
  ) {
    return this.roomService.createRoom(req.user.id, dto);
  }

  @Get(":id")
  @ApiOperation({ summary: "房间详情（含成员 + 最近 turns）" })
  async getRoom(
    @Request() req: { user: { id: string } },
    @Param("id") id: string,
  ) {
    return this.roomService.getRoom(id, req.user.id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "更新 roomConfig" })
  async updateRoom(
    @Request() req: { user: { id: string } },
    @Param("id") id: string,
    @Body() dto: UpdateRoomDto,
  ) {
    return this.roomService.updateRoom(id, req.user.id, dto);
  }

  @Post(":id/members")
  @ApiOperation({ summary: "添加 AI 成员" })
  async addMember(
    @Request() req: { user: { id: string } },
    @Param("id") id: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.roomService.addMember(id, req.user.id, dto);
  }

  @Patch(":id/members/:mid")
  @ApiOperation({ summary: "更新成员（启停 / persona / role）" })
  async updateMember(
    @Request() req: { user: { id: string } },
    @Param("id") id: string,
    @Param("mid") mid: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.roomService.updateMember(id, mid, req.user.id, dto);
  }

  @Delete(":id/members/:mid")
  @ApiOperation({ summary: "软删成员" })
  async removeMember(
    @Request() req: { user: { id: string } },
    @Param("id") id: string,
    @Param("mid") mid: string,
  ) {
    await this.roomService.removeMember(id, mid, req.user.id);
    return { ok: true };
  }

  @Post(":id/messages")
  @ApiOperation({ summary: "发送消息（立即返回 turnId，结果走 socket）" })
  async sendMessage(
    @Request() req: { user: { id: string } },
    @Param("id") id: string,
    @Body() dto: SendRoomMessageDto,
  ) {
    // 评审 W2 v3 R3 次要：内容非空已由全局 ValidationPipe + DTO IsString 校验，
    // 此处不再重复检查（class-validator 已确保 content !== "" 因为 IsString + 默认非空）。
    return this.runtime.runTurn({
      sessionId: id,
      userId: req.user.id,
      dto,
      emit: (room, event) => this.gateway.emitToRoom(room, event),
    });
  }

  @Post(":id/turns/:tid/cancel")
  @ApiOperation({ summary: "取消 turn" })
  async cancelTurn(
    @Request() req: { user: { id: string } },
    @Param("id") id: string,
    @Param("tid") tid: string,
  ) {
    await this.runtime.cancelTurn(id, tid, req.user.id);
    return { ok: true };
  }
}
