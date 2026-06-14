'use client';

import { useState } from 'react';
import { UsersRound, Plus, Search } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { AdminPageLayout } from '@/components/admin/layout';
import AITeamsSettings from '@/components/admin/ai-config/AITeamsSettings';

export default function AITeamsPage() {
  const { t } = useTranslation();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <AdminPageLayout
      title={t('admin.nav.teams')}
      description={t('admin.tabDescriptions.aiTeams')}
      icon={UsersRound}
      domain="ai"
      actions={
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-indigo-700"
        >
          <Plus className="h-5 w-5" />
          New Team
        </button>
      }
      searchBar={
        <div className="relative">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search teams..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-12 pr-4 text-sm outline-none transition-all focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
      }
    >
      <AITeamsSettings
        showCreateModal={showCreateModal}
        setShowCreateModal={setShowCreateModal}
        searchQuery={searchQuery}
      />
    </AdminPageLayout>
  );
}
