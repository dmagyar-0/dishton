// Stash beforeinstallprompt and expose the event for the "Add to Home Screen"
// chip. iOS Safari does not fire this event; the SPA shows a tooltip with
// manual instructions instead (see RecipeDetail).

import { create } from 'zustand';

type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type State = {
  event: InstallEvent | null;
  recipeViews: number;
  setEvent: (e: InstallEvent | null) => void;
  recordRecipeView: () => void;
};

export const useInstallPrompt = create<State>((set) => ({
  event: null,
  recipeViews: 0,
  setEvent: (event) => set({ event }),
  recordRecipeView: () => set((s) => ({ recipeViews: s.recipeViews + 1 })),
}));

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    useInstallPrompt.getState().setEvent(e as InstallEvent);
  });
}
