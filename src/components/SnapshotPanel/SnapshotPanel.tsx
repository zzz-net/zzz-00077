import { useState, useRef, useMemo, ChangeEvent } from 'react';
import { useReplayStore } from '@/store/useReplayStore';
import { formatDateTime, formatTimestamp } from '@/utils/time';
import {
  Snapshot, SnapshotSortOrder, ImportConflictStrategy, SnapshotOperationLog,
} from '@/engine/types';
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
  Search,
  ArrowUpDown,
  CheckSquare,
  Square,
  Edit3,
  ListChecks,
  Hash,
  History,
  Trash,
} from 'lucide-react';

type TabType = 'snapshots' | 'logs';

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
              <span className="text-slate-500 w-20 flex-shrink-0">创建时间</span>
              <div>
                <span className="text-slate-300">{formatDateTime(existingSnapshot.createdAt)}</span>
              </div>
            </div>
            <div className="flex gap-2 items-start">
              <span className="text-slate-500 w-20 flex-shrink-0">游标位置</span>
              <div>
                <span className="text-slate-300">{formatTimestamp(existingSnapshot.cursor)}</span>
              </div>
            </div>
            <div className="flex gap-2 items-start">
              <span className="text-slate-500 w-20 flex-shrink-0">告警数</span>
              <div>
                <span className="text-slate-300">{existingSnapshot.activeAlarms.length} 个</span>
              </div>
            </div>
            {existingSnapshot.description && (
              <div className="flex gap-2 items-start">
                <span className="text-slate-500 w-20 flex-shrink-0">描述</span>
                <div>
                  <span className="text-slate-300">{existingSnapshot.description}</span>
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

interface ImportConflictDialogProps {
  conflictingNames: string[];
  onOverwrite: () => void;
  onKeepBoth: () => void;
  onCancel: () => void;
}

function ImportConflictDialog({ conflictingNames, onOverwrite, onKeepBoth, onCancel }: ImportConflictDialogProps) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-orange-700/60 rounded-lg shadow-2xl max-w-md w-full overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-orange-900/30 border-b border-orange-800/60">
          <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0" />
          <h4 className="text-slate-100 font-semibold">导入快照存在名称冲突</h4>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-sm text-slate-300">
            以下 {conflictingNames.length} 个快照名称与本地重复，请选择处理方式：
          </p>
          <div className="bg-slate-900/60 rounded p-3 border border-slate-700 max-h-36 overflow-y-auto">
            <ul className="space-y-1">
              {conflictingNames.map((name, i) => (
                <li key={i} className="text-xs text-orange-300 font-mono px-2 py-0.5 bg-orange-900/20 rounded">
                  {name}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-xs text-slate-400 flex items-start gap-1.5">
            <AlertOctagon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            选择「覆盖」将用导入文件替换本地同名快照；选择「保留两份」将自动对导入的快照重命名。
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
            onClick={onKeepBoth}
            className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm transition-colors"
          >
            保留两份
          </button>
          <button
            onClick={onOverwrite}
            className="px-4 py-1.5 rounded bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium transition-colors flex items-center gap-1"
          >
            覆盖同名
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

interface RenameDialogProps {
  snapshot: Snapshot;
  onCancel: () => void;
  onConfirm: (newName: string, newDescription: string) => void;
}

function RenameDialog({ snapshot, onCancel, onConfirm }: RenameDialogProps) {
  const [name, setName] = useState(snapshot.name);
  const [description, setDescription] = useState(snapshot.description || '');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl max-w-md w-full overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-slate-700/50 border-b border-slate-600">
          <Edit3 className="w-5 h-5 text-blue-400 flex-shrink-0" />
          <h4 className="text-slate-100 font-semibold">编辑快照信息</h4>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">快照名称</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">备注描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="添加备注信息..."
              className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-700 bg-slate-900/40">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(name, description)}
            disabled={!name.trim()}
            className="px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center gap-1"
          >
            <Save className="w-3.5 h-3.5" />
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

interface BatchRenameDialogProps {
  count: number;
  onCancel: () => void;
  onConfirm: (pattern: 'prefix' | 'suffix' | 'replace', value: string) => void;
}

function BatchRenameDialog({ count, onCancel, onConfirm }: BatchRenameDialogProps) {
  const [pattern, setPattern] = useState<'prefix' | 'suffix' | 'replace'>('prefix');
  const [value, setValue] = useState('');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl max-w-md w-full overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-slate-700/50 border-b border-slate-600">
          <Hash className="w-5 h-5 text-purple-400 flex-shrink-0" />
          <h4 className="text-slate-100 font-semibold">批量重命名 ({count} 个)</h4>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">重命名方式</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: 'prefix', label: '加前缀' },
                { key: 'suffix', label: '加后缀' },
                { key: 'replace', label: '替换为' },
              ] as const).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setPattern(opt.key)}
                  className={`px-3 py-2 text-xs rounded transition-colors ${
                    pattern === opt.key
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              {pattern === 'prefix' && '前缀内容'}
              {pattern === 'suffix' && '后缀内容'}
              {pattern === 'replace' && '基础名称（自动追加序号）'}
            </label>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={pattern === 'replace' ? '例如：检查点 → 检查点1、检查点2...' : '输入内容...'}
              className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500"
              autoFocus
            />
          </div>
          {pattern === 'replace' && (
            <p className="text-xs text-slate-500">
              选中的 {count} 个快照将被重命名为："{value || '名称'}"1、"{value || '名称'}"2 ...
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-700 bg-slate-900/40">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(pattern, value)}
            disabled={!value.trim()}
            className="px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center gap-1"
          >
            <Save className="w-3.5 h-3.5" />
            应用
          </button>
        </div>
      </div>
    </div>
  );
}

interface BatchDescDialogProps {
  count: number;
  onCancel: () => void;
  onConfirm: (description: string, mode: 'replace' | 'append' | 'prepend') => void;
}

function BatchDescDialog({ count, onCancel, onConfirm }: BatchDescDialogProps) {
  const [mode, setMode] = useState<'replace' | 'append' | 'prepend'>('replace');
  const [description, setDescription] = useState('');

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl max-w-md w-full overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 bg-slate-700/50 border-b border-slate-600">
          <Edit3 className="w-5 h-5 text-teal-400 flex-shrink-0" />
          <h4 className="text-slate-100 font-semibold">批量修改备注 ({count} 个)</h4>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">修改方式</label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: 'replace', label: '替换' },
                { key: 'append', label: '追加' },
                { key: 'prepend', label: '前置' },
              ] as const).map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setMode(opt.key)}
                  className={`px-3 py-2 text-xs rounded transition-colors ${
                    mode === opt.key
                      ? 'bg-teal-600 text-white'
                      : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">备注内容</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="输入备注内容..."
              className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-teal-500 resize-none"
              autoFocus
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-slate-700 bg-slate-900/40">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm(description, mode)}
            disabled={!description.trim()}
            className="px-4 py-1.5 rounded bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center gap-1"
          >
            <Save className="w-3.5 h-3.5" />
            应用
          </button>
        </div>
      </div>
    </div>
  );
}

interface SnapshotItemProps {
  snapshot: Snapshot;
  isLatest?: boolean;
  isSelected: boolean;
  selectMode: boolean;
  onToggleSelect: () => void;
  onRestore: () => void;
  onExport: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

function SnapshotItem({ snapshot, isLatest, isSelected, selectMode, onToggleSelect, onRestore, onExport, onDelete, onEdit }: SnapshotItemProps) {
  const [expanded, setExpanded] = useState(false);
  const duration = snapshot.endTime - snapshot.startTime;
  const progress = duration > 0 ? ((snapshot.cursor - snapshot.startTime) / duration) * 100 : 0;

  return (
    <div
      className={`rounded border overflow-hidden transition-colors ${
        isSelected
          ? 'bg-blue-900/20 border-blue-500/60 ring-1 ring-blue-500/30'
          : isLatest
            ? 'bg-purple-900/15 border-purple-600/50 ring-1 ring-purple-500/20'
            : 'bg-slate-800/50 border-slate-700 hover:border-slate-600'
      }`}
    >
      <div className="p-3 cursor-pointer flex items-start gap-2" onClick={() => setExpanded(!expanded)}>
        {selectMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
            className="mt-0.5 flex-shrink-0 text-slate-400 hover:text-slate-200 transition-colors"
          >
            {isSelected ? <CheckSquare className="w-4 h-4 text-blue-400" /> : <Square className="w-4 h-4" />}
          </button>
        )}
        <div className={`p-1.5 rounded flex-shrink-0 ${isLatest ? 'bg-purple-600' : isSelected ? 'bg-blue-600' : 'bg-slate-700'}`}>
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
              className={`h-full rounded ${isLatest ? 'bg-purple-500' : isSelected ? 'bg-blue-500' : 'bg-slate-500'}`}
              style={{ width: `${Math.min(100, progress)}%` }}
            />
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
              <span className="text-slate-500">活动告警</span>
              <div className="text-slate-300 font-medium">{snapshot.activeAlarms.length}</div>
            </div>
            <div>
              <span className="text-slate-500">确认记录</span>
              <div className="text-slate-300 font-medium">{snapshot.confirmations.length}</div>
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
              onClick={onEdit}
              className="flex items-center justify-center gap-1 px-2 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded transition-colors"
              title="编辑名称/备注"
            >
              <Edit3 className="w-3.5 h-3.5" />
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

const ACTION_LABELS: Record<string, string> = {
  create: '创建',
  update: '更新',
  delete: '删除',
  restore: '恢复',
  undo_restore: '撤销恢复',
  export: '导出',
  import: '导入',
  rename: '重命名',
  batch_rename: '批量重命名',
  batch_export: '批量导出',
  batch_delete: '批量删除',
};

const ACTION_COLORS: Record<string, string> = {
  create: 'text-green-400',
  update: 'text-blue-400',
  delete: 'text-red-400',
  restore: 'text-purple-400',
  undo_restore: 'text-cyan-400',
  export: 'text-teal-400',
  import: 'text-orange-400',
  rename: 'text-indigo-400',
  batch_rename: 'text-indigo-400',
  batch_export: 'text-teal-400',
  batch_delete: 'text-red-400',
};

function LogItem({ log }: { log: SnapshotOperationLog }) {
  return (
    <div className="px-3 py-2 border-b border-slate-700/40 last:border-b-0">
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-medium ${ACTION_COLORS[log.action] || 'text-slate-400'}`}>
          [{ACTION_LABELS[log.action] || log.action}]
        </span>
        <span className="text-[11px] text-slate-500 ml-auto flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatDateTime(log.timestamp)}
        </span>
      </div>
      <div className="text-xs text-slate-300 mb-0.5">
        操作员: <span className="text-slate-400">{log.operator}</span>
      </div>
      {log.snapshotNames.length > 0 && (
        <div className="text-xs text-slate-400 truncate">
          快照: {log.snapshotNames.join(', ')}
        </div>
      )}
      {log.detail && (
        <div className="text-[11px] text-slate-500 mt-0.5 italic">{log.detail}</div>
      )}
    </div>
  );
}

export function SnapshotPanel() {
  const {
    snapshots,
    preRestoreSnapshot,
    snapshotLogs,
    saveSnapshot,
    restoreSnapshot,
    undoRestoreSnapshot,
    deleteSnapshot,
    exportSnapshot,
    importSnapshot,
    importSnapshots,
    checkSnapshotConflict,
    checkImportConflicts,
    renameSnapshot,
    updateSnapshotDescription,
    batchRenameSnapshots,
    batchUpdateSnapshotsDescription,
    batchDeleteSnapshots,
    batchExportSnapshots,
    filterSnapshots,
    sortSnapshots,
    clearSnapshotLogs,
  } = useReplayStore();

  const [tab, setTab] = useState<TabType>('snapshots');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [pendingConflict, setPendingConflict] = useState<Snapshot | null>(null);
  const [pendingDesc, setPendingDesc] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchKeyword, setSearchKeyword] = useState('');
  const [sortOrder, setSortOrder] = useState<SnapshotSortOrder>('newest_first');

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [editingSnapshot, setEditingSnapshot] = useState<Snapshot | null>(null);
  const [showBatchRename, setShowBatchRename] = useState(false);
  const [showBatchDesc, setShowBatchDesc] = useState(false);

  const [pendingImportData, setPendingImportData] = useState<{ json: string; conflictingNames: string[] } | null>(null);

  const pendingImportFile = useRef<string>('');

  const displaySnapshots = useMemo(() => {
    const filtered = filterSnapshots(searchKeyword);
    return sortSnapshots(filtered, sortOrder);
  }, [snapshots, searchKeyword, sortOrder, filterSnapshots, sortSnapshots]);

  const latestSnapshotId = useMemo(() => {
    const sorted = [...snapshots].sort((a, b) => b.createdAt - a.createdAt);
    return sorted[0]?.snapshotId;
  }, [snapshots]);

  const showToast = (type: 'success' | 'error', message: string) => {
    setToast({ type, message });
    setTimeout(() => setToast(null), 3500);
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
      setSelectedIds(prev => {
        const n = new Set(prev);
        n.delete(snap.snapshotId);
        return n;
      });
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

  const handleEdit = (snap: Snapshot) => {
    setEditingSnapshot(snap);
  };

  const handleEditConfirm = (newName: string, newDesc: string) => {
    if (!editingSnapshot) return;
    const renameResult = renameSnapshot(editingSnapshot.snapshotId, newName);
    if (!renameResult.success) {
      showToast('error', renameResult.error || '重命名失败');
      return;
    }
    updateSnapshotDescription(editingSnapshot.snapshotId, newDesc);
    showToast('success', '已更新快照信息');
    setEditingSnapshot(null);
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
      pendingImportFile.current = content;
      const check = checkImportConflicts(content);
      if (!check.success) {
        showToast('error', `导入失败：${check.error || '未知错误'}`);
        return;
      }
      if (check.hasConflict && check.conflictingNames) {
        setPendingImportData({ json: content, conflictingNames: check.conflictingNames });
      } else {
        const result = importSnapshots(content, 'keep_both');
        if (result.success) {
          const total = result.importedCount || 1;
          showToast('success', `成功导入 ${total} 个快照`);
        } else {
          showToast('error', `导入失败：${result.error || '未知错误'}`);
        }
      }
    };
    reader.onerror = () => {
      showToast('error', '读取文件失败');
    };
    reader.readAsText(file);
  };

  const handleImportOverwrite = () => {
    if (!pendingImportData) return;
    const result = importSnapshots(pendingImportData.json, 'overwrite');
    if (result.success) {
      const total = result.importedCount || 1;
      showToast('success', `已覆盖导入 ${total} 个快照`);
    } else {
      showToast('error', `导入失败：${result.error || '未知错误'}`);
    }
    setPendingImportData(null);
  };

  const handleImportKeepBoth = () => {
    if (!pendingImportData) return;
    const result = importSnapshots(pendingImportData.json, 'keep_both');
    if (result.success) {
      const total = result.importedCount || 1;
      showToast('success', `成功导入 ${total} 个快照（重名已自动改名）`);
    } else {
      showToast('error', `导入失败：${result.error || '未知错误'}`);
    }
    setPendingImportData(null);
  };

  const handleImportCancel = () => {
    setPendingImportData(null);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const toggleSelectAll = () => {
    const allIds = displaySnapshots.map(s => s.snapshotId);
    if (selectedIds.size === allIds.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleBatchDelete = () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedIds.size} 个快照吗？此操作不可撤销。`)) return;
    const result = batchDeleteSnapshots(Array.from(selectedIds));
    showToast('success', `已删除 ${result.deletedCount} 个快照`);
    exitSelectMode();
  };

  const handleBatchExport = () => {
    if (selectedIds.size === 0) return;
    const json = batchExportSnapshots(Array.from(selectedIds));
    if (json) {
      showToast('success', `已导出 ${selectedIds.size} 个快照`);
      exitSelectMode();
    }
  };

  const handleBatchRenameConfirm = (pattern: 'prefix' | 'suffix' | 'replace', value: string) => {
    const result = batchRenameSnapshots(Array.from(selectedIds), pattern, value);
    if (result.success) {
      showToast('success', `已重命名 ${result.updatedCount} 个快照`);
    } else if (result.updatedCount > 0) {
      showToast('success', `部分成功：重命名 ${result.updatedCount} 个，${result.errors?.length || 0} 个失败`);
    } else {
      showToast('error', '批量重命名失败');
    }
    setShowBatchRename(false);
    exitSelectMode();
  };

  const handleBatchDescConfirm = (desc: string, mode: 'replace' | 'append' | 'prepend') => {
    const result = batchUpdateSnapshotsDescription(Array.from(selectedIds), desc, mode);
    showToast('success', `已更新 ${result.updatedCount} 个快照的备注`);
    setShowBatchDesc(false);
    exitSelectMode();
  };

  const reversedLogs = useMemo(() => [...snapshotLogs].reverse(), [snapshotLogs]);

  return (
    <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Camera className="w-5 h-5 text-purple-400" />
          <h3 className="text-slate-200 font-semibold">场景快照</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setTab('snapshots')}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              tab === 'snapshots' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            <span className="flex items-center gap-1">
              <Camera className="w-3 h-3" />
              快照
            </span>
          </button>
          <button
            onClick={() => setTab('logs')}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              tab === 'logs' ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            <span className="flex items-center gap-1">
              <History className="w-3 h-3" />
              日志
              {snapshotLogs.length > 0 && (
                <span className="text-[10px] bg-purple-800/60 px-1 rounded">{snapshotLogs.length}</span>
              )}
            </span>
          </button>
        </div>
      </div>

      {tab === 'snapshots' ? (
        <>
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

          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-700/30">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                placeholder="搜索名称/备注/操作员..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SnapshotSortOrder)}
              className="px-2 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-blue-500"
            >
              <option value="newest_first">最新优先</option>
              <option value="oldest_first">最早优先</option>
              <option value="name_asc">名称 A→Z</option>
              <option value="name_desc">名称 Z→A</option>
            </select>
            <div className="flex items-center gap-1 text-xs">
              <span className="px-2 py-1 bg-purple-900/50 text-purple-300 rounded">
                共 {snapshots.length}
              </span>
              {searchKeyword && displaySnapshots.length !== snapshots.length && (
                <span className="px-2 py-1 bg-blue-900/40 text-blue-300 rounded">
                  匹配 {displaySnapshots.length}
                </span>
              )}
            </div>
          </div>

          {selectMode ? (
            <div className="flex items-center gap-2 mb-2 p-2 bg-blue-900/20 border border-blue-700/40 rounded text-xs">
              <button
                onClick={toggleSelectAll}
                className="flex items-center gap-1 px-2 py-1 bg-blue-700 hover:bg-blue-600 text-blue-100 rounded transition-colors"
              >
                {selectedIds.size === displaySnapshots.length ? (
                  <><CheckSquare className="w-3 h-3" /> 取消全选</>
                ) : (
                  <><Square className="w-3 h-3" /> 全选</>
                )}
              </button>
              <span className="text-blue-200">已选 {selectedIds.size} 个</span>
              <div className="flex-1" />
              <button
                onClick={() => setShowBatchRename(true)}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1 px-2 py-1 bg-purple-700 hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded transition-colors"
                title="批量重命名"
              >
                <Hash className="w-3 h-3" />
                重命名
              </button>
              <button
                onClick={() => setShowBatchDesc(true)}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1 px-2 py-1 bg-teal-700 hover:bg-teal-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded transition-colors"
                title="批量改备注"
              >
                <Edit3 className="w-3 h-3" />
                备注
              </button>
              <button
                onClick={handleBatchExport}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1 px-2 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 rounded transition-colors"
                title="批量导出"
              >
                <Download className="w-3 h-3" />
                导出
              </button>
              <button
                onClick={handleBatchDelete}
                disabled={selectedIds.size === 0}
                className="flex items-center gap-1 px-2 py-1 bg-red-800/60 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed text-red-200 rounded transition-colors"
                title="批量删除"
              >
                <Trash className="w-3 h-3" />
                删除
              </button>
              <button
                onClick={exitSelectMode}
                className="flex items-center gap-1 px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5 text-xs">
                <button
                  onClick={handleImportClick}
                  className="flex items-center gap-1 px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
                  title="从 JSON 导入快照"
                >
                  <Upload className="w-3.5 h-3.5" />
                  导入
                </button>
                <button
                  onClick={() => setSelectMode(true)}
                  className="flex items-center gap-1 px-2 py-1 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded transition-colors"
                  title="批量操作模式"
                >
                  <ListChecks className="w-3.5 h-3.5" />
                  批量
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={handleImportFile}
                />
              </div>
              <ArrowUpDown className="w-3 h-3 text-slate-600" />
            </div>
          )}

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
            {displaySnapshots.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 px-2">
                <Camera className="w-12 h-12 mb-3 opacity-30" />
                <p className="text-sm font-medium text-slate-400 mb-2">
                  {searchKeyword ? '没有匹配的快照' : '还没有保存任何快照'}
                </p>
                <div className="text-[11px] text-center space-y-1 text-slate-500 max-w-[240px]">
                  {!searchKeyword && (
                    <>
                      <p>📌 演练中随时在上方输入名称点「保存」</p>
                      <p>🔄 之后可一键恢复到保存时的完整状态</p>
                      <p>📤 支持单个或批量导出 JSON 给同事导入</p>
                      <p>💾 刷新页面也不会丢失</p>
                    </>
                  )}
                </div>
              </div>
            ) : (
              displaySnapshots.map((snap) => (
                <SnapshotItem
                  key={snap.snapshotId}
                  snapshot={snap}
                  isLatest={snap.snapshotId === latestSnapshotId}
                  isSelected={selectedIds.has(snap.snapshotId)}
                  selectMode={selectMode}
                  onToggleSelect={() => toggleSelect(snap.snapshotId)}
                  onRestore={() => handleRestore(snap)}
                  onExport={() => handleExport(snap)}
                  onDelete={() => handleDelete(snap)}
                  onEdit={() => handleEdit(snap)}
                />
              ))
            )}
          </div>

          {displaySnapshots.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-700">
              <div className="flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
                <FileJson className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <div className="space-y-0.5">
                  <p>• 点击卡片展开查看详情，可「恢复」「编辑」「导出」「删除」</p>
                  <p>• 点击「批量」可选择多个快照进行重命名、改备注、导出、删除</p>
                  <p>• 顶部搜索框支持按名称、备注、操作员关键词筛选</p>
                  <p>• 恢复后可点击蓝色横幅的「撤销恢复」回到之前状态</p>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-700/30">
            <span className="text-xs text-slate-400">
              共 {snapshotLogs.length} 条操作记录（最多保留 500 条）
            </span>
            {snapshotLogs.length > 0 && (
              <button
                onClick={() => {
                  if (confirm('确定要清空所有操作日志吗？')) {
                    clearSnapshotLogs();
                    showToast('success', '已清空操作日志');
                  }
                }}
                className="flex items-center gap-1 px-2 py-1 text-xs bg-red-900/40 hover:bg-red-800/60 text-red-300 rounded transition-colors"
              >
                <Trash className="w-3 h-3" />
                清空
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto border border-slate-700/50 rounded bg-slate-800/30">
            {reversedLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-500 px-2 py-8">
                <History className="w-10 h-10 mb-2 opacity-30" />
                <p className="text-xs text-slate-400">暂无操作记录</p>
                <p className="text-[11px] text-slate-500 mt-1">快照相关的操作会在这里显示</p>
              </div>
            ) : (
              reversedLogs.map(log => <LogItem key={log.logId} log={log} />)
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-slate-700">
            <div className="flex items-start gap-2 text-[11px] text-slate-500 leading-relaxed">
              <History className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <div className="space-y-0.5">
                <p>• 自动记录快照的创建、恢复、导入、导出、删除等操作</p>
                <p>• 包含操作时间、操作员、影响的快照名称等信息</p>
                <p>• 日志同样持久化保存，刷新页面不丢失</p>
              </div>
            </div>
          </div>
        </>
      )}

      {pendingConflict && (
        <ConflictDialog
          name={pendingConflict.name}
          existingSnapshot={pendingConflict}
          onCancel={handleConflictCancel}
          onConfirm={handleConflictConfirm}
        />
      )}

      {pendingImportData && (
        <ImportConflictDialog
          conflictingNames={pendingImportData.conflictingNames}
          onOverwrite={handleImportOverwrite}
          onKeepBoth={handleImportKeepBoth}
          onCancel={handleImportCancel}
        />
      )}

      {editingSnapshot && (
        <RenameDialog
          snapshot={editingSnapshot}
          onCancel={() => setEditingSnapshot(null)}
          onConfirm={handleEditConfirm}
        />
      )}

      {showBatchRename && (
        <BatchRenameDialog
          count={selectedIds.size}
          onCancel={() => setShowBatchRename(false)}
          onConfirm={handleBatchRenameConfirm}
        />
      )}

      {showBatchDesc && (
        <BatchDescDialog
          count={selectedIds.size}
          onCancel={() => setShowBatchDesc(false)}
          onConfirm={handleBatchDescConfirm}
        />
      )}

      {toast && <ResultToast type={toast.type} message={toast.message} onClose={() => setToast(null)} />}
    </div>
  );
}
