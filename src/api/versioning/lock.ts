/**
 * Per-note serialization for version operations.
 *
 * Git itself is safe for concurrent readers, but a snapshot and the restore
 * that may follow it must not interleave with another save for the same note.
 * The queue is deliberately module-level so every request in the process sees
 * the same ordering.
 */
const queues = new Map<string, Promise<unknown>>();

export function withNoteLock<T>(noteId: string, task: () => Promise<T>): Promise<T> {
    const previous = queues.get(noteId) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    queues.set(noteId, run);

    return run.finally(() => {
        if (queues.get(noteId) === run) queues.delete(noteId);
    });
}
