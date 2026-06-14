'use client';

import { useParams } from 'next/navigation';
import AppShell from '@/components/layout/AppShell';
import { RoomChatPage } from '@/components/ai-ask/room/RoomChatPage';

export default function AskRoomDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  // 评审 W6 阻塞 #3：SSR 下 useParams() 首次返回 undefined；显示 skeleton 而非空白
  if (!id) {
    return (
      <AppShell>
        <div className="flex h-full items-center justify-center text-sm text-gray-500">
          房间加载中…
        </div>
      </AppShell>
    );
  }
  return (
    <AppShell>
      <RoomChatPage roomId={id} />
    </AppShell>
  );
}
