// Single source of truth for keyboard shortcuts. The `?` help dialog renders
// from this list.

export type Shortcut = {
  keys: string[];
  description: string;
  scope: 'list' | 'detail' | 'global';
};

export const shortcuts: Shortcut[] = [
  { keys: ['s'], description: 'Focus the search box', scope: 'list' },
  { keys: ['i'], description: 'New import', scope: 'list' },
  { keys: ['j'], description: 'Next recipe', scope: 'list' },
  { keys: ['k'], description: 'Previous recipe', scope: 'list' },
  { keys: ['+'], description: 'Scale up by 1 serving', scope: 'detail' },
  { keys: ['-'], description: 'Scale down by 1 serving', scope: 'detail' },
  { keys: ['['], description: 'Switch to metric units', scope: 'detail' },
  { keys: [']'], description: 'Switch to imperial units', scope: 'detail' },
  { keys: ['?'], description: 'Show keyboard shortcuts', scope: 'global' },
  { keys: ['Esc'], description: 'Close any open dialog or drawer', scope: 'global' },
];

export function isTypingIntoInput(event: Event): boolean {
  const t = event.target as HTMLElement | null;
  if (!t) return false;
  const tag = t.tagName?.toLowerCase();
  return tag === 'input' || tag === 'textarea' || (t as HTMLElement).isContentEditable;
}
