import * as fs from 'fs';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { normalizePath, uriToPath } from './utils';

/**
 * Provides source text with open editor snapshots taking precedence over disk.
 * Providers should use this abstraction instead of reading source files directly.
 */
export interface SourceTextProvider {
  getOpenText(filePath: string): string | undefined;
  readText(filePath: string): string | null;
  readLines(filePath: string): string[] | null;
}

interface Snapshot {
  text: string;
  version: number;
}

export class DocumentSnapshotStore implements SourceTextProvider {
  private readonly snapshots = new Map<string, Snapshot>();

  setDocument(document: TextDocument): void {
    this.snapshots.set(normalizePath(uriToPath(document.uri)), {
      text: document.getText(),
      version: document.version,
    });
  }

  removeUri(uri: string): void {
    this.snapshots.delete(normalizePath(uriToPath(uri)));
  }

  getOpenText(filePath: string): string | undefined {
    return this.snapshots.get(normalizePath(filePath))?.text;
  }

  getVersion(filePath: string): number | undefined {
    return this.snapshots.get(normalizePath(filePath))?.version;
  }

  readText(filePath: string): string | null {
    const openText = this.getOpenText(filePath);
    if (openText !== undefined) return openText;

    try {
      return fs.readFileSync(filePath, 'latin1');
    } catch {
      return null;
    }
  }

  readLines(filePath: string): string[] | null {
    const text = this.readText(filePath);
    return text === null ? null : text.split(/\r?\n/);
  }

  hasOpenDocument(filePath: string): boolean {
    return this.snapshots.has(normalizePath(filePath));
  }

}
