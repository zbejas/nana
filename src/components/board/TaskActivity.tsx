import { useEffect, useState } from 'react';
import { ArrowPathIcon } from '@heroicons/react/20/solid';
import type { BoardColumn } from '../../lib/boards';
import { listTaskActivity, type TaskActivity as TaskActivityRow } from '../../lib/tasks';
import { useAuth } from '../../lib/auth';
import { Avatar, Button, Spinner } from '../ui';
import { TaskSection } from './TaskSection';
import { formatRelativeDate } from './dates';
import { activityActor, activitySentence } from './task-panel-model';

interface TaskActivityProps {
  taskId: string;
  columns: ReadonlyArray<BoardColumn>;
  /** Bumped after a successful save so the audit trail stays current. */
  refreshToken: number;
}

export function TaskActivity({ taskId, columns, refreshToken }: TaskActivityProps) {
  const { user } = useAuth();
  const [items, setItems] = useState<TaskActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);

    void listTaskActivity(taskId)
      .then((rows) => {
        if (!current) return;
        setItems([...rows].sort((left, right) => left.created.localeCompare(right.created)));
      })
      .catch((loadError) => {
        if (!current) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load activity.');
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [taskId, refreshToken, retryToken]);

  return (
    <TaskSection title="Activity" count={items.length} id="task-activity">
      {loading ? (
        <div className="flex items-center gap-2 py-2 text-[12px] text-ink-muted">
          <Spinner className="h-4 w-4" label="Loading activity" />
          Loading activity…
        </div>
      ) : error ? (
        <div className="flex flex-wrap items-center gap-3 rounded-control border border-line bg-surface-sunken px-3 py-2.5">
          <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-danger">{error}</p>
          <Button
            variant="secondary"
            size="sm"
            icon={<ArrowPathIcon />}
            onClick={() => setRetryToken((token) => token + 1)}
          >
            Retry
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="px-0.5 py-1 text-[12.5px] leading-relaxed text-ink-muted">
          No activity yet. Edits to this task will appear here.
        </p>
      ) : (
        <ol className="task-activity">
          {items.map((activity) => {
            const actor = activityActor(activity);
            const name = !actor.isAi && !actor.isSystem && activity.actor === user?.id ? 'You' : actor.name;
            return (
              <li key={activity.id} className="task-activity__row">
                {actor.isAi ? (
                  <span className="task-activity__nana" aria-label="Nana">
                    N
                  </span>
                ) : actor.isSystem ? (
                  <span className="task-activity__system" aria-hidden="true" />
                ) : (
                  <Avatar
                    src={actor.avatar}
                    name={actor.name}
                    className="h-6 w-6 shrink-0 text-[9px]"
                  />
                )}
                <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-secondary">
                  <span className="font-medium text-ink">{name}</span>{' '}
                  {activitySentence(activity, columns)}
                </p>
                <time
                  dateTime={activity.created}
                  title={new Date(activity.created).toLocaleString()}
                  className="shrink-0 text-[10.5px] tabular-nums text-ink-muted"
                >
                  {formatRelativeDate(activity.created)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </TaskSection>
  );
}
