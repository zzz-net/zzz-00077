import { useState, useRef, ChangeEvent } from 'react';
import { useReplayStore } from '@/store/useReplayStore';
import { formatDateTime, formatTimestamp } from '@/utils/time';
import { Snapshot } from '@/engine/types';
import {
  Camera,
  Save,
  FolderDown,
  FolderUp,
  Undo2,
  Trash2,
  Download,
  Upload,
  X,
  AlertTriangle,
  CheckCircle,
  Clock,
  FileJson,
  ChevronRight,
  AlertOctagon,
} from 'lucide-react';

interface ConflictDialogProps {
  name: string;
  existingSnapshot: Snapshot;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConflictDialog({ name, existingSnapshot, onCancel, onConfirm }: ConflictDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-yellow-700/60 rounded-lg shadow-2xl max-w-md w-full overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-yellow-900/30 border-b border-yellow-800/60">
          <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0" />
          <h4 className="text-slate-100 font-semibold">确认覆盖已有快照？</h4>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-slate-300">
            已存在名为 <span className="text-yellow-400 font-mono">"{name}"</span> 的快照，是否继续覆盖？
          </p>
          <div className="bg-slate-900/60 rounded p-3 border border-slate-700 text-xs space-y-1.5">
            <div className="text-[11px] text-yellow-500/80 mb-2 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              以下是「{name}」原有快照当时保存的内容，覆盖后这些会被替换为当前状态：
            </div>
            <div className="flex gap-2 items-start">
              <span className="text-slate-500 w-20 flex-shrink-0" title="这个快照是什么时候创建的">创建时间</span>
              <div>
                <span className="text-slate-300">{formatDateTime(existingSnapshot.createdAt)}</span>
                <span className="text-slate-500 block text-[10px]">→ 何时保存的这个节点</span>
              </div>
            </div>
            <div className="flex gap-2 items-start">
              <span className="text-slate-500 w-20 flex-shrink-0" title="当时时间轴播放到什么位置">游标位置</span>
              <div>
                <span className="text-slate-300">{formatTimestamp(existingSnapshot.cursor)}</span>
                <span className="text-slate-500 block text-[10px]">→ 当时时间轴播放的位置</span>
              </div>
            </div>
            <div className="flex gap-2 items-start">
              <span className="text-slate-500 w-20 flex-shrink-0" title="当时有多少活动告警">告警数</span>
              <div>
                <span className="text-slate-300">{existingSnapshot.activeAlarms.length} 个</span>
                <span className="text-slate-500 block text-[10px]">→ 当时存在的活动告警数量</span>
              </div>
            </div>
            <div className="flex gap-2 items-start">
              <span className="text-slate-500 w-20 flex-shrink-0" title="当时已经确认了多少条告警">确认记录</span>
              <div>
                <span className="text-slate-300">{existingSnapshot.confirmations.length} 条</span>
                <span className="text-slate-500 block text-[10px]">→ 当时已确认/撤销的操作数</span>
              </div>
            </div>
            {existingSnapshot.description && (
              <div className="flex gap-2 items-start">
                <span className="text-slate-500 w-20 flex-shrink-0" title="保存时填写的描述">描述</span>
                <div>
                  <span className="text-slate-300">{existingSnapshot.description}</span>
                  <span className="text-slate-500 block text-[10px]">→ 保存时填写的备注说明</span>
                </div>
              </div>
            )}
          </div>
          <p className="text-xs text-yellow-500/80 flex items-start gap-1.5">
            <AlertOctagon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            覆盖后原快照内容将被替换且不可恢复。
          </p>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-700 bg-slate-900/40">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-1.5 rounded bg-yellow-600 hover:bg-yellow-500 text-white text-sm font-medium transition-colors flex items-center gap-1"
          >
            <Save className="w-3.5 h-3.5" />
            确认覆盖
          </button>
        </div>
      </div>
    </div>
  );
}

