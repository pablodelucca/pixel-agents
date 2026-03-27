interface BottomToolbarProps {
  isEditMode: boolean;
  onOpenClaude: () => void;
  onToggleEditMode: () => void;
  isDebugMode: boolean;
  onToggleDebugMode: () => void;
  workspaceFolders: Array<{ name: string; path: string }>;
  getOfficeState: () => unknown;
}

export function BottomToolbar(_props: BottomToolbarProps) {
  // Toolbar disabled for now - one account, one company
  return null;
}
