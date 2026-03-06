import * as chokidar from 'chokidar';
import { VB6Indexer } from './indexer';

export class VB6Watcher {
  private watcher: chokidar.FSWatcher | null = null;
  private indexer: VB6Indexer;
  private onReindex?: () => void;

  constructor(indexer: VB6Indexer, onReindex?: () => void) {
    this.indexer = indexer;
    this.onReindex = onReindex;
  }

  /**
   * Start watching the given directories for .bas/.cls/.frm changes.
   */
  start(dirs: string[]): void {
    const globs = dirs.map(d => d.replace(/\\/g, '/') + '/**/*.{bas,cls,frm}');

    this.watcher = chokidar.watch(globs, {
      ignoreInitial: true,
      usePolling: false,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    this.watcher.on('change', (filePath: string) => {
      this.indexer.rebuildFile(filePath);
      this.onReindex?.();
    });

    this.watcher.on('add', (filePath: string) => {
      this.indexer.rebuildFile(filePath);
      this.onReindex?.();
    });

    this.watcher.on('unlink', (filePath: string) => {
      this.indexer.removeFile(filePath);
      this.onReindex?.();
    });
  }

  /**
   * Stop watching.
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
