import { useRef, useEffect, useState, useCallback } from 'react';
import { useReplayStore } from '@/store/useReplayStore';
import { formatTimestamp } from '@/utils/time';
import { Event } from '@/engine/types';
import { Clock, AlertTriangle, CheckCircle, Info } from 'lucide-react';

export function Timeline() {
  const { cursor, startTime, endTime, events, processedEvents, jumpTo, isPlaying, pause } = useReplayStore();
  const timelineRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const duration = endTime - startTime;
  const position = duration > 0 ? ((cursor - startTime) / duration) * 100 : 0;

  const getEventPosition = (event: Event) => {
    return duration > 0 ? ((event.timestamp - startTime) / duration) * 100 : 0;
  };

  const getEventColor = (event: Event) => {
    if (event.status === 'duplicate') return 'bg-gray-500';
    if (event.status === 'pending' || event.status === 'orphan_clear') return 'bg-orange-500';
    if (event.type === 'alert') return 'bg-red-500';
    if (event.type === 'clear') return 'bg-green-500';
    return 'bg-blue-400';
  };

  const getEventIcon = (event: Event) => {
    if (event.type === 'alert') return <AlertTriangle className="w-3 h-3" />;
    if (event.type === 'clear') return <CheckCircle className="w-3 h-3" />;
    return <Info className="w-3 h-3" />;
  };

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (isPlaying) pause();
    setIsDragging(true);
    updateCursorPosition(e);
  }, [isPlaying, pause]);

  const updateCursorPosition = useCallback((e: React.MouseEvent | MouseEvent) => {
    if (!timelineRef.current) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(100, (x / rect.width) * 100));
    const newTimestamp = startTime + (percentage / 100) * duration;
    jumpTo(newTimestamp);
  }, [startTime, duration, jumpTo]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging) {
      updateCursorPosition(e);
    }
  }, [isDragging, updateCursorPosition]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const processedIds = new Set(processedEvents.map(e => e.eventId));

  return (
    <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-slate-300">
          <Clock className="w-4 h-4 text-purple-400" />
          <span className="font-mono text-sm">时间轴</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-slate-400 font-mono">{formatTimestamp(startTime)}</span>
          <span className="text-purple-400 font-mono font-bold">{formatTimestamp(cursor)}</span>
          <span className="text-slate-400 font-mono">{formatTimestamp(endTime)}</span>
        </div>
      </div>

      <div
        ref={timelineRef}
        className="relative h-20 bg-slate-800 rounded cursor-pointer select-none"
        onMouseDown={handleMouseDown}
      >
        <div className="absolute inset-y-0 left-0 bg-purple-900/30" style={{ width: `${position}%` }} />

        {events.map((event, idx) => {
          const pos = getEventPosition(event);
          const isProcessed = processedIds.has(event.eventId);
          return (
            <div
              key={`${event.eventId}-${idx}`}
              className={`absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full flex items-center justify-center text-white transition-transform hover:scale-150 ${getEventColor(event)} ${isProcessed ? 'opacity-100' : 'opacity-50'}`}
              style={{ left: `calc(${pos}% - 8px)` }}
              title={`${event.title} (${event.eventId}) - ${formatTimestamp(event.timestamp)}${event.status ? ` [${event.status}]` : ''}`}
            >
              {getEventIcon(event)}
            </div>
          );
        })}

        <div
          className="absolute top-0 bottom-0 w-0.5 bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.8)] z-10"
          style={{ left: `${position}%` }}
        >
          <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-purple-500 rotate-45" />
        </div>

        <div className="absolute bottom-0 left-0 right-0 h-6 border-t border-slate-600 flex items-end justify-between px-2 pb-1">
          {[0, 25, 50, 75, 100].map(percent => {
            const ts = startTime + (percent / 100) * duration;
            return (
              <div key={percent} className="flex flex-col items-center">
                <div className="w-px h-2 bg-slate-500" />
                <span className="text-[10px] text-slate-500 font-mono">{formatTimestamp(ts).slice(0, 8)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-4 mt-3 text-xs text-slate-400">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-red-500" />
          <span>告警</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-green-500" />
          <span>清除</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-blue-400" />
          <span>信息</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-gray-500" />
          <span>重复</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-orange-500" />
          <span>待匹配</span>
        </div>
        <div className="ml-auto">
          <span>共 {events.length} 个事件，已处理 {processedEvents.length} 个</span>
        </div>
      </div>
    </div>
  );
}
