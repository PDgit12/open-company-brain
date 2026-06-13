/**
 * Tiny JSON-array file store — the zero-setup persistence primitive.
 *
 * The product runs with no credentials. For state that must survive a process
 * exit (saved agents, per-agent conversations, token budgets) we mirror the
 * action-delivery `file` sink: write to a gitignored data dir on disk instead of
 * standing up a database. One Postgres-backed impl takes over when configured;
 * until then this is durable AND hermetically testable (point it at a temp dir).
 *
 * Each "collection" is one JSON file holding an array of records. Reads tolerate
 * a missing/empty/corrupt file by returning []. Writes are atomic (write a temp
 * file, then rename) so a crash mid-write never leaves a half-written array.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class JsonFileCollection<T> {
  /** @param file absolute or cwd-relative path to the collection's JSON file. */
  constructor(private readonly file: string) {}

  async read(): Promise<T[]> {
    try {
      const raw = await readFile(this.file, 'utf8');
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      // Missing or unreadable/corrupt → treat as empty, never throw on read.
      return [];
    }
  }

  /** Replace the whole collection. Atomic: temp file + rename. */
  async write(items: T[]): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(items, null, 2), 'utf8');
    await rename(tmp, this.file);
  }

  /** Append one record and persist. Returns the full collection after the add. */
  async append(item: T): Promise<T[]> {
    const items = await this.read();
    items.push(item);
    await this.write(items);
    return items;
  }

  /**
   * Append many records in ONE read + ONE write. Use this instead of calling
   * append() in a loop — append() rewrites the whole file each call (O(n²) over
   * a loop); appendMany is a single O(n) write.
   */
  async appendMany(newItems: T[]): Promise<T[]> {
    if (!newItems.length) return this.read();
    const items = await this.read();
    items.push(...newItems);
    await this.write(items);
    return items;
  }
}
