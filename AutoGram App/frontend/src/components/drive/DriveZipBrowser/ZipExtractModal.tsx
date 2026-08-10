import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Folder, FolderInput, HardDrive, Hash, Megaphone, MessageCircle, Search, Users, X } from 'lucide-react';
import type { DriveCredentials } from '../../../lib/telegram/driveApi/driveApiUtils';
import type { DriveChat, DriveFolder } from '../../../lib/telegram/driveTypes';
import type { TargetDestination } from './zipUtils';
import { PeerAvatar } from '../Navigation/sidebarUtils';

type ZipExtractModalProps = {
  isOpen: boolean;
  selectedCount: number;
  folders: DriveFolder[];
  chats: DriveChat[];
  creds?: DriveCredentials | null;
  busy?: boolean;
  progressLabel?: string | null;
  onClose: () => void;
  onConfirmExtract: (target: TargetDestination) => void;
};

type DestinationTab = 'saved' | 'drive' | 'chat';

function ChatIcon({ type }: { type: string }) {
  if (type === 'bot') return <Bot size={17} />;
  if (type === 'channel') return <Megaphone size={17} />;
  if (type === 'group') return <Users size={17} />;
  return <MessageCircle size={17} />;
}

export function ZipExtractModal({
  isOpen,
  selectedCount,
  folders,
  chats,
  creds,
  busy,
  progressLabel,
  onClose,
  onConfirmExtract,
}: ZipExtractModalProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<DestinationTab>('saved');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [topicId, setTopicId] = useState('');

  const filteredFolders = useMemo(
    () => folders.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase())),
    [folders, query]
  );
  const filteredChats = useMemo(
    () => chats.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase())),
    [chats, query]
  );
  const selectedChat = tab === 'chat' ? chats.find((chat) => chat.id === selectedId) : null;

  if (!isOpen) return null;

  const submit = () => {
    if (tab === 'saved') {
      onConfirmExtract({ kind: 'saved', chatId: 'me', folderId: null, topicId: null, label: t('speedtest.saved_messages') });
      return;
    }
    if (selectedId == null) return;
    if (tab === 'drive') {
      const folder = folders.find((item) => item.id === selectedId);
      onConfirmExtract({ kind: 'drive', chatId: String(selectedId), folderId: selectedId, topicId: null, label: folder?.name || String(selectedId) });
      return;
    }
    const chat = chats.find((item) => item.id === selectedId);
    const parsedTopic = Number(topicId);
    onConfirmExtract({
      kind: 'chat',
      chatId: String(selectedId),
      folderId: selectedId,
      topicId: selectedChat?.is_forum && Number.isInteger(parsedTopic) && parsedTopic > 0 ? parsedTopic : null,
      label: chat?.name || String(selectedId),
    });
  };

  return (
    <div className="dzb-modal-overlay" role="dialog" aria-modal="true" aria-label={t('speedtest.zip_extract_title')}>
      <div className="dzb-modal-card dzb-extract-modal">
        <div className="dzb-modal-header">
          <div className="dzb-modal-title">
            <FolderInput size={18} />
            <span>{t('speedtest.zip_extract_title')} · {selectedCount}</span>
          </div>
          <button type="button" onClick={onClose} className="dzb-action-icon-btn" title={t('speedtest.zip_close')} disabled={busy}>
            <X size={18} />
          </button>
        </div>

        <div className="dzb-modal-body dzb-extract-body">
          <p className="dzb-modal-description">{t('speedtest.zip_extract_dest_desc')}</p>
          <div className="dzb-destination-tabs" role="tablist" aria-label={t('speedtest.zip_destination_type')}>
            {([
              ['saved', HardDrive, 'speedtest.saved_messages'],
              ['drive', Folder, 'speedtest.zip_dest_drive'],
              ['chat', MessageCircle, 'speedtest.zip_dest_chat'],
            ] as const).map(([id, Icon, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`dzb-destination-tab ${tab === id ? 'active' : ''}`}
                onClick={() => { setTab(id); setSelectedId(null); setTopicId(''); }}
              >
                <Icon size={16} /> {t(label)}
              </button>
            ))}
          </div>

          {tab === 'saved' ? (
            <button type="button" className="dzb-destination-card selected" onClick={() => setSelectedId(null)}>
              <HardDrive size={20} />
              <span><strong>{t('speedtest.saved_messages')}</strong><small>{t('speedtest.zip_saved_desc')}</small></span>
            </button>
          ) : (
            <>
              <label className="dzb-destination-search">
                <Search size={16} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('speedtest.zip_destination_search')} />
              </label>
              <div className="dzb-destination-list">
                {(tab === 'drive' ? filteredFolders : filteredChats).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`dzb-destination-card ${selectedId === item.id ? 'selected' : ''}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    {tab === 'drive' ? (
                      <Folder size={18} />
                    ) : (
                      <span style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginRight: 8 }}>
                        <PeerAvatar peerId={item.id} creds={creds} title={item.name} fallback={<ChatIcon type={(item as DriveChat).type} />} />
                      </span>
                    )}
                    <span><strong>{item.name}</strong><small>{tab === 'drive' ? t('speedtest.zip_dest_drive') : t(`speedtest.zip_chat_type_${(item as DriveChat).type}`, { defaultValue: (item as DriveChat).type })}</small></span>
                  </button>
                ))}
              </div>
            </>
          )}

          {selectedChat?.is_forum && (
            <label className="dzb-topic-field">
              <span><Hash size={15} /> {t('speedtest.zip_topic_id')}</span>
              <input type="number" min={1} value={topicId} onChange={(event) => setTopicId(event.target.value)} placeholder={t('speedtest.zip_topic_id_placeholder')} />
              <small>{t('speedtest.zip_topic_id_hint')}</small>
            </label>
          )}
          {progressLabel && <p className="dzb-extract-progress" role="status">{progressLabel}</p>}
        </div>

        <div className="dzb-modal-footer">
          <button type="button" onClick={onClose} className="dzb-btn-secondary" disabled={busy}>{t('speedtest.zip_btn_cancel')}</button>
          <button type="button" onClick={submit} className="dzb-btn-primary" disabled={busy || (tab !== 'saved' && selectedId == null)}>
            {busy ? t('speedtest.zip_extracting') : t('speedtest.zip_start_extract')}
          </button>
        </div>
      </div>
    </div>
  );
}
