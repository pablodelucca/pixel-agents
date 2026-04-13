import { useEffect, useRef, useState } from 'react';

import type { WorkspaceFolder } from '../hooks/useExtensionMessages.js';
import {
  buildOpenAgentMessage,
  getEnabledProviderOptions,
  type ProviderId,
} from '../providers/providerUi.js';
import { vscode } from '../vscodeApi.js';
import { Button } from './ui/Button.js';
import { Dropdown, DropdownItem } from './ui/Dropdown.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  workspaceFolders: WorkspaceFolder[];
  enabledProviders: ProviderId[];
  selectedProvider: ProviderId;
  onSelectProvider: (providerId: ProviderId) => void;
}

export function BottomToolbar({
  isEditMode,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  workspaceFolders,
  enabledProviders,
  selectedProvider,
  onSelectProvider,
}: BottomToolbarProps) {
  const [isProviderMenuOpen, setIsProviderMenuOpen] = useState(false);
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false);
  const [isBypassMenuOpen, setIsBypassMenuOpen] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const pendingBypassRef = useRef(false);
  const providerOptions = getEnabledProviderOptions(enabledProviders);
  const selectedProviderLabel =
    providerOptions.find((provider) => provider.id === selectedProvider)?.label ?? 'Provider';

  useEffect(() => {
    if (!isProviderMenuOpen && !isFolderPickerOpen && !isBypassMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setIsProviderMenuOpen(false);
        setIsFolderPickerOpen(false);
        setIsBypassMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isProviderMenuOpen, isFolderPickerOpen, isBypassMenuOpen]);

  const hasMultipleFolders = workspaceFolders.length > 1;

  const handleAgentClick = () => {
    setIsProviderMenuOpen(false);
    setIsBypassMenuOpen(false);
    pendingBypassRef.current = false;
    if (hasMultipleFolders) {
      setIsFolderPickerOpen((open) => !open);
      return;
    }
    vscode.postMessage(buildOpenAgentMessage({ providerId: selectedProvider }));
  };

  const handleAgentHover = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(true);
    }
  };

  const handleAgentLeave = () => {
    if (!isFolderPickerOpen) {
      setIsBypassMenuOpen(false);
    }
  };

  const handleFolderSelect = (folder: WorkspaceFolder) => {
    setIsFolderPickerOpen(false);
    const bypassPermissions = pendingBypassRef.current;
    pendingBypassRef.current = false;
    vscode.postMessage(
      buildOpenAgentMessage({
        providerId: selectedProvider,
        folderPath: folder.path,
        bypassPermissions,
      }),
    );
  };

  const handleBypassSelect = (bypassPermissions: boolean) => {
    setIsBypassMenuOpen(false);
    if (hasMultipleFolders) {
      pendingBypassRef.current = bypassPermissions;
      setIsFolderPickerOpen(true);
      return;
    }
    vscode.postMessage(buildOpenAgentMessage({ providerId: selectedProvider, bypassPermissions }));
  };

  return (
    <div
      ref={toolbarRef}
      className="absolute bottom-10 left-10 z-20 flex items-center gap-4 pixel-panel p-4"
    >
      <div className="relative">
        <Button
          variant={isProviderMenuOpen ? 'active' : 'default'}
          onClick={() => {
            setIsProviderMenuOpen((open) => !open);
            setIsFolderPickerOpen(false);
            setIsBypassMenuOpen(false);
          }}
        >
          {selectedProviderLabel}
        </Button>
        <Dropdown isOpen={isProviderMenuOpen} className="min-w-96">
          {providerOptions.map((provider) => (
            <DropdownItem
              key={provider.id}
              onClick={() => {
                onSelectProvider(provider.id);
                setIsProviderMenuOpen(false);
              }}
            >
              {provider.label}
              {provider.id === selectedProvider ? ' (Selected)' : ''}
            </DropdownItem>
          ))}
        </Dropdown>
      </div>
      <div className="relative" onMouseEnter={handleAgentHover} onMouseLeave={handleAgentLeave}>
        <Button
          variant="accent"
          onClick={handleAgentClick}
          className={
            isFolderPickerOpen || isBypassMenuOpen
              ? 'bg-accent-bright'
              : 'bg-accent hover:bg-accent-bright'
          }
        >
          + Agent
        </Button>
        <Dropdown isOpen={isBypassMenuOpen}>
          <DropdownItem onClick={() => handleBypassSelect(true)}>
            Skip permissions mode <span className="text-2xs text-warning">!</span>
          </DropdownItem>
        </Dropdown>
        <Dropdown isOpen={isFolderPickerOpen} className="min-w-128">
          {workspaceFolders.map((folder) => (
            <DropdownItem
              key={folder.path}
              onClick={() => handleFolderSelect(folder)}
              className="text-base"
            >
              {folder.name}
            </DropdownItem>
          ))}
        </Dropdown>
      </div>
      <Button
        variant={isEditMode ? 'active' : 'default'}
        onClick={onToggleEditMode}
        title="Edit office layout"
      >
        Layout
      </Button>
      <Button
        variant={isSettingsOpen ? 'active' : 'default'}
        onClick={onToggleSettings}
        title="Settings"
      >
        Settings
      </Button>
    </div>
  );
}
