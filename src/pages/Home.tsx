import { useEffect, useState } from 'react';
import { useReplayStore } from '@/store/useReplayStore';
import { Timeline } from '@/components/Timeline/Timeline';
import { PlaybackControls } from '@/components/Controls/PlaybackControls';
import { AlarmPanel } from '@/components/AlarmPanel/AlarmPanel';
import { InputQueue } from '@/components/InputQueue/InputQueue';
import { HistoryPanel } from '@/components/HistoryPanel/HistoryPanel';
import { RuleEditor } from '@/components/RuleEditor/RuleEditor';
import { SnapshotPanel } from '@/components/SnapshotPanel/SnapshotPanel';
import { AlertTriangle, Activity, Database, RefreshCw, Camera, History } from 'lucide-react';

export default function Home() {
  const { loadSession, loadSampleEvents, cursor, rules, activeAlarms, pendingEvents, snapshots, confirmations } = useReplayStore();
  const [activeTab, setActiveTab] = useState<'alarms' | 'rules'>('alarms');
  const [rightTab, setRightTab] = useState<'history' | 'snapshots'>('history');
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    const sessionExists = localStorage.getItem('replay:session');
    setHasSession(!!sessionExists);
    if (sessionExists) {
      loadSession();
    } else {
      loadSampleEvents();
    }
  }, [loadSession, loadSampleEvents]);

  const ruleVersion = rules.length > 0 ? rules[0].version : 'v1.0';

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="bg-slate-900 border-b border-slate-700 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-600 rounded-lg">
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">
                <span className="gradient-text">告警回放工具</span>
              </h1>
              <p className="text-xs text-slate-400">本地仓库告警事件回放与演练系统</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full ${activeAlarms.filter(a => a.status === 'active').length > 0 ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`} />
                <span className="text-slate-300">
                  活动告警: <span className="text-white font-mono">{activeAlarms.filter(a => a.status === 'active').length}</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-400" />
                <span className="text-slate-300">
                  规则版本: <span className="text-purple-400 font-mono">{ruleVersion}</span>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-400" />
                <span className="text-slate-300">
                  待处理: <span className="text-orange-400 font-mono">{pendingEvents.length}</span>
                </span>
              </div>
            </div>

            {hasSession && (
              <div className="flex items-center gap-2 text-xs text-green-400">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>会话已自动保存</span>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="p-4 space-y-4">
        <PlaybackControls />
        <Timeline />

        <div className="grid grid-cols-12 gap-4" style={{ height: 'calc(100vh - 420px)' }}>
          <div className="col-span-3 flex flex-col gap-4">
            <div className="flex gap-2 mb-2">
              <button
                onClick={() => setActiveTab('alarms')}
                className={`flex-1 px-3 py-2 text-sm rounded border transition-colors ${
                  activeTab === 'alarms'
                    ? 'bg-purple-600 text-white border-purple-400'
                    : 'bg-slate-800 text-slate-400 border-slate-600 hover:bg-slate-700'
                }`}
              >
                活动告警
              </button>
              <button
                onClick={() => setActiveTab('rules')}
                className={`flex-1 px-3 py-2 text-sm rounded border transition-colors ${
                  activeTab === 'rules'
                    ? 'bg-cyan-600 text-white border-cyan-400'
                    : 'bg-slate-800 text-slate-400 border-slate-600 hover:bg-slate-700'
                }`}
              >
                告警规则
              </button>
            </div>
            <div className="flex-1 min-h-0">
              {activeTab === 'alarms' ? <AlarmPanel /> : <RuleEditor />}
            </div>
          </div>

          <div className="col-span-5 flex flex-col gap-4">
            <div className="flex-1 min-h-0">
              <InputQueue />
            </div>
          </div>

          <div className="col-span-4 flex flex-col gap-4">
            <div className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-lg p-1">
              <button
                onClick={() => setRightTab('history')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                  rightTab === 'history'
                    ? 'bg-slate-700 text-white font-medium'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <History className="w-3.5 h-3.5" />
                确认历史
                <span className={`px-1.5 py-0.5 text-[10px] rounded ${rightTab === 'history' ? 'bg-slate-600' : 'bg-slate-800'} text-slate-300`}>
                  {confirmations.length}
                </span>
              </button>
              <button
                onClick={() => setRightTab('snapshots')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                  rightTab === 'snapshots'
                    ? 'bg-purple-600 text-white font-medium'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Camera className="w-3.5 h-3.5" />
                场景快照
                <span className={`px-1.5 py-0.5 text-[10px] rounded ${rightTab === 'snapshots' ? 'bg-purple-500' : 'bg-slate-800'} text-slate-200`}>
                  {snapshots.length}
                </span>
              </button>
            </div>
            <div className="flex-1 min-h-0">
              {rightTab === 'history' ? <HistoryPanel /> : <SnapshotPanel />}
            </div>
          </div>
        </div>
      </main>

      <footer className="bg-slate-900 border-t border-slate-700 px-6 py-2 text-xs text-slate-500 flex items-center justify-between">
        <span>告警回放工具 v1.0 | 数据存储于浏览器本地，无需后端服务</span>
        <span className="font-mono">当前游标: {new Date(cursor).toLocaleString()}</span>
      </footer>
    </div>
  );
}
