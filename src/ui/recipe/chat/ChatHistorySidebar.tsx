import type { ChatSessionSummary } from '@/lib/queries/recipe-chat';
import { cn } from '@/ui/cn';
import { Badge } from '@/ui/primitives/Badge';
import { Button } from '@/ui/primitives/Button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/primitives/Dialog';
import { IconButton } from '@/ui/primitives/IconButton';
import { Input } from '@/ui/primitives/Input';
import { Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = {
  sessions: ChatSessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
};

export function ChatHistorySidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const startEdit = (s: ChatSessionSummary) => {
    setEditingId(s.id);
    setDraftTitle(s.title ?? '');
  };

  const commitEdit = (id: string) => {
    const trimmed = draftTitle.trim();
    if (trimmed) onRename(id, trimmed.slice(0, 80));
    setEditingId(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <Button
        variant="secondary"
        size="sm"
        leftIcon={<Plus size={16} aria-hidden="true" />}
        onClick={onNew}
      >
        {t('chat.new_chat')}
      </Button>

      {sessions.length === 0 ? (
        <p className="px-1 text-sm text-ink-soft">{t('chat.history_empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {sessions.map((s) => {
            const isActive = s.id === activeId;
            if (editingId === s.id) {
              return (
                <li key={s.id} className="flex items-center gap-1 px-1">
                  <Input
                    aria-label={t('chat.rename')}
                    value={draftTitle}
                    autoFocus
                    maxLength={80}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit(s.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={() => commitEdit(s.id)}
                  />
                  <IconButton
                    label={t('chat.save_rename')}
                    className="h-8 w-8"
                    icon={<Check size={16} />}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commitEdit(s.id)}
                  />
                </li>
              );
            }
            return (
              <li
                key={s.id}
                className={cn(
                  'group flex items-center gap-1 rounded-[var(--radius-md)] px-1',
                  isActive && 'bg-paper-2',
                )}
              >
                <button
                  type="button"
                  aria-label={s.title?.trim() || t('chat.untitled_draft')}
                  aria-current={isActive ? 'true' : undefined}
                  onClick={() => onSelect(s.id)}
                  className="min-w-0 flex-1 px-1 py-2 text-left"
                >
                  <span className="block truncate text-sm text-ink">
                    {s.title?.trim() || t('chat.untitled_draft')}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2">
                    {s.recipe_id && <Badge variant="secondary">{t('chat.saved_badge')}</Badge>}
                    <time className="text-xs text-ink-muted" dateTime={s.updated_at}>
                      {new Date(s.updated_at).toLocaleDateString()}
                    </time>
                  </span>
                </button>
                <IconButton
                  label={t('chat.rename')}
                  className="h-8 w-8 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                  icon={<Pencil size={16} />}
                  onClick={() => startEdit(s)}
                />
                <IconButton
                  label={t('chat.delete')}
                  className="h-8 w-8 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                  icon={<Trash2 size={16} />}
                  onClick={() => setDeletingId(s.id)}
                />
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={deletingId !== null} onOpenChange={(open) => !open && setDeletingId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('chat.delete_title')}</DialogTitle>
            <DialogDescription>{t('chat.delete_confirm_body')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeletingId(null)}>
              {t('chat.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deletingId) onDelete(deletingId);
                setDeletingId(null);
              }}
            >
              {t('chat.confirm_delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
