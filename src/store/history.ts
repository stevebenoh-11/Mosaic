import { coalesceInto, type Command } from './commands';

const MAX_HISTORY = 200;

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private lastCoalesceKey: string | null = null;

  record(cmd: Command): void {
    const top = this.undoStack[this.undoStack.length - 1];
    if (
      cmd.coalesceKey &&
      cmd.coalesceKey === this.lastCoalesceKey &&
      top !== undefined
    ) {
      coalesceInto(top, cmd);
    } else {
      this.undoStack.push(cmd);
      if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
    }
    this.lastCoalesceKey = cmd.coalesceKey ?? null;
    this.redoStack = [];
  }

  /** Call when an editing session ends so further edits start a new undo step. */
  breakCoalescing(): void {
    this.lastCoalesceKey = null;
  }

  popUndo(): Command | undefined {
    this.breakCoalescing();
    const cmd = this.undoStack.pop();
    if (cmd) this.redoStack.push(cmd);
    return cmd;
  }

  popRedo(): Command | undefined {
    const cmd = this.redoStack.pop();
    if (cmd) this.undoStack.push(cmd);
    return cmd;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastCoalesceKey = null;
  }
}
