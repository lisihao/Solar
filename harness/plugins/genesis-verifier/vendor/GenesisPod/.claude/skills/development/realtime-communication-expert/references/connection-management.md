# Connection Management

## Heartbeat Mechanism

```typescript
// Gateway heartbeat
@WebSocketGateway()
export class HeartbeatGateway implements OnGatewayConnection {
  private readonly HEARTBEAT_INTERVAL = 30000; // 30 seconds

  handleConnection(client: Socket) {
    // Start heartbeat
    const heartbeatInterval = setInterval(() => {
      if (client.connected) {
        client.emit("ping");
      } else {
        clearInterval(heartbeatInterval);
      }
    }, this.HEARTBEAT_INTERVAL);

    client.on("pong", () => {
      client.data.lastPong = Date.now();
    });

    client.on("disconnect", () => {
      clearInterval(heartbeatInterval);
    });
  }
}
```

## Reconnection Strategy (Frontend)

```typescript
// Socket.io with reconnection
const socket = io(url, {
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

socket.on("reconnect_attempt", (attempt) => {
  console.log(`Reconnection attempt ${attempt}`);
});

socket.on("reconnect_failed", () => {
  console.error("Reconnection failed after all attempts");
});
```

## Connection Health Monitoring

```typescript
interface ConnectionHealth {
  connected: boolean;
  lastPing: Date | null;
  latency: number;
  reconnectAttempts: number;
}

export function useConnectionHealth(socket: Socket | null) {
  const [health, setHealth] = useState<ConnectionHealth>({
    connected: false,
    lastPing: null,
    latency: 0,
    reconnectAttempts: 0,
  });

  useEffect(() => {
    if (!socket) return;

    const pingInterval = setInterval(() => {
      const start = Date.now();
      socket.emit("ping");
      socket.once("pong", () => {
        setHealth((prev) => ({
          ...prev,
          lastPing: new Date(),
          latency: Date.now() - start,
        }));
      });
    }, 5000);

    socket.on("connect", () => {
      setHealth((prev) => ({ ...prev, connected: true, reconnectAttempts: 0 }));
    });

    socket.on("disconnect", () => {
      setHealth((prev) => ({ ...prev, connected: false }));
    });

    socket.on("reconnect_attempt", (attempt) => {
      setHealth((prev) => ({ ...prev, reconnectAttempts: attempt }));
    });

    return () => clearInterval(pingInterval);
  }, [socket]);

  return health;
}
```

## Best Practices

1. **Exponential Backoff**: Start at 1s, max at 5s
2. **Heartbeat**: Every 30 seconds to detect stale connections
3. **Timeout**: 20s connection timeout
4. **Max Attempts**: 5 reconnection attempts before giving up
5. **Graceful Degradation**: Show offline indicator, queue messages
