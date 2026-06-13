# UI 组件库技术

## 概述

GenesisPod 使用以下 UI 技术栈：

- **Radix UI**: 无障碍无头组件
- **TipTap**: 富文本编辑器
- **D3.js + Recharts**: 数据可视化
- **Framer Motion**: 动画库

## Radix UI 核心原理

### 1. 无头组件 (Headless Components)

Radix UI 提供无样式但功能完整的组件，开发者完全控制样式。

```tsx
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

function UserMenu() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="your-trigger-styles">
        <Avatar />
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content className="your-content-styles">
          <DropdownMenu.Item className="your-item-styles">
            Profile
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="your-separator-styles" />
          <DropdownMenu.Item className="your-item-styles text-red-500">
            Logout
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
```

### 2. 内置无障碍支持

Radix UI 自动处理：

- ARIA 属性
- 键盘导航
- 焦点管理
- 屏幕阅读器支持

```tsx
// Dialog 组件自动处理焦点陷阱
import * as Dialog from "@radix-ui/react-dialog";

function Modal({ open, onOpenChange, children }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
          <Dialog.Title>Modal Title</Dialog.Title>
          <Dialog.Description>Description text</Dialog.Description>
          {children}
          <Dialog.Close asChild>
            <button>Close</button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
```

### 3. Slot 组件

使用 `asChild` 将行为传递给子元素：

```tsx
import { Slot } from '@radix-ui/react-slot';

interface ButtonProps {
  asChild?: boolean;
  children: React.ReactNode;
}

function Button({ asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return <Comp className="btn" {...props} />;
}

// 使用
<Button>Normal Button</Button>
<Button asChild>
  <Link href="/page">Link styled as Button</Link>
</Button>
```

## TipTap 富文本编辑器

### 1. 基础配置

```tsx
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";

const lowlight = createLowlight(common);

function RichTextEditor({ content, onChange }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false, // 使用 CodeBlockLowlight 替代
      }),
      Placeholder.configure({
        placeholder: "开始输入...",
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  return <EditorContent editor={editor} />;
}
```

### 2. 工具栏实现

```tsx
function Toolbar({ editor }) {
  if (!editor) return null;

  return (
    <div className="flex gap-1 p-2 border-b">
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        className={editor.isActive("bold") ? "is-active" : ""}
      >
        <Bold size={16} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        className={editor.isActive("italic") ? "is-active" : ""}
      >
        <Italic size={16} />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        className={editor.isActive("codeBlock") ? "is-active" : ""}
      >
        <Code size={16} />
      </button>
    </div>
  );
}
```

### 3. 自定义扩展

```tsx
import { Extension } from "@tiptap/core";

const CustomExtension = Extension.create({
  name: "customExtension",

  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => {
        // 自定义快捷键行为
        return true;
      },
    };
  },

  addCommands() {
    return {
      customCommand:
        () =>
        ({ commands }) => {
          return commands.insertContent("Custom content");
        },
    };
  },
});
```

## D3.js 数据可视化

### 1. 核心原理：数据绑定

D3.js 的核心是将数据绑定到 DOM 元素：

```tsx
import * as d3 from "d3";
import { useEffect, useRef } from "react";

function BarChart({ data }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);

    // 数据绑定
    svg
      .selectAll("rect")
      .data(data)
      .join(
        // Enter: 新数据
        (enter) => enter.append("rect").attr("fill", "steelblue"),
        // Update: 现有数据
        (update) => update.attr("fill", "steelblue"),
        // Exit: 移除的数据
        (exit) => exit.remove(),
      )
      .attr("x", (d, i) => i * 50)
      .attr("y", (d) => 200 - d.value)
      .attr("width", 40)
      .attr("height", (d) => d.value);
  }, [data]);

  return <svg ref={svgRef} width={500} height={200} />;
}
```

### 2. 比例尺 (Scales)

