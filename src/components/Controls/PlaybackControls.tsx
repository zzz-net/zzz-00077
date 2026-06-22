import { useState } from 'react';
import { useReplayStore } from '@/store/useReplayStore';
import { formatTimestamp } from '@/utils/time';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  RotateCcw,
  ArrowRightToLine,
  FastForward,
  Download,
  Upload,
  Database,
  Trash2,
  Save,
  Settings,
  X,
} from 'lucide-react';

const SPEEDS = [0.5, 1, 2, 4];

export function PlaybackControls() {
  const {
    isPlaying,
    speed,
    play,
    pause,
    stepForward,
    stepBackward,
    reset,
    jumpTo,
    setSpeed,
    exportTimeline,
    importEventsFromJson,
    loadSampleEvents,
    clearSession,
    saveSession,
    operator,
    setOperator,
    operatorNotes,
    setOperatorNotes,
    startTime,
    endTime,
    cursor,
    errorMessage,
    setErrorMessage,
    progress,
    rules,
  } = useReplayStore();

  const [jumpTime, setJumpTime] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const handleJump = () => {
    const parts = jumpTime.split(':');
    if (parts.length >= 3) {
      const hours = parseInt(parts[0]) || 0;
      const minutes = parseInt(parts[1]) || 0;
      const seconds = parseFloat(parts[2]) || 0;
      const baseDate = new Date(startTime);
      baseDate.setHours(hours, minutes, Math.floor(seconds), (seconds % 1) * 1000);
      jumpTo(baseDate.getTime());
    }
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        importEventsFromJson(event.target?.result as string);
      } catch (err) {
        setErrorMessage('文件解析失败');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const ruleVersion = rules.length > 0 ? rules[0].version : 'v1.0';

  return (
    <div className="bg-slate-900 rounded-lg p-4 border border-slate-700">
      {errorMessage && (
        <div className="mb-4 p-3 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage('')} className="hover:text-red-100">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <button
          onClick={stepBackward}
          className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-600 transition-colors"
          title="上一个事件"
        >
          <SkipBack className="w-5 h-5" />
        </button>

        {isPlaying ? (
          <button
            onClick={pause}
            className="p-3 bg-purple-600 hover:bg-purple-500 text-white rounded border border-purple-400 transition-colors"
            title="暂停"
          >
            <Pause className="w-6 h-6" />
          </button>
        ) : (
          <button
            onClick={() => play(speed)}
            className="p-3 bg-green-600 hover:bg-green-500 text-white rounded border border-green-400 transition-colors"
            title="播放"
          >
            <Play className="w-6 h-6" />
          </button>
        )}

        <button
          onClick={stepForward}
          className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-600 transition-colors"
          title="下一个事件"
        >
          <SkipForward className="w-5 h-5" />
        </button>

        <button
          onClick={reset}
          className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-600 transition-colors"
          title="重置"
        >
          <RotateCcw className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-1 ml-4">
          <FastForward className="w-4 h-4 text-slate-400" />
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2 py-1 text-xs rounded border transition-colors ${
                speed === s
                  ? 'bg-purple-600 text-white border-purple-400'
                  : 'bg-slate-800 text-slate-400 border-slate-600 hover:bg-slate-700'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-4">
          <input
            type="text"
            value={jumpTime}
            onChange={(e) => setJumpTime(e.target.value)}
            placeholder="HH:MM:SS.sss"
            className="w-32 px-2 py-1 bg-slate-800 border border-slate-600 rounded text-sm text-slate-300 font-mono placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />
          <button
            onClick={handleJump}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-600 transition-colors"
            title="跳转"
          >
            <ArrowRightToLine className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 mx-4 h-2 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-purple-600 to-pink-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs text-slate-400 font-mono w-16">{progress.toFixed(1)}%</span>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">操作员:</label>
          <input
            type="text"
            value={operator}
            onChange={(e) => setOperator(e.target.value)}
            className="w-24 px-2 py-1 bg-slate-800 border border-slate-600 rounded text-sm text-slate-300 focus:outline-none focus:border-purple-500"
          />
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400">规则版本:</span>
          <span className="text-purple-400 font-mono">{ruleVersion}</span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400">游标:</span>
          <span className="text-green-400 font-mono">{formatTimestamp(cursor)}</span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <label className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded cursor-pointer transition-colors">
            <Upload className="w-4 h-4" />
            导入
            <input
              type="file"
              accept=".json"
              onChange={handleFileImport}
              className="hidden"
            />
          </label>

          <button
            onClick={loadSampleEvents}
            className="flex items-center gap-1 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm rounded transition-colors"
          >
            <Database className="w-4 h-4" />
            加载样例
          </button>

          <button
            onClick={() => exportTimeline(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-sm rounded transition-colors"
          >
            <Download className="w-4 h-4" />
            导出
          </button>

          <button
            onClick={saveSession}
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
          >
            <Save className="w-4 h-4" />
            保存
          </button>

          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button
            onClick={clearSession}
            className="flex items-center gap-1 px-3 py-1.5 bg-red-700 hover:bg-red-600 text-white text-sm rounded transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            清除
          </button>
        </div>
      </div>

      {showSettings && (
        <div className="mt-4 p-4 bg-slate-800 rounded border border-slate-600">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-slate-200 font-semibold">会话设置</h4>
            <button
              onClick={() => setShowSettings(false)}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">操作员备注</label>
            <textarea
              value={operatorNotes}
              onChange={(e) => setOperatorNotes(e.target.value)}
              placeholder="记录本次回放的备注信息..."
              className="w-full h-20 px-3 py-2 bg-slate-900 border border-slate-600 rounded text-sm text-slate-300 placeholder-slate-500 focus:outline-none focus:border-purple-500 resize-none"
            />
          </div>
          <div className="mt-3 flex items-center gap-4 text-xs text-slate-400">
            <span>时间范围: {formatTimestamp(startTime)} ~ {formatTimestamp(endTime)}</span>
            <span>当前速度: {speed}x</span>
            <span>播放状态: {isPlaying ? '播放中' : '已暂停'}</span>
          </div>
        </div>
      )}
    </div>
  );
}
