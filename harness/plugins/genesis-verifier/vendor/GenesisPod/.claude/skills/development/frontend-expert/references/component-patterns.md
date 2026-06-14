# Component Patterns

## Page Component (Server Component)

```tsx
// app/resources/page.tsx
import { Suspense } from "react";
import { ResourceList } from "@/components/resources/ResourceList";
import { ResourceListSkeleton } from "@/components/resources/ResourceListSkeleton";

export default function ResourcesPage() {
  return (
    <div className="container mx-auto py-8">
      <h1 className="text-2xl font-bold mb-6">Resources</h1>
      <Suspense fallback={<ResourceListSkeleton />}>
        <ResourceList />
      </Suspense>
    </div>
  );
}
```

## Client Component

```tsx
"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface ResourceCardProps {
  resource: Resource;
  onEdit?: (id: string) => void;
}

export function ResourceCard({ resource, onEdit }: ResourceCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const handleEdit = useCallback(() => {
    onEdit?.(resource.id);
  }, [resource.id, onEdit]);

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <h3 className="font-semibold text-lg">{resource.title}</h3>
      {isExpanded && (
        <p className="mt-2 text-gray-600">{resource.description}</p>
      )}
      <div className="mt-4 flex gap-2">
        <Button variant="outline" onClick={() => setIsExpanded(!isExpanded)}>
          {isExpanded ? "Collapse" : "Expand"}
        </Button>
        <Button onClick={handleEdit}>Edit</Button>
      </div>
    </Card>
  );
}
```

## Custom Hook

```tsx
// hooks/useResources.ts
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function useResources(options?: { tags?: string[] }) {
  return useQuery({
    queryKey: ["resources", options],
    queryFn: () => api.get("/resources", { params: options }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useCreateResource() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateResourceDto) => api.post("/resources", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resources"] });
    },
  });
}
```

## Styling with Tailwind + shadcn/ui

```tsx
// Use shadcn/ui components as base
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Extend with Tailwind
<Card className="bg-gradient-to-br from-blue-50 to-purple-50 dark:from-gray-800 dark:to-gray-900">
  <CardHeader className="space-y-1">
    <h2 className="text-xl font-bold tracking-tight">Title</h2>
  </CardHeader>
  <CardContent>{/* Content */}</CardContent>
</Card>;
```

## Common Layout Patterns

```tsx
// Three-column layout
<div className="flex min-h-screen">
  <aside className="w-64 shrink-0">...</aside>
  <main className="flex-1">...</main>
  <aside className="w-80 shrink-0">...</aside>
</div>

// Fixed header + scrolling content
<div className="flex flex-col h-screen">
  <header className="h-16 shrink-0">...</header>
  <main className="flex-1 overflow-y-auto">...</main>
</div>

// Fixed sidebar + content offset
<aside className="fixed left-0 top-0 h-full w-72">...</aside>
<main className="ml-72">...</main>
```