```tsx
// 线性比例尺
const xScale = d3
  .scaleLinear()
  .domain([0, 100]) // 数据范围
  .range([0, width]); // 像素范围

// 序数比例尺
const colorScale = d3
  .scaleOrdinal()
  .domain(["A", "B", "C"])
  .range(["red", "green", "blue"]);

// 时间比例尺
const timeScale = d3
  .scaleTime()
  .domain([new Date("2024-01-01"), new Date("2024-12-31")])
  .range([0, width]);
```

### 3. 与 React 集成

```tsx
function InteractiveChart({ data }) {
  const [hoveredItem, setHoveredItem] = useState(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);

    svg
      .selectAll("circle")
      .data(data)
      .join("circle")
      .attr("cx", (d) => xScale(d.x))
      .attr("cy", (d) => yScale(d.y))
      .attr("r", 5)
      .on("mouseenter", (event, d) => {
        setHoveredItem(d); // 使用 React state
      })
      .on("mouseleave", () => {
        setHoveredItem(null);
      });
  }, [data]);

  return (
    <>
      <svg ref={svgRef} />
      {hoveredItem && <Tooltip data={hoveredItem} />}
    </>
  );
}
```

## Recharts 声明式图表

### 1. 基础用法

```tsx
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

function TrendChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Line
          type="monotone"
          dataKey="value"
          stroke="#8884d8"
          activeDot={{ r: 8 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

### 2. 自定义 Tooltip

```tsx
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;

  return (
    <div className="bg-white p-3 shadow-lg rounded border">
      <p className="font-bold">{label}</p>
      {payload.map((entry, index) => (
        <p key={index} style={{ color: entry.color }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

// 使用
<Tooltip content={<CustomTooltip />} />;
```

## Framer Motion 动画

### 1. 基础动画

```tsx
import { motion } from "framer-motion";

function AnimatedCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
    >
      Card Content
    </motion.div>
  );
}
```

### 2. 列表动画

```tsx
import { motion, AnimatePresence } from "framer-motion";

function AnimatedList({ items }) {
  return (
    <AnimatePresence>
      {items.map((item, index) => (
        <motion.div
          key={item.id}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 20 }}
          transition={{ delay: index * 0.1 }}
        >
          {item.content}
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
```

### 3. 布局动画

```tsx
function LayoutAnimation() {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.div
      layout
      className={expanded ? "w-full h-96" : "w-48 h-48"}
      onClick={() => setExpanded(!expanded)}
    >
      <motion.h2 layout="position">Title</motion.h2>
      {expanded && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          Expanded content
        </motion.p>
      )}
    </motion.div>
  );
}
```

## 虚拟滚动 (TanStack Virtual)

### 1. 基础实现

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";

function VirtualList({ items }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50, // 预估每项高度
    overscan: 5, // 额外渲染数量
  });

  return (
    <div ref={parentRef} className="h-[400px] overflow-auto">
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {items[virtualRow.index].content}
          </div>
        ))}
      </div>
    </div>
  );
}
```

### 2. 动态高度

```tsx
const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 100,
  measureElement: (element) => element.getBoundingClientRect().height,
});
```

## Class Variance Authority (CVA)

### 1. 创建变体组件

```tsx
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  // 基础样式
  "inline-flex items-center justify-center rounded-md font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "bg-primary text-white hover:bg-primary/90",
        outline: "border border-input bg-transparent hover:bg-accent",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        destructive: "bg-destructive text-white hover:bg-destructive/90",
      },
      size: {
        sm: "h-8 px-3 text-sm",
        md: "h-10 px-4",
        lg: "h-12 px-6 text-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  },
);

interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

// 使用
<Button variant="outline" size="lg">
  Click me
</Button>;
```

## 参考资源

- [Radix UI 文档](https://www.radix-ui.com/docs/primitives)
- [TipTap 文档](https://tiptap.dev/docs)
- [D3.js 文档](https://d3js.org/)
- [Recharts 文档](https://recharts.org/)
- [Framer Motion 文档](https://www.framer.com/motion/)
- [TanStack Virtual 文档](https://tanstack.com/virtual/latest)