interface ResultToastProps {
  type: 'success' | 'error';
  message: string;
  onClose: () => void;
}

function ResultToast({ type, message, onClose }: ResultToastProps) {
  return (
    <div
      className={`fixed top-4 right-4 z-50 max-w-sm px-4 py-3 rounded-lg shadow-xl border flex items-start gap-3 animate-in fade-in slide-in-from-top duration-200 ${
        type === 'success'
          ? 'bg-green-900/90 border-green-700 text-green-100'
          : 'bg-red-900/90 border-red-700 text-red-100'
      }`}
    >
      {type === 'success' ? (
        <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
      ) : (
        <AlertOctagon className="w-5 h-5 flex-shrink-0 mt-0.5" />
      )}
      <div className="flex-1 text-sm">{message}</div>
      <button onClick={onClose} className="opacity-70 hover:opacity-100 transition-opacity">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

interface SnapshotItemProps {
  snapshot: Snapshot;
  isLatest?: boolean;
  onRestore: () => void;
  onExport: () => void;
  onDelete: () => void;
}

function SnapshotItem({ snapshot, isLatest, onRestore, onExport, onDelete }: SnapshotItemProps) {
  const [expanded, setExpanded] = useState(false);
  const duration = snapshot.endTime - snapshot.startTime;
  const progress = duration > 0 ? ((snapshot.cursor - snapshot.startTime) / duration) * 100 : 0;

  return (
    <div
      className={`rounded border overflow-hidden transition-colors ${
        isLatest
          ? 'bg-purple-900/15 border-purple-600/50 ring-1 ring-purple-500/20'
          : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
      }`}
    >
      <div className="p-3 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-start gap-3">
          <div className={`p-1.5 rounded ${isLatest ? 'bg-purple-600' : 'bg-slate-700'}`}>
            <Camera className={`w-4 h-4 text-white`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-slate-200 text-sm font-medium truncate">{snapshot.name}</span>
              {isLatest && (
                <span className="px-1.5 py-0.5 text-[10px] bg-purple-600/40 text-purple-300 rounded">
                  最近
                </span>
              )}
              <ChevronRight
                className={`w-3.5 h-3.5 text-slate-500 ml-auto flex-shrink-0 transition-transform ${
                  expanded ? 'rotate-90' : ''
                }`}
              />
            </div>
            {snapshot.description && (
              <p className="text-xs text-slate-400 truncate mb-1.5">{snapshot.description}</p>
            )}
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {formatDateTime(snapshot.createdAt)}
              </span>
              <span>游标 {formatTimestamp(snapshot.cursor)}</span>
            </div>
            <div className="mt-2 h-1 bg-slate-900/60 rounded overflow-hidden">
              <div
                className={`h-full rounded ${isLatest ? 'bg-purple-500' : 'bg-slate-500'}`}
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-slate-700/50 space-y-3">
          <div className="grid grid-cols-2 gap-2 text-[11px] pt-2">
            <div>
              <span className="text-slate-500">事件总数</span>
              <div className="text-slate-300 font-medium">{snapshot.events.length}</div>
            </div>
            <div>
              <span className="text-slate-500">当前索引</span>
              <div className="text-slate-300 font-medium">{snapshot.currentEventIndex}</div>
            </div>
            <div>
              <span className="text-slate-500">活动告警</span>
              <div className="text-slate-300 font-medium">{snapshot.activeAlarms.length}</div>
            </div>
            <div>
              <span className="text-slate-500">确认记录</span>
              <div className="text-slate-300 font-medium">{snapshot.confirmations.length}</div>
            </div>
            <div>
              <span className="text-slate-500">规则数量</span>
              <div className="text-slate-300 font-medium">{snapshot.rules.length}</div>
            </div>
            <div>
              <span className="text-slate-500">操作员</span>
              <div className="text-slate-300 font-medium truncate">{snapshot.operator}</div>
            </div>
          </div>
          {snapshot.operatorNotes && (
            <div className="text-[11px] bg-slate-900/50 rounded p-2 border border-slate-700/50">
              <div className="text-slate-500 mb-1">操作员备注</div>
              <div className="text-slate-300 break-words">{snapshot.operatorNotes}</div>
            </div>
          )}
          <div className="flex gap-1.5 pt-1" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={onRestore}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs rounded transition-colors"
            >
              <FolderDown className="w-3.5 h-3.5" />
              恢复
            </button>
            <button
              onClick={onExport}
              className="flex items-center justify-center gap-1 px-2 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded transition-colors"
              title="导出 JSON"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onDelete}
              className="flex items-center justify-center gap-1 px-2 py-1.5 bg-red-900/40 hover:bg-red-800/60 text-red-300 text-xs rounded transition-colors"
              title="删除快照"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SnapshotPanel() {
  const {
    snapshots,
    preRestoreSnapshot,
    saveSnapshot,
    restoreSnapshot,
    undoRestoreSnapshot,
    deleteSnapshot,
    exportSnapshot,
    importSnapshot,
    checkSnapshotConflict,
  } = useReplayStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pendingConflict, setPendingConflict] = useState<Snapshot | null>(null);
  const [pendingDesc, setPendingDesc] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sortedSnapshots = [...snapshots].sort((a, b) => b.createdAt - a.createdAt);
  const latestSnapshotId = sortedSnapshots[0]?.snapshotId;

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSave = () => {
    if (!name.trim()) {
      showToast('error', '快照名称不能为空');
      return;
    }
    const conflict = checkSnapshotConflict(name.trim());
    if (conflict.hasConflict && conflict.existingSnapshot) {
      setPendingConflict(conflict.existingSnapshot);
      setPendingDesc(description.trim());
      return;
    }
    const result = saveSnapshot(name, description);
    if (result.success) {
      showToast('success', `已保存快照 "${result.snapshot?.name}"`);
      setName('');
      setDescription('');
    } else {
      showToast('error', result.error || '保存失败');
    }
  };

  const handleConflictConfirm = () => {
    if (!pendingConflict) return;
    const result = saveSnapshot(pendingConflict.name, pendingDesc, true);
    if (result.success) {
      showToast('success', `已覆盖快照 "${pendingConflict.name}"`);
      setName('');
      setDescription('');
    } else {
      showToast('error', result.error || '覆盖失败');
    }
    setPendingConflict(null);
    setPendingDesc('');
  };

  const handleConflictCancel = () => {
    setPendingConflict(null);
    setPendingDesc('');
  };

  const handleRestore = (snap: Snapshot) => {
    const ok = restoreSnapshot(snap.snapshotId);
    if (ok) {
      showToast('success', `已恢复至 "${snap.name}"，可点击"撤销"回到之前状态`);
    } else {
      showToast('error', '恢复失败');
    }
  };

  const handleUndo = () => {
    const ok = undoRestoreSnapshot();
    if (ok) {
      showToast('success', '已撤销恢复，回到恢复前的状态');
    } else {
      showToast('error', '没有可撤销的恢复操作');
    }
  };

  const handleDelete = (snap: Snapshot) => {
    if (!confirm(`确定要删除快照 "${snap.name}" 吗？此操作不可撤销。`)) return;
    const ok = deleteSnapshot(snap.snapshotId);
    if (ok) {
      showToast('success', `已删除快照 "${snap.name}"`);
    } else {
      showToast('error', '删除失败');
    }
  };

  const handleExport = (snap: Snapshot) => {
    const json = exportSnapshot(snap.snapshotId);
    if (json) {
      showToast('success', `已导出快照 "${snap.name}"`);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleImportFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const content = (ev.target?.result as string) || '';
      const result = importSnapshot(content);
      if (result.success && result.snapshot) {
        showToast('success', `已导入快照 "${result.snapshot.name}"`);
      } else {
        showToast('error', `导入失败：${result.error || '未知错误'}`);
      }
    };
    reader.onerror = () => {
      showToast('error', '读取文件失败');
    };
    reader.readAsText(file);
  };

  return (
    <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-purple-400" />
          <h3 className="text-slate-200 font-semibold">场景快照</h3>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="px-2 py-1 bg-purple-900/50 text-purple-300 rounded">
            共 {snapshots.length}
          </span>
          <button
            onClick={handleImportClick}
            className="flex items-center gap-1 px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
            title="从 JSON 导入快照"
          >
            <Upload className="w-3.5 h-3.5" />
            导入
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </div>

      <div className="space-y-2 mb-3 pb-3 border-b border-slate-700/50">
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="输入快照名称..."
            className="flex-1 min-w-0 px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30"
            onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          />
          <button
            onClick={handleSave}
            className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded transition-colors font-medium"
          >
            <Save className="w-4 h-4" />
            保存
          </button>
        </div>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="描述（可选，例如：告警确认完毕、待交接等）"
          className="w-full px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30"
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
        />
      </div>

      {preRestoreSnapshot && (
        <div className="mb-3 p-2.5 rounded bg-blue-900/25 border border-blue-700/50 flex items-center gap-2 text-xs">
          <Undo2 className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <span className="text-blue-200 flex-1">刚恢复了快照，可撤销回到恢复前状态</span>
          <button
            onClick={handleUndo}
            className="px-2 py-1 bg-blue-700 hover:bg-blue-600 text-blue-100 rounded transition-colors flex items-center gap-1"
          >
            <Undo2 className="w-3 h-3" />
            撤销恢复
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {sortedSnapshots.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500 px-2">
            <Camera className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm font-medium text-slate-400 mb-2">还没有保存任何快照</p>
            <div className="text-[11px] text-center space-y-1 text-slate-500 max-w-[240px]">
              <p>📌 演练中随时在上方输入名称点「保存」</p>
              <p>🔄 之后可一键恢复到保存时的完整状态</p>
              <p>📤 支持导出 JSON 给同事导入继续演练</p>
              <p>💾 刷新页面也不会丢失</p>
            </div>
          </div>
        ) : (
          sortedSnapshots.map((snap) => (
            <SnapshotItem
              key={snap.snapshotId}
              snapshot={snap}
              isLatest={snap.snapshotId === latestSnapshotId}
              onRestore={() => handleRestore(snap)}
              onExport={() => handleExport(snap)}
              onDelete={() => handleDelete(snap)}
            />
          ))
        )}
      </div>

      {sortedSnapshots.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-700">
          <div className="flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
            <FileJson className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <div className="space-y-0.5">
              <p>• 点击卡片展开查看详情，可「恢复」「导出」「删除」</p>
              <p>• 恢复后可点击蓝色横幅的「撤销恢复」回到之前状态</p>
              <p>• 快照持久化保存在本地，导入损坏文件不会污染当前会话</p>
            </div>
          </div>
        </div>
      )}

      {sortedSnapshots.length === 0 && (
        <div className="mt-3 pt-3 border-t border-slate-700">
          <div className="flex items-start gap-2 text-[11px] text-slate-600 leading-relaxed">
            <FileJson className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <div className="space-y-0.5">
              <p>• 快照包含：事件时间轴、游标、告警、确认、备注、规则</p>
              <p>• 右上角「导入」按钮可导入别人分享的快照 JSON</p>
              <p>• 同名保存会弹确认框，不会意外覆盖</p>
            </div>
          </div>
        </div>
      )}

      {pendingConflict && (
        <ConflictDialog
          name={pendingConflict.name}
          existingSnapshot={pendingConflict}
          onCancel={handleConflictCancel}
          onConfirm={handleConflictConfirm}
        />
      )}

      {toast && <ResultToast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
