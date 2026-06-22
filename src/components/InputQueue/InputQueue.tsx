import { useReplayStore } from '@/store/useReplayStore';
import { formatTimestamp } from '@/utils/time';
import { Event } from '@/engine/types';
import { Inbox, AlertTriangle, CheckCircle, Info, Clock, Copy, AlertOctagon } from 'lucide-react';

const EVENT_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  alert: { label: '告警', color: 'bg-red-500/20 text-red-400 border-red-500/50' },
  clear: { label: '清除', color: 'bg-green-500/20 text-green-400 border-green-500/50' },
  info: { label: '信息', color: 'bg-blue-500/20 text-blue-400 border-blue-500/50' },
};

const STATUS_LABELS: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  duplicate: {
    label: '重复',
    color: 'bg-gray-500/20 text-gray-400 border-gray-500/50',
    icon: <Copy className="w-3 h-3" />,
  },
  pending: {
    label: '待匹配',
    color: 'bg-orange-500/20 text-orange-400 border-orange-500/50',
    icon: <Clock className="w-3 h-3" />,
  },
  orphan_clear: {
    label: '孤立清除',
    color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
    icon: <AlertOctagon className="w-3 h-3" />,
  },
  matched_early_clear: {
    label: '已匹配早到清除',
    color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/50',
    icon: <CheckCircle className="w-3 h-3" />,
  },
};

interface EventItemProps {
  event: Event;
}

function EventItem({ event }: EventItemProps) {
  const typeInfo = EVENT_TYPE_LABELS[event.type];
  const statusInfo = event.status ? STATUS_LABELS[event.status] : null;

  return (
    <div className="p-3 bg-slate-800 rounded border border-slate-700 hover:border-slate-500 transition-colors">
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {event.type === 'alert' && <AlertTriangle className="w-4 h-4 text-red-400" />}
          {event.type === 'clear' && <CheckCircle className="w-4 h-4 text-green-400" />}
          {event.type === 'info' && <Info className="w-4 h-4 text-blue-400" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`px-1.5 py-0.5 text-xs rounded border ${typeInfo.color}`}>
              {typeInfo.label}
            </span>
            {statusInfo && (
              <span className={`px-1.5 py-0.5 text-xs rounded border flex items-center gap-1 ${statusInfo.color}`}>
                {statusInfo.icon}
                {statusInfo.label}
              </span>
            )}
            <span className="text-xs text-slate-500 font-mono">{event.eventId}</span>
          </div>

          <div className="text-slate-200 text-sm font-medium mb-1">{event.title}</div>

          <div className="flex items-center gap-3 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTimestamp(event.timestamp)}
            </span>
            <span>来源: {event.source}</span>
            {event.correlationId && (
              <span className="text-slate-500">关联: {event.correlationId}</span>
            )}
          </div>

          <div className="mt-2 p-2 bg-slate-900/50 rounded text-xs font-mono text-slate-400 overflow-x-auto">
            {JSON.stringify(event.payload, null, 2).slice(0, 200)}
            {JSON.stringify(event.payload).length > 200 && '...'}
          </div>

          {event.status === 'pending' && (
            <div className="mt-2 text-xs text-orange-400 flex items-center gap-1">
              <Clock className="w-3 h-3" />
              正在等待匹配的告警事件...
            </div>
          )}
          {event.status === 'duplicate' && (
            <div className="mt-2 text-xs text-gray-400 flex items-center gap-1">
              <Copy className="w-3 h-3" />
              事件ID重复，已忽略
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function InputQueue() {
  const { pendingEvents, processedEvents, events } = useReplayStore();

  const recentProcessed = [...processedEvents]
    .filter((e) => e.status !== 'normal' || e.type !== 'info')
    .slice(-5)
    .reverse();

  return (
    <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Inbox className="w-5 h-5 text-blue-400" />
          <h3 className="text-slate-200 font-semibold">未解决输入</h3>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 bg-blue-900/50 text-blue-300 rounded">
            待处理 {pendingEvents.length}
          </span>
          <span className="px-2 py-1 bg-slate-700 text-slate-300 rounded">
            共 {events.length} 事件
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {pendingEvents.length === 0 && recentProcessed.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <Inbox className="w-12 h-12 mb-2 opacity-30" />
            <p className="text-sm">暂无待处理事件</p>
          </div>
        ) : (
          <>
            {pendingEvents.length > 0 && (
              <div>
                <div className="text-xs text-slate-400 mb-2 font-medium">等待匹配的事件</div>
                <div className="space-y-2">
                  {pendingEvents.map((event, idx) => (
                    <EventItem key={`${event.eventId}-pending-${idx}`} event={event} />
                  ))}
                </div>
              </div>
            )}

            {recentProcessed.length > 0 && (
              <div>
                <div className="text-xs text-slate-400 mb-2 font-medium mt-4">最近异常事件</div>
                <div className="space-y-2">
                  {recentProcessed.map((event, idx) => (
                    <EventItem key={`${event.eventId}-recent-${idx}`} event={event} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
