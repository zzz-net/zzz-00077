import { useReplayStore } from '@/store/useReplayStore';
import { formatDateTime } from '@/utils/time';
import { Confirmation } from '@/engine/types';
import { History, CheckCircle, Undo2, User, MessageSquare, Clock, AlertTriangle } from 'lucide-react';

interface HistoryItemProps {
  confirmation: Confirmation;
}

function HistoryItem({ confirmation }: HistoryItemProps) {
  const { undoConfirmation, activeAlarms } = useReplayStore();
  const alarm = activeAlarms.find((a) => a.alarmId === confirmation.alarmId);

  const handleUndo = () => {
    undoConfirmation(confirmation.confirmationId);
  };

  return (
    <div
      className={`p-3 rounded border transition-colors ${
        confirmation.type === 'confirm'
          ? confirmation.active
            ? 'bg-green-900/20 border-green-700/50'
            : 'bg-slate-800/50 border-slate-700 opacity-60'
          : 'bg-orange-900/20 border-orange-700/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`p-1.5 rounded ${
            confirmation.type === 'confirm' ? 'bg-green-600' : 'bg-orange-600'
          }`}
        >
          {confirmation.type === 'confirm' ? (
            <CheckCircle className="w-4 h-4 text-white" />
          ) : (
            <Undo2 className="w-4 h-4 text-white" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span
              className={`px-1.5 py-0.5 text-xs rounded ${
                confirmation.type === 'confirm'
                  ? 'bg-green-600/30 text-green-400'
                  : 'bg-orange-600/30 text-orange-400'
              }`}
            >
              {confirmation.type === 'confirm' ? '确认' : '撤销'}
            </span>
            <span className="text-slate-300 text-sm font-medium">
              {alarm?.title || '未知告警'}
            </span>
            {!confirmation.active && confirmation.type === 'confirm' && (
              <span className="text-xs text-slate-500">(已撤销)</span>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs text-slate-400 mb-2">
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {confirmation.operator}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatDateTime(confirmation.timestamp)}
            </span>
          </div>

          {confirmation.remark && (
            <div className="flex items-start gap-1 text-xs text-slate-300 bg-slate-900/50 rounded p-2">
              <MessageSquare className="w-3 h-3 mt-0.5 text-slate-500 flex-shrink-0" />
              <span>{confirmation.remark}</span>
            </div>
          )}

          <div className="mt-2 text-xs">
            <span className="text-slate-500">确认ID: </span>
            <span className="text-slate-400 font-mono">{confirmation.confirmationId.slice(0, 24)}...</span>
          </div>

          {confirmation.type === 'confirm' && confirmation.active && (
            <button
              onClick={handleUndo}
              className="mt-2 flex items-center gap-1 px-2 py-1 bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 text-xs rounded transition-colors"
            >
              <Undo2 className="w-3 h-3" />
              撤销此确认
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function HistoryPanel() {
  const { confirmations } = useReplayStore();

  const sortedConfirmations = [...confirmations].sort(
    (a, b) => b.timestamp - a.timestamp
  );

  const confirmCount = confirmations.filter((c) => c.type === 'confirm' && c.active).length;
  const undoCount = confirmations.filter((c) => c.type === 'undo').length;

  return (
    <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-purple-400" />
          <h3 className="text-slate-200 font-semibold">确认历史</h3>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 bg-green-900/50 text-green-300 rounded">
            确认 {confirmCount}
          </span>
          <span className="px-2 py-1 bg-orange-900/50 text-orange-300 rounded">
            撤销 {undoCount}
          </span>
          <span className="px-2 py-1 bg-slate-700 text-slate-300 rounded">
            共 {confirmations.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {sortedConfirmations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <History className="w-12 h-12 mb-2 opacity-30" />
            <p className="text-sm">暂无确认记录</p>
            <p className="text-xs mt-1">对活动告警进行确认后将显示在这里</p>
          </div>
        ) : (
          sortedConfirmations.map((confirmation) => (
            <HistoryItem
              key={confirmation.confirmationId}
              confirmation={confirmation}
            />
          ))
        )}
      </div>

      {confirmations.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-700">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <AlertTriangle className="w-3 h-3 text-yellow-500" />
            <span>提示：撤销操作会生成新的历史记录，原确认标记为已撤销</span>
          </div>
        </div>
      )}
    </div>
  );
}
