import { useState } from 'react';
import { useReplayStore } from '@/store/useReplayStore';
import { Rule, AlarmLevel } from '@/engine/types';
import { validateRuleCondition } from '@/engine/ruleEngine';
import { Settings, Plus, Edit2, Trash2, Save, X, ToggleLeft, ToggleRight, AlertTriangle, Info, AlertCircle } from 'lucide-react';

const LEVEL_OPTIONS: { value: AlarmLevel; label: string; color: string }[] = [
  { value: 'critical', label: '严重', color: 'bg-red-500' },
  { value: 'warning', label: '重要', color: 'bg-orange-500' },
  { value: 'info', label: '一般', color: 'bg-blue-500' },
];

interface RuleFormProps {
  rule?: Rule;
  onSave: (data: Omit<Rule, 'ruleId' | 'createdAt'>) => void;
  onCancel: () => void;
}

function RuleForm({ rule, onSave, onCancel }: RuleFormProps) {
  const [name, setName] = useState(rule?.name || '');
  const [version, setVersion] = useState(rule?.version || 'v1.0');
  const [condition, setCondition] = useState(rule?.condition || '');
  const [level, setLevel] = useState<AlarmLevel>(rule?.level || 'warning');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [validation, setValidation] = useState<{ valid: boolean; error?: string } | null>(null);

  const handleValidate = () => {
    const result = validateRuleCondition(condition);
    setValidation(result);
    return result.valid;
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      setValidation({ valid: false, error: '请输入规则名称' });
      return;
    }
    if (!condition.trim()) {
      setValidation({ valid: false, error: '请输入匹配条件' });
      return;
    }
    if (!handleValidate()) return;
    
    onSave({ name, version, condition, level, enabled });
  };

  return (
    <div className="p-4 bg-slate-800 rounded-lg border border-slate-600">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-slate-200 font-medium">{rule ? '编辑规则' : '新建规则'}</h4>
        <button onClick={onCancel} className="text-slate-400 hover:text-white">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">规则名称</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：CPU使用率告警"
            className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-sm text-slate-300 placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">版本</label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="v1.0"
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-sm text-slate-300 placeholder-slate-500 focus:outline-none focus:border-purple-500"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">告警级别</label>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as AlarmLevel)}
              className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-sm text-slate-300 focus:outline-none focus:border-purple-500"
            >
              {LEVEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">匹配条件 (JavaScript 表达式)</label>
          <textarea
            value={condition}
            onChange={(e) => {
              setCondition(e.target.value);
              setValidation(null);
            }}
            placeholder="例如: source === 'cpu-monitor' && type === 'alert' && payload.cpuUsage > 80"
            rows={3}
            className="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded text-sm text-slate-300 placeholder-slate-500 focus:outline-none focus:border-purple-500 font-mono resize-none"
          />
          <div className="mt-1 text-xs text-slate-500">
            可用变量: event (包含 eventId, timestamp, type, source, title, payload, correlationId)
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setEnabled(!enabled)}
            className="text-slate-400 hover:text-white"
          >
            {enabled ? (
            <ToggleRight className="w-6 h-6 text-green-500" />
          ) : (
            <ToggleLeft className="w-6 h-6 text-slate-500" />
          )}
          </button>
          <span className="text-sm text-slate-300">{enabled ? '已启用' : '已禁用'}</span>
        </div>

        {validation && !validation.valid && (
          <div className="p-2 bg-red-900/30 border border-red-700 rounded text-xs text-red-400 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{validation.error}</span>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleValidate}
            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded transition-colors"
          >
            <AlertTriangle className="w-4 h-4" />
            验证条件
          </button>
          <button
            onClick={handleSubmit}
            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded transition-colors"
          >
            <Save className="w-4 h-4" />
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

interface RuleCardProps {
  rule: Rule;
  onEdit: (rule: Rule) => void;
  onDelete: (ruleId: string) => void;
  onToggle: (ruleId: string) => void;
}

function RuleCard({ rule, onEdit, onDelete, onToggle }: RuleCardProps) {
  const levelInfo = LEVEL_OPTIONS.find((l) => l.value === rule.level);

  return (
    <div className="p-3 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-500 transition-colors">
      <div className="flex items-start gap-3">
        <div className={`p-2 rounded ${levelInfo?.color || 'bg-slate-600'}`}>
          {rule.level === 'critical' && <AlertCircle className="w-5 h-5 text-white" />}
          {rule.level === 'warning' && <AlertTriangle className="w-5 h-5 text-white" />}
          {rule.level === 'info' && <Info className="w-5 h-5 text-white" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-slate-200 font-medium">{rule.name}</span>
            <span className="text-xs text-slate-500 font-mono">{rule.version}</span>
            <span
              className={`px-1.5 py-0.5 text-xs rounded text-white ${levelInfo?.color}`}
            >
              {levelInfo?.label}
            </span>
          </div>
          <div className="text-xs text-slate-400 font-mono bg-slate-900 rounded px-2 py-1 truncate">
            {rule.condition}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => onToggle(rule.ruleId)}
            className="p-1 hover:bg-slate-700 rounded"
            title={rule.enabled ? '禁用' : '启用'}
          >
            {rule.enabled ? (
              <ToggleRight className="w-5 h-5 text-green-500" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-slate-500" />
            )}
          </button>
          <button
            onClick={() => onEdit(rule)}
            className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white"
            title="编辑"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(rule.ruleId)}
            className="p-1 hover:bg-red-900/50 rounded text-slate-400 hover:text-red-400"
            title="删除"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function RuleEditor() {
  const { rules, addRule, updateRule, deleteRule, toggleRule } = useReplayStore();
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);

  const handleSave = (data: Omit<Rule, 'ruleId' | 'createdAt'>) => {
    if (editingRule) {
      updateRule(editingRule.ruleId, data);
    } else {
      addRule(data);
    }
    setShowForm(false);
    setEditingRule(null);
  };

  const handleEdit = (rule: Rule) => {
    setEditingRule(rule);
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingRule(null);
  };

  return (
    <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Settings className="w-5 h-5 text-cyan-400" />
          <h3 className="text-slate-200 font-semibold">告警规则</h3>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded transition-colors"
        >
          <Plus className="w-4 h-4" />
          新建
        </button>
      </div>

      {showForm && (
        <div className="mb-4">
          <RuleForm
            rule={editingRule || undefined}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-2 pr-1">
        {rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-500">
            <Settings className="w-12 h-12 mb-2 opacity-30" />
            <p className="text-sm">暂无告警规则</p>
          </div>
        ) : (
          rules.map((rule) => (
            <RuleCard
              key={rule.ruleId}
              rule={rule}
              onEdit={handleEdit}
              onDelete={deleteRule}
              onToggle={toggleRule}
            />
          ))
        )}
      </div>
    </div>
  );
}
