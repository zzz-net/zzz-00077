import { useState } from 'react';
import { useReplayStore } from '@/store/useReplayStore';
import { formatTimestamp, formatDuration } from '@/utils/time';
import { Alarm } from '@/engine/types';
import { AlertTriangle, Clock, CheckCircle, User, MessageSquare, ChevronDown, ChevronUp, XCircle } from 'lucide-react';

const LEVEL_COLORS = {
  critical: 'bg-red-600 border-red-400',
  warning: 'bg-orange-600 border-orange-400',
  info: 'bg-blue-600 border-blue-400',
};

const LEVEL_TEXT = {
  critical: '严重',
  warning: '重要',
  info: '一般',
};

interface AlarmCardProps {
  alarm: Alarm;
  cursor: number;
}

function AlarmCard({ alarm, cursor }: AlarmCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [remark, setRemark] = useState('');
  const { confirmAlarm, undoConfirmation } = useReplayStore();

  const duration = cursor - alarm.startTime;
  const isActive = alarm.status === 'active';
  const isConfirmed = alarm.status === 'confirmed';
  const isCleared = alarm.status === 'cleared';

  const handleConfirm = () => {
    confirmAlarm(alarm.alarmId, remark);
    setRemark('');
  };

  const handleUndo = () => {
    if (alarm.confirmationId) {
      undoConfirmation(alarm.confirmationId);
    }
  };

  return (
    <div
      className={`rounded-lg border overflow-hidden transition-all ${
        isActive
          ? 'bg-slate-800 border-slate-600 hover:border-purple-500'
          : isConfirmed
          ? 'bg-green-900/20 border-green-700'
          : 'bg-slate-800/50 border-slate-700'
      }`}
    >
      <div
        className="p-3 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start gap-3">
          <div
            className={`p-2 rounded ${
              isActive ? LEVEL_COLORS[alarm.level] : 'bg-slate-700'
            }`}
          >
            {isConfirmed ? (
              <CheckCircle className="w-5 h-5 text-white" />
            ) : isCleared ? (
              <XCircle className="w-5 h-5 text-slate-400" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-white animate-pulse" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span
                className={`px-2 py-0.5 text-xs rounded font-medium ${
                  isActive ? LEVEL_COLORS[alarm.level] : 'bg-slate-700'
                } text-white`}
              >
                {LEVEL_TEXT[alarm.level]}
              </span>
              <span className="text-slate-300 font-medium truncate">{alarm.title}</span>
              {isConfirmed && (
                <span className="text-xs text-green-400">✓ 已确认</span>
              )}
              {isCleared && (
                <span className="text-xs text-slate-400">已清除</span>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatTimestamp(alarm.startTime)}
              </span>
              {isActive && (
                <span className="flex items-center gap-1 text-yellow-400">
                  <Clock className="w-3 h-3" />
                  持续 {formatDuration(duration)}
                </span>
              )}
              {alarm.endTime && (
                <span className="text-slate-500">
                  结束于 {formatTimestamp(alarm.endTime)}
                </span>
              )}
            </div>
          </div>

          <div className="text-slate-400">
            {expanded ? (
              <ChevronUp className="w-5 h-5" />
            ) : (
              <ChevronDown className="w-5 h-5" />
            )}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 border-t border-slate-700 pt-3">
          <div className="mb-3 text-xs">
            <span className="text-slate-500">告警ID: </span>
            <span className="text-slate-300 font-mono">{alarm.alarmId.slice(0, 20)}...</span>
          </div>
          <div className="mb-3 text-xs">
            <span className="text-slate-500">关联事件: </span>
            <span className="text-slate-300 font-mono">{alarm.eventId}</span>
          </div>
          <div className="mb-3 text-xs">
            <span className="text-slate-500">关联规则: </span>
            <span className="text-slate-300 font-mono">{alarm.ruleId}</span>
          </div>

          {isActive && (
            <div className="mt-4 space-y-2">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={remark}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="添加确认备注..."
                  className="flex-1 px-2 py-1.5 bg-slate-900 border border-slate-600 rounded text-sm text-slate-300 placeholder-slate-500 focus:outline-none focus:border-purple-500"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleConfirm();
                  }}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-green-600 hover:bg-green-500 text-white text-sm rounded transition-colors"
                >
                  <CheckCircle className="w-4 h-4" />
                  确认告警
                </button>
              </div>
            </div>
          )}

          {isConfirmed && (
            <div className="mt-4">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleUndo();
                }}
                className="w-full flex items-center justify-center gap-1 px-3 py-2 bg-orange-600 hover:bg-orange-500 text-white text-sm rounded transition-colors"
              >
                <MessageSquare className="w-4 h-4" />
                撤销确认
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function AlarmPanel() {
  const { activeAlarms, cursor } = useReplayStore();

  const activeAlarmsList = activeAlarms.filter((a) => a.status === 'active');
  const confirmedAlarmsList = activeAlarms.filter((a) => a.status === 'confirmed');
  const clearedAlarmsList = activeAlarms.filter((a) => a.status === 'cleared');

  return (
    <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <h3 className="text-slate-200 font-semibold">活动告警</h3>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-1 bg-red-900/50 text-red-300 rounded">
            活动 {activeAlarmsList.length}
          </span>
          <span className="px-2 py-1 bg-green-900/50 text-green-300 rounded">
            已确认 {confirmedAlarmsList.length}
          </span>
          <span className="px-2 py-1 bg-slate-700 text-slate-300 rounded">
            已清除 {clearedAlarmsList.length}
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {activeAlarms.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <AlertTriangle className="w-12 h-12 mb-2 opacity-30" />
            <p className="text-sm">暂无活动告警</p>
          </div>
        ) : (
          <>
            {activeAlarmsList.map((alarm) => (
              <AlarmCard key={alarm.alarmId} alarm={alarm} cursor={cursor} />
            ))}
            {confirmedAlarmsList.map((alarm) => (
              <AlarmCard key={alarm.alarmId} alarm={alarm} cursor={cursor} />
            ))}
            {clearedAlarmsList.map((alarm) => (
              <AlarmCard key={alarm.alarmId} alarm={alarm} cursor={cursor} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
