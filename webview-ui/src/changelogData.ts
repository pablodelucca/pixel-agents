export interface ChangelogSection {
  title: string;
  items: string[];
}

export interface ChangelogContributor {
  name: string;
  url: string;
  description: string;
}

export interface ChangelogEntry {
  version: string;
  sections: ChangelogSection[];
  contributors: ChangelogContributor[];
}

/** Extract "major.minor" from a semver string (e.g. "1.1.1" → "1.1") */
export function toMajorMinor(version: string): string {
  const parts = version.split('.');
  return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : version;
}

export const CHANGELOG_REPO_URL = 'https://github.com/pablodelucca/pixel-agents';

export const changelogEntries: ChangelogEntry[] = [
  {
    version: '1.2',
    sections: [
      {
        title: 'Features',
        items: [
          'Bypass permissions mode — right-click "+ Agent" to skip tool approvals',
          'External asset packs — load furniture from user-defined directories',
          'Improved seating, sub-agent spawning, and background agent support',
          'Always show overlay setting for agent labels',
          'Agent connection diagnostics and JSONL parser resilience',
          'Browser preview mode for development and review',
        ],
      },
      {
        title: 'Fixes',
        items: ['Agents not appearing on Linux Mint/macOS when no folder is open'],
      },
      {
        title: 'Testing',
        items: ['Playwright e2e tests with mock Claude CLI'],
      },
      {
        title: 'Maintenance',
        items: [
          'Bump Vite 8.0, ESLint 10, and various dependency updates',
          'CI improvements for Dependabot and badge updates',
        ],
      },
    ],
    contributors: [
      {
        name: '@marctebo',
        url: 'https://github.com/marctebo',
        description: 'External asset packs support',
      },
      {
        name: '@dankadr',
        url: 'https://github.com/dankadr',
        description: 'Bypass permissions mode',
      },
      {
        name: '@d4rkd0s',
        url: 'https://github.com/d4rkd0s',
        description: 'Linux/macOS fix for no-folder workspaces',
      },
      {
        name: '@daniel-dallimore',
        url: 'https://github.com/daniel-dallimore',
        description: 'Always show overlay setting',
      },
      {
        name: '@NNTin',
        url: 'https://github.com/NNTin',
        description: 'Playwright e2e tests, browser preview mode',
      },
      {
        name: '@florintimbuc',
        url: 'https://github.com/florintimbuc',
        description: 'Agent diagnostics, JSONL resilience, CI improvements',
      },
    ],
  },
];
