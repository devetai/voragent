import type { Task, VEvent } from '@voragent/shared';
import { COLUMNS, columnOf, handoffCount, isUnisolated } from './state';

export function Board({
  tasks, events, onOpen,
}: { tasks: Task[]; events: Map<string, VEvent[]>; onOpen: (id: string) => void }) {
  return (
    <div className="board">
      {COLUMNS.map((col) => {
        const items = tasks.filter((t) => columnOf(t.status) === col).sort((a, b) => b.seq - a.seq);
        return (
          <section key={col} className="column">
            <h2>{col} <span className="muted">({items.length})</span></h2>
            {items.map((t) => (
              <button key={t.id} className="card" onClick={() => onOpen(t.id)}>
                <div><strong>#{t.seq}</strong> {t.title}</div>
                {isUnisolated(t) && <div className="badge warn">⚠ không cách ly</div>}
                <div className="muted">
                  {t.currentProvider ?? '—'} · bàn giao: {handoffCount(events.get(t.id))}
                  {t.status === 'waiting_quota' ? ' · chờ quota' : ''}
                </div>
              </button>
            ))}
          </section>
        );
      })}
    </div>
  );
}
