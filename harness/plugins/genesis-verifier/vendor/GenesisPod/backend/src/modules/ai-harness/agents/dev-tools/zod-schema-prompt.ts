/**
 * zod-schema-prompt — 把 Zod schema 转成给 LLM 看的 JSON 形状描述
 *
 * 给 ReAct loop / 任何调 LLM 的地方用：让 LLM 知道 finalize.output 的精确字段名 + 类型，
 * 减少"LLM 自由发挥导致 schema 校验失败"。
 *
 * 不依赖 zod-to-json-schema 第三方包：手写一个最小可用的 walker，
 * 覆盖 ZodObject / ZodArray / ZodString / ZodNumber / ZodBoolean / ZodEnum /
 * ZodOptional / ZodNullable / ZodUnion 等常用类型。
 */

import { z } from "zod";

const MAX_DEPTH = 5;

interface DescribeOptions {
  depth?: number;
  inArray?: boolean;
}

function indent(n: number): string {
  return "  ".repeat(n);
}

function describeOne(schema: z.ZodTypeAny, opts: DescribeOptions = {}): string {
  const depth = opts.depth ?? 0;
  if (depth > MAX_DEPTH) return "<...>";

  const def = schema._def as { typeName?: string };
  const typeName = def.typeName;

  // Strip wrappers
  if (typeName === "ZodOptional") {
    return (
      describeOne((schema as z.ZodOptional<z.ZodTypeAny>).unwrap(), opts) +
      " // optional"
    );
  }
  if (typeName === "ZodNullable") {
    return (
      describeOne((schema as z.ZodNullable<z.ZodTypeAny>).unwrap(), opts) +
      " | null"
    );
  }
  if (typeName === "ZodDefault") {
    return describeOne(
      (schema as z.ZodDefault<z.ZodTypeAny>).removeDefault(),
      opts,
    );
  }

  if (typeName === "ZodObject") {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const lines: string[] = ["{"];
    for (const [key, child] of Object.entries(shape)) {
      const inner = describeOne(child, {
        depth: depth + 1,
      });
      lines.push(`${indent(depth + 1)}"${key}": ${inner},`);
    }
    lines.push(`${indent(depth)}}`);
    return lines.join("\n");
  }
  if (typeName === "ZodArray") {
    const el = (schema as z.ZodArray<z.ZodTypeAny>).element;
    const constraints = describeArrayConstraints(
      schema as z.ZodArray<z.ZodTypeAny>,
    );
    return `[\n${indent(depth + 1)}${describeOne(el, { depth: depth + 1, inArray: true })},\n${indent(depth + 1)}// ...${constraints}\n${indent(depth)}]`;
  }
  if (typeName === "ZodString") {
    return describeStringConstraints(schema as z.ZodString);
  }
  if (typeName === "ZodNumber") {
    return describeNumberConstraints(schema as z.ZodNumber);
  }
  if (typeName === "ZodBoolean") return "<boolean>";
  if (typeName === "ZodEnum") {
    const values = (schema as z.ZodEnum<[string, ...string[]]>).options;
    return values.map((v) => `"${v}"`).join(" | ");
  }
  if (typeName === "ZodLiteral") {
    const v = (schema as z.ZodLiteral<unknown>)._def.value;
    return JSON.stringify(v);
  }
  if (typeName === "ZodUnion") {
    const opts2 = (schema as z.ZodUnion<[z.ZodTypeAny, ...z.ZodTypeAny[]]>)
      .options;
    return opts2
      .map((o: z.ZodTypeAny) => describeOne(o, { depth }))
      .join(" | ");
  }
  if (typeName === "ZodRecord") {
    return "{ <key>: <value> }";
  }
  if (typeName === "ZodAny" || typeName === "ZodUnknown") return "<any>";
  return `<${typeName ?? "unknown"}>`;
}

function describeStringConstraints(s: z.ZodString): string {
  const checks = s._def.checks ?? [];
  const parts: string[] = ["<string"];
  for (const c of checks) {
    if (c.kind === "min") parts.push(`>=${c.value} chars`);
    if (c.kind === "max") parts.push(`<=${c.value} chars`);
    if (c.kind === "url") parts.push("URL");
    if (c.kind === "email") parts.push("email");
    if (c.kind === "uuid") parts.push("uuid");
  }
  return `${parts.join(" ")}>`;
}

function describeNumberConstraints(s: z.ZodNumber): string {
  const checks = s._def.checks ?? [];
  const parts: string[] = ["<number"];
  for (const c of checks) {
    if (c.kind === "min") parts.push(`>=${c.value}`);
    if (c.kind === "max") parts.push(`<=${c.value}`);
    if (c.kind === "int") parts.push("integer");
  }
  return `${parts.join(" ")}>`;
}

function describeArrayConstraints(arr: z.ZodArray<z.ZodTypeAny>): string {
  const def = arr._def as {
    minLength?: { value: number };
    maxLength?: { value: number };
  };
  const min = def.minLength?.value;
  const max = def.maxLength?.value;
  if (min != null && max != null) return ` (${min}-${max} items)`;
  if (min != null) return ` (>=${min} items)`;
  if (max != null) return ` (<=${max} items)`;
  return "";
}

/**
 * 给定 Zod outputSchema，生成可贴到 system prompt 的英文描述块。
 */
export function describeOutputSchemaForLlm(
  schema: z.ZodTypeAny | undefined,
): string | null {
  if (!schema) return null;
  try {
    const shape = describeOne(schema, { depth: 0 });
    return [
      "## Required output schema (the `output` field of your finalize action)",
      "",
      "Your `finalize.output` value MUST be a JSON object that exactly matches:",
      "",
      "```json",
      shape,
      "```",
      "",
      "Use these EXACT field names. Do NOT invent alternative names like",
      '"description", "title", "scope", "whyMECE", "keyQuestions", etc.',
      "If a field is marked `// optional`, you may omit it; everything else is required.",
    ].join("\n");
  } catch {
    return null;
  }
}
