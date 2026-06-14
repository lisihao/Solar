/**
 * Calendar Integration Tool
 * 日历集成工具 - 支持 Google Calendar、Outlook 等日历操作
 */

import { Injectable, Logger } from "@nestjs/common";
import { BaseTool } from "../../base/base-tool";
import {
  ToolContext,
  JSONSchema,
  ToolCategory,
} from "../../abstractions/tool.interface";

// ============================================================================
// Types
// ============================================================================

export type CalendarOperation =
  | "CREATE_EVENT"
  | "UPDATE_EVENT"
  | "DELETE_EVENT"
  | "GET_EVENT"
  | "LIST_EVENTS"
  | "FIND_FREE_TIME"
  | "CREATE_RECURRING_EVENT";

export type CalendarProvider = "google" | "outlook" | "apple" | "caldav";

export interface CalendarEventAttendee {
  email: string;
  name?: string;
  responseStatus?: "accepted" | "declined" | "tentative" | "needsAction";
  optional?: boolean;
}

export interface CalendarEvent {
  /**
   * 事件 ID
   */
  id?: string;

  /**
   * 事件标题
   */
  title: string;

  /**
   * 事件描述
   */
  description?: string;

  /**
   * 开始时间（ISO 8601）
   */
  startTime: string;

  /**
   * 结束时间（ISO 8601）
   */
  endTime: string;

  /**
   * 时区
   */
  timeZone?: string;

  /**
   * 地点
   */
  location?: string;

  /**
   * 是否全天事件
   */
  allDay?: boolean;

  /**
   * 参与者
   */
  attendees?: CalendarEventAttendee[];

  /**
   * 提醒设置（分钟）
   */
  reminders?: number[];

  /**
   * 重复规则（iCalendar RRULE 格式）
   */
  recurrence?: string;

  /**
   * 会议链接
   */
  conferenceLink?: string;

  /**
   * 可见性
   */
  visibility?: "public" | "private" | "default";
}

export interface CalendarIntegrationInput {
  /**
   * 操作类型
   */
  operation: CalendarOperation;

  /**
   * 日历提供商
   */
  provider: CalendarProvider;

  /**
   * 日历 ID
   */
  calendarId?: string;

  /**
   * 事件数据
   */
  eventData?: CalendarEvent;

  /**
   * 事件 ID（用于更新/删除/获取）
   */
  eventId?: string;

  /**
   * 查询参数
   */
  query?: {
    /**
     * 开始时间范围
     */
    timeMin?: string;

    /**
     * 结束时间范围
     */
    timeMax?: string;

    /**
     * 最大结果数
     */
    maxResults?: number;

    /**
     * 搜索关键词
     */
    q?: string;

    /**
     * 查找空闲时间的持续时间（分钟）
     */
    duration?: number;
  };
}

export interface CalendarIntegrationOutput {
  /**
   * 操作是否成功
   */
  success: boolean;

  /**
   * 操作类型
   */
  operation: CalendarOperation;

  /**
   * 返回的事件
   */
  event?: CalendarEvent & { id: string; htmlLink?: string };

  /**
   * 事件列表
   */
  events?: Array<CalendarEvent & { id: string; htmlLink?: string }>;

  /**
   * 空闲时间段
   */
  freeSlots?: Array<{
    start: string;
    end: string;
  }>;

  /**
   * 错误信息
   */
  error?: string;
}

// ============================================================================
// Tool Implementation
// ============================================================================

@Injectable()
export class CalendarIntegrationTool extends BaseTool<
  CalendarIntegrationInput,
  CalendarIntegrationOutput
