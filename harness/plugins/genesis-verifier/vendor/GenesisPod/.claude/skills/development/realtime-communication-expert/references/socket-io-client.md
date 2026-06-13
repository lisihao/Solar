# Socket.io Client Hook

## React Hook for WebSocket

```typescript
// hooks/useSocket.ts
import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";

interface UseSocketOptions {
  namespace: string;
  autoConnect?: boolean;
  auth?: Record<string, any>;
}

export function useSocket({
  namespace,
  autoConnect = true,
  auth,
}: UseSocketOptions) {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket = io(`${process.env.NEXT_PUBLIC_WS_URL}${namespace}`, {
      autoConnect,
      auth,
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      setIsConnected(true);
      setError(null);
    });

    socket.on("disconnect", () => {
      setIsConnected(false);
    });

    socket.on("error", (err) => {
      setError(err.message);
    });

    socketRef.current = socket;

    return () => {
      socket.disconnect();
    };
  }, [namespace, autoConnect, auth]);

  const emit = useCallback((event: string, data: any) => {
    socketRef.current?.emit(event, data);
  }, []);

  const on = useCallback((event: string, callback: (data: any) => void) => {
    socketRef.current?.on(event, callback);
  }, []);

  const off = useCallback((event: string, callback?: (data: any) => void) => {
    if (callback) {
      socketRef.current?.off(event, callback);
    } else {
      socketRef.current?.removeAllListeners(event);
    }
  }, []);

  const joinRoom = useCallback(
    (room: string) => {
      emit("join:room", { room });
    },
    [emit],
  );

  const leaveRoom = useCallback(
    (room: string) => {
      emit("leave:room", { room });
    },
    [emit],
  );

  return {
    socket: socketRef.current,
    isConnected,
    error,
    emit,
    on,
    off,
    joinRoom,
    leaveRoom,
  };
}
```

## Usage in Component

```tsx
// components/ai-teams/MissionProgress.tsx
"use client";

import { useEffect, useState } from "react";
import { useSocket } from "@/hooks/useSocket";

interface MissionProgressProps {
  missionId: string;
}

export function MissionProgress({ missionId }: MissionProgressProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [progress, setProgress] = useState(0);
  const [streamContent, setStreamContent] = useState("");

  const { isConnected, emit, on, off } = useSocket({
    namespace: "/ai-teams",
    auth: { token: getAccessToken() },
  });

  useEffect(() => {
    if (!isConnected) return;

    // Join mission room
    emit("join:mission", { missionId });

    // Listen for events
    const handleProgress = (data: { progress: number }) => {
      setProgress(data.progress);
    };

    const handleMessage = (data: AgentMessage) => {
      setMessages((prev) => [...prev, data]);
    };

    const handleStreamChunk = (data: { content: string }) => {
      setStreamContent((prev) => prev + data.content);
    };

    const handleStreamEnd = () => {
      setStreamContent("");
    };

    on("progress:update", handleProgress);
    on("agent:message", handleMessage);
    on("stream:chunk", handleStreamChunk);
    on("stream:end", handleStreamEnd);

    return () => {
      emit("leave:mission", { missionId });
      off("progress:update", handleProgress);
      off("agent:message", handleMessage);
      off("stream:chunk", handleStreamChunk);
      off("stream:end", handleStreamEnd);
    };
  }, [isConnected, missionId, emit, on, off]);

  return (
    <div>
      <ProgressBar value={progress} />
      <MessageList messages={messages} />
      {streamContent && <StreamingText content={streamContent} />}
    </div>
  );
}
```
