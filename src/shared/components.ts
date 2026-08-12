import * as path from 'path';

export type VB6ComponentKind = 'Module' | 'Class' | 'Form' | 'UserControl' | 'Designer';

export interface VB6ComponentPolicy {
  kind: VB6ComponentKind;
  entryPrefix: string;
  extensions: readonly string[];
  languageId: 'vb6';
  indexed: boolean;
  limitation?: string;
}

export const VB6_COMPONENT_POLICIES: Readonly<Record<VB6ComponentKind, VB6ComponentPolicy>> = {
  Module: {
    kind: 'Module',
    entryPrefix: 'Module=',
    extensions: ['.bas'],
    languageId: 'vb6',
    indexed: true,
  },
  Class: {
    kind: 'Class',
    entryPrefix: 'Class=',
    extensions: ['.cls'],
    languageId: 'vb6',
    indexed: true,
  },
  Form: {
    kind: 'Form',
    entryPrefix: 'Form=',
    extensions: ['.frm'],
    languageId: 'vb6',
    indexed: true,
  },
  UserControl: {
    kind: 'UserControl',
    entryPrefix: 'UserControl=',
    extensions: ['.ctl'],
    languageId: 'vb6',
    indexed: true,
  },
  Designer: {
    kind: 'Designer',
    entryPrefix: 'Designer=',
    extensions: ['.dsr'],
    languageId: 'vb6',
    indexed: false,
    limitation: 'Active Designer (.dsr) files are discovered but are not indexed until a dedicated parser is available.',
  },
};

export const VB6_SOURCE_EXTENSIONS = Object.freeze(
  Object.values(VB6_COMPONENT_POLICIES)
    .filter((policy) => policy.indexed)
    .flatMap((policy) => policy.extensions),
);

export const VB6_COMPONENT_EXTENSIONS = Object.freeze(
  Object.values(VB6_COMPONENT_POLICIES).flatMap((policy) => policy.extensions),
);

export const VB6_SOURCE_GLOB = `{${VB6_SOURCE_EXTENSIONS.map((extension) => extension.slice(1)).join(',')}}`;

export function getComponentPolicy(kind: VB6ComponentKind): VB6ComponentPolicy {
  return VB6_COMPONENT_POLICIES[kind];
}

export function getComponentPolicyForFile(filePath: string): VB6ComponentPolicy | undefined {
  const extension = path.extname(filePath).toLowerCase();
  return Object.values(VB6_COMPONENT_POLICIES).find((policy) => policy.extensions.includes(extension));
}

export function isSupportedVB6Source(filePath: string): boolean {
  return getComponentPolicyForFile(filePath)?.indexed === true;
}

export function isVB6ComponentFile(filePath: string): boolean {
  return getComponentPolicyForFile(filePath) !== undefined;
}

export function stripVB6ComponentExtension(value: string): string {
  const lower = value.toLowerCase();
  const extension = VB6_COMPONENT_EXTENSIONS.find((candidate) => lower.endsWith(candidate));
  return extension ? value.slice(0, -extension.length) : value;
}