> {
  private readonly logger = new Logger(CalendarIntegrationTool.name);

  readonly id = "calendar-integration";
  readonly sideEffect = "destructive" as const;
  readonly category: ToolCategory = "integration";
  readonly tags = ["integration", "calendar", "scheduling", "meeting"];
  readonly name = "日历集成";
  readonly description =
    "与日历服务交互，支持创建/管理日程、查询空闲时间、设置提醒等。支持 Google Calendar、Outlook 等主流日历服务。";

  readonly inputSchema: JSONSchema = {
    type: "object",
    properties: {
      operation: {
        type: "string",
        description: "操作类型",
        enum: [
          "CREATE_EVENT",
          "UPDATE_EVENT",
          "DELETE_EVENT",
          "GET_EVENT",
          "LIST_EVENTS",
          "FIND_FREE_TIME",
          "CREATE_RECURRING_EVENT",
        ],
      },
      provider: {
        type: "string",
        description: "日历提供商",
        enum: ["google", "outlook", "apple", "caldav"],
      },
      calendarId: {
        type: "string",
        description: "日历 ID（默认为主日历）",
      },
      eventData: {
        type: "object",
        description: "事件数据",
        properties: {
          title: { type: "string", description: "事件标题" },
          description: { type: "string", description: "事件描述" },
          startTime: {
            type: "string",
            format: "date-time",
            description: "开始时间",
          },
          endTime: {
            type: "string",
            format: "date-time",
            description: "结束时间",
          },
          timeZone: { type: "string", description: "时区" },
          location: { type: "string", description: "地点" },
          allDay: { type: "boolean", description: "是否全天事件" },
          attendees: {
            type: "array",
            description: "参与者",
            items: {
              type: "object",
              properties: {
                email: { type: "string" },
                name: { type: "string" },
                optional: { type: "boolean" },
              },
            },
          },
          reminders: {
            type: "array",
            description: "提醒（分钟）",
            items: { type: "number" },
          },
          recurrence: { type: "string", description: "重复规则" },
          visibility: {
            type: "string",
            enum: ["public", "private", "default"],
          },
        },
      },
      eventId: {
        type: "string",
        description: "事件 ID",
      },
      query: {
        type: "object",
        description: "查询参数",
        properties: {
          timeMin: { type: "string", format: "date-time" },
          timeMax: { type: "string", format: "date-time" },
          maxResults: { type: "number" },
          q: { type: "string" },
          duration: { type: "number", description: "空闲时间持续分钟数" },
        },
      },
    },
    required: ["operation", "provider"],
  };

  readonly outputSchema: JSONSchema = {
    type: "object",
    properties: {
      success: { type: "boolean", description: "操作是否成功" },
      operation: { type: "string", description: "操作类型" },
      event: { type: "object", description: "单个事件" },
      events: { type: "array", description: "事件列表" },
      freeSlots: { type: "array", description: "空闲时间段" },
      error: { type: "string", description: "错误信息" },
    },
  };

  constructor() {
    super();
    // defaultTimeout set in class property
  }

  validateInput(input: CalendarIntegrationInput) {
    if (!input.operation || !input.provider) {
      return false;
    }

    const { operation, eventData, eventId, query } = input;

    switch (operation) {
      case "CREATE_EVENT":
      case "CREATE_RECURRING_EVENT":
        if (!eventData?.title || !eventData?.startTime || !eventData?.endTime) {
          return false;
        }
        break;
      case "UPDATE_EVENT":
        if (!eventId) return false;
        break;
      case "DELETE_EVENT":
      case "GET_EVENT":
        if (!eventId) return false;
        break;
      case "LIST_EVENTS":
        // 可选参数
        break;
      case "FIND_FREE_TIME":
        if (!query?.timeMin || !query?.timeMax) return false;
        break;
    }

    return true;
  }

  protected async doExecute(
    input: CalendarIntegrationInput,
    _context: ToolContext,
  ): Promise<CalendarIntegrationOutput> {
    const {
      operation,
      provider,
      calendarId: _calendarId,
      eventData,
      eventId,
      query,
    } = input;

    this.logger.log(
      `[doExecute] Calendar operation: ${operation} on ${provider}`,
    );

    try {
      // 模拟日历 API 调用
      await new Promise((resolve) => setTimeout(resolve, 500));

      switch (operation) {
        case "CREATE_EVENT":
        case "CREATE_RECURRING_EVENT":
          return this.createEvent(
            eventData!,
            operation === "CREATE_RECURRING_EVENT",
          );

        case "UPDATE_EVENT":
          return this.updateEvent(eventId!, eventData);

        case "DELETE_EVENT":
          return this.deleteEvent(eventId!);

        case "GET_EVENT":
          return this.getEvent(eventId!);

        case "LIST_EVENTS":
          return this.listEvents(query);

        case "FIND_FREE_TIME":
          return this.findFreeTime(query!);

        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[doExecute] Calendar operation failed: ${errorMessage}`,
      );

      return {
        success: false,
        operation,
        error: errorMessage,
      };
    }
  }

  private createEvent(
    eventData: CalendarEvent,
    isRecurring: boolean,
  ): CalendarIntegrationOutput {
    const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    return {
      success: true,
      operation: isRecurring ? "CREATE_RECURRING_EVENT" : "CREATE_EVENT",
      event: {
        ...eventData,
        id: eventId,
        htmlLink: `https://calendar.example.com/event/${eventId}`,
      },
    };
  }

  private updateEvent(
    eventId: string,
    eventData?: CalendarEvent,
  ): CalendarIntegrationOutput {
    return {
      success: true,
      operation: "UPDATE_EVENT",
      event: {
        id: eventId,
        title: eventData?.title || "Updated Event",
        startTime: eventData?.startTime || new Date().toISOString(),
        endTime:
          eventData?.endTime || new Date(Date.now() + 3600000).toISOString(),
        htmlLink: `https://calendar.example.com/event/${eventId}`,
      },
    };
  }

  private deleteEvent(_eventId: string): CalendarIntegrationOutput {
    return {
      success: true,
      operation: "DELETE_EVENT",
    };
  }

  private getEvent(eventId: string): CalendarIntegrationOutput {
    return {
      success: true,
      operation: "GET_EVENT",
      event: {
        id: eventId,
        title: "Sample Event",
        description: "This is a sample event",
        startTime: new Date().toISOString(),
        endTime: new Date(Date.now() + 3600000).toISOString(),
        location: "Online",
        htmlLink: `https://calendar.example.com/event/${eventId}`,
      },
    };
  }

  private listEvents(
    query?: CalendarIntegrationInput["query"],
  ): CalendarIntegrationOutput {
    const now = new Date();
    const events = [
      {
        id: "evt_1",
        title: "Team Meeting",
        startTime: new Date(now.getTime() + 3600000).toISOString(),
        endTime: new Date(now.getTime() + 7200000).toISOString(),
        htmlLink: "https://calendar.example.com/event/evt_1",
      },
      {
        id: "evt_2",
        title: "Project Review",
        startTime: new Date(now.getTime() + 86400000).toISOString(),
        endTime: new Date(now.getTime() + 90000000).toISOString(),
        htmlLink: "https://calendar.example.com/event/evt_2",
      },
    ];

    return {
      success: true,
      operation: "LIST_EVENTS",
      events: events.slice(0, query?.maxResults || 10),
    };
  }

  private findFreeTime(
    query: NonNullable<CalendarIntegrationInput["query"]>,
  ): CalendarIntegrationOutput {
    const duration = query.duration || 60;
    const startTime = new Date(query.timeMin!);
    // const endTime = new Date(query.timeMax!);

    // 模拟空闲时间段
    const freeSlots = [
      {
        start: new Date(startTime.getTime() + 3600000).toISOString(),
        end: new Date(
          startTime.getTime() + 3600000 + duration * 60000,
        ).toISOString(),
      },
      {
        start: new Date(startTime.getTime() + 14400000).toISOString(),
        end: new Date(
          startTime.getTime() + 14400000 + duration * 60000,
        ).toISOString(),
      },
    ];

    return {
      success: true,
      operation: "FIND_FREE_TIME",
      freeSlots,
    };
  }
}
