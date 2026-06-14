/**
 * AI Engine - LLM Abstractions
 */
export * from "./llm-adapter.interface";
// function-calling-protocol 不通过 barrel re-export（与 llm-adapter.interface 同名异构接口）
// 消费者直接 import 自 "./function-calling-protocol"
