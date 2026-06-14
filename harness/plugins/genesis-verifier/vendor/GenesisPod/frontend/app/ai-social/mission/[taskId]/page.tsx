'use client';

import { useParams } from 'next/navigation';
import SocialMissionPage from '@/components/ai-social/mission-detail/SocialMissionPage';

export default function Page() {
  const params = useParams();
  const taskId = params?.taskId as string;
  return <SocialMissionPage taskId={taskId} />;
}
