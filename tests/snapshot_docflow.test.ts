// 快照功能 - 严格按说明文档步骤复现的回归测试
// 复现 README.md "6. 场景快照使用说明" 中的完整操作链路
// 使用: npx tsx tests/snapshot_docflow.test.ts
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */

const storage: Record<string, string> = {};
(global as any).localStorage = {
  getItem: (k: string) => (k in storage ? storage[k] : null),
  setItem: (k: string, v: string) => { storage[k] = v; },
  removeItem: (k: string) => { delete storage[k]; },
  clear: () => { for (const k of Object.keys(storage)) delete storage[k]; },
  length: 0,
  key: () => null,
};

(global as any).URL = {
  createObjectURL: () => 'mock://blob-url',
  revokeObjectURL: () => {},
};
(global as any).Blob = function(_data: any, _opts: any) { this.data = _data; };
(global as any).document = {
  createElement: () => ({ href: '', download: '', click: () => {} }),
  body: { appendChild: () => {}, removeChild: () => {} },
};

const confirmCalls: boolean[] = [];
(global as any).confirm = (_msg: string) => confirmCalls.shift() ?? true;

(global as any).React = {};

import { useReplayStore } from '../src/store/useReplayStore';

let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✅ PASS: ${name}`);
  } catch (e) {
    failed++;
    const msg = `❌ FAIL: ${name}\n   ${(e as Error).message}`;
    errors.push(msg);
    console.error(msg);
  }
}

function assertEq<T>(actual: T, expected: T, msg = '') {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}\n   期望: ${b}\n   实际: ${a}`);
}
function assert(cond: boolean, msg = '') { if (!cond) throw new Error(msg || '断言失败'); }
function capture() {
  const s = useReplayStore.getState();
  return {
    snapLen: s.snapshots.length,
    cursor: s.cursor,
    eventsLen: s.events.length,
    confsLen: s.confirmations.length,
    alarmsLen: s.activeAlarms.length,
    notes: s.operatorNotes,
    preRestore: !!s.preRestoreSnapshot,
  };
}

// ============================================================
// 模拟用户 UI 操作（严格对应 SnapshotPanel 中的真实交互）
// ============================================================

function ui_save(name: string, desc: string = '') {
  const store = useReplayStore.getState();
  if (!name.trim()) return { kind: 'toast-error', msg: '快照名称不能为空' };
  const conflict = store.checkSnapshotConflict(name.trim());
  if (conflict.hasConflict && conflict.existingSnapshot) {
    return { kind: 'show-conflict-dialog', existing: conflict.existingSnapshot, pendingName: name.trim(), pendingDesc: desc.trim() };
  }
  const r = store.saveSnapshot(name, desc);
  return r.success ? { kind: 'toast-success', msg: `已保存快照 "${r.snapshot?.name}"`, snapshot: r.snapshot } : { kind: 'toast-error', msg: r.error || '保存失败' };
}

function ui_cancelConflict() {
  return { kind: 'dialog-closed' };
}

function ui_confirmOverwrite(pendingName: string, pendingDesc: string) {
  const store = useReplayStore.getState();
  const r = store.saveSnapshot(pendingName, pendingDesc, true);
  return r.success ? { kind: 'toast-success', msg: `已覆盖快照 "${pendingName}"` } : { kind: 'toast-error', msg: r.error || '覆盖失败' };
}

function ui_restore(snapId: string) {
  const store = useReplayStore.getState();
  const snap = store.snapshots.find(s => s.snapshotId === snapId);
  const ok = store.restoreSnapshot(snapId);
  return ok && snap ? { kind: 'toast-success', msg: `已恢复至 "${snap.name}"`, showUndoBanner: true } : { kind: 'toast-error', msg: '恢复失败' };
}

function ui_undoRestore() {
  const store = useReplayStore.getState();
  const ok = store.undoRestoreSnapshot();
  return ok ? { kind: 'toast-success', msg: '已撤销恢复，回到恢复前的状态', showUndoBanner: false } : { kind: 'toast-error', msg: '没有可撤销的恢复操作' };
}

function ui_export(snapId: string) {
  const store = useReplayStore.getState();
  const json = store.exportSnapshot(snapId);
  const snap = store.snapshots.find(s => s.snapshotId === snapId);
  return json && snap ? { kind: 'download', json, filename: `snapshot-${snap.name}-${Date.now()}.json` } : { kind: 'toast-error', msg: '导出失败' };
}

type ImportStrategy = 'keep_both' | 'overwrite' | 'auto';

function ui_import(json: string, strategy: ImportStrategy = 'auto') {
  const store = useReplayStore.getState();
  const check = store.checkImportConflicts(json);
  if (!check.success) {
    return { kind: 'toast-error', msg: `导入失败：${check.error || '未知错误'}` };
  }
  if (check.hasConflict && check.conflictingNames && strategy === 'auto') {
    return {
      kind: 'show-import-conflict-dialog',
      conflictingNames: check.conflictingNames,
      pendingJson: json,
    };
  }
  const actualStrategy = strategy === 'auto' ? 'keep_both' : strategy;
  const r = store.importSnapshots(json, actualStrategy);
  if (!r.success) {
    return { kind: 'toast-error', msg: `导入失败：${r.error || '未知错误'}` };
  }
  const names = (r.snapshots || []).map(s => s.name);
  let msg = '';
  if (actualStrategy === 'overwrite') {
    const overwritten = r.overwrittenNames || [];
    if (overwritten.length > 0) {
      msg = `导入完成：已覆盖 ${overwritten.length} 个同名快照（${overwritten.join('、')}），共导入 ${names.length} 个`;
    } else {
      msg = `成功导入 ${names.length} 个快照：${names.join('、')}`;
    }
  } else {
    const renamed = r.renamedMap || {};
    const renamedEntries = Object.entries(renamed);
    if (renamedEntries.length > 0) {
      const detail = renamedEntries.map(([orig, newName]) => `"${orig}" 改名为 "${newName}"`).join('；');
      msg = `导入完成（保留两份）：共 ${names.length} 个，其中 ${renamedEntries.length} 个同名已重命名 — ${detail}`;
    } else {
      msg = `成功导入 ${names.length} 个快照：${names.join('、')}`;
    }
  }
  return {
    kind: 'toast-success',
    msg,
    snapshots: r.snapshots,
    snapshot: r.snapshot,
    renamedMap: r.renamedMap,
    overwrittenNames: r.overwrittenNames,
    importedCount: r.importedCount,
  };
}

function ui_delete(snapId: string, userConfirm: boolean) {
  confirmCalls.push(userConfirm);
  const store = useReplayStore.getState();
  const snap = store.snapshots.find(s => s.snapshotId === snapId);
  if (!userConfirm) return { kind: 'cancelled' };
  const ok = store.deleteSnapshot(snapId);
  return ok && snap ? { kind: 'toast-success', msg: `已删除快照 "${snap.name}"` } : { kind: 'toast-error', msg: '删除失败' };
}

// ============================================================
// 复现 README 6.2 新建命名快照
// ============================================================
test('Doc-6.2 新建命名快照 - 按说明步骤操作', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  // 步骤：推进到需要保存的状态
  for (let i = 0; i < 4; i++) s.stepForward();
  s.setOperatorNotes('已确认前3个告警，待交接');

  // 按说明：输入名称 + 描述 + 点保存
  const name = '待交接给夜班';
  const desc = '已确认3个告警，还有2个待处理';
  const res = ui_save(name, desc);

  // 预期结果
  assertEq(res.kind, 'toast-success', 'Toast 成功提示');
  assert(res.msg.includes(name), `Toast 含名称: ${res.msg}`);
  const state = useReplayStore.getState();
  assertEq(state.snapshots.length, 1, '列表有1条');
  assertEq(state.snapshots[0].name, name, '名称正确');
  assertEq(state.snapshots[0].description, desc, '描述正确');
  assertEq(state.snapshots[0].operatorNotes, '已确认前3个告警，待交接', '备注正确');
  // 最新的在最上面
  assertEq(state.snapshots[0].snapshotId, [...state.snapshots].sort((a,b)=>b.createdAt-a.createdAt)[0].snapshotId, '最新的在最上面');
});

// ============================================================
// 复现 README 6.3 同名覆盖：取消分支
// ============================================================
test('Doc-6.3 同名覆盖 - 分支A 取消覆盖，原快照不受影响', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  // 先建一个
  const r1 = ui_save('节点1', '原始描述');
  assertEq(r1.kind, 'toast-success');
  const snap = (r1 as any).snapshot;
  const originalId = snap.snapshotId;
  const originalCursor = snap.cursor;

  // 推进
  for (let i = 0; i < 5; i++) s.stepForward();
  const newCursor = useReplayStore.getState().cursor;
  assert(newCursor > originalCursor, '游标已推进');

  // 按说明：同名保存 -> 弹冲突对话框 -> 点取消
  const res = ui_save('节点1', '新描述');
  assertEq(res.kind, 'show-conflict-dialog', '弹出冲突对话框');
  assertEq((res as any).existing.snapshotId, originalId, '对话框显示正确的已有快照');

  // 点取消
  const cancelRes = ui_cancelConflict();
  assertEq(cancelRes.kind, 'dialog-closed', '对话框关闭');

  // 验证：原快照完全不受影响
  const state = useReplayStore.getState();
  assertEq(state.snapshots.length, 1, '快照数量不变，未新增');
  const stillThere = state.snapshots.find(x => x.snapshotId === originalId);
  assert(!!stillThere, '原快照ID还在');
  assertEq(stillThere!.cursor, originalCursor, '原快照游标未变，没被覆盖');
  assertEq(stillThere!.description, '原始描述', '原快照描述未变');
});

// ============================================================
// 复现 README 6.3 同名覆盖：确认覆盖分支
// ============================================================
test('Doc-6.3 同名覆盖 - 分支B 确认覆盖，原ID保留内容更新', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  const r1 = ui_save('节点1', '原始描述');
  const originalId = (r1 as any).snapshot.snapshotId;
  const originalCursor = (r1 as any).snapshot.cursor;

  for (let i = 0; i < 6; i++) s.stepForward();
  const newCursor = useReplayStore.getState().cursor;

  // 同名保存 -> 冲突 -> 确认覆盖
  const res = ui_save('节点1', '已覆盖，推进到事件6');
  assertEq(res.kind, 'show-conflict-dialog');

  const overwriteRes = ui_confirmOverwrite((res as any).pendingName, (res as any).pendingDesc);
  assertEq(overwriteRes.kind, 'toast-success');
  assert(overwriteRes.msg.includes('已覆盖'), '提示已覆盖');

  // 验证：ID 不变，内容更新
  const state = useReplayStore.getState();
  assertEq(state.snapshots.length, 1, '数量不变');
  const updated = state.snapshots[0];
  assertEq(updated.snapshotId, originalId, '原ID保留');
  assertEq(updated.cursor, newCursor, '游标更新为新状态');
  assertEq(updated.description, '已覆盖，推进到事件6', '描述更新');
  assert(updated.cursor > originalCursor, '游标确实更新了');
});

// ============================================================
// 复现 README 6.4/6.5 恢复 + 撤销恢复
// ============================================================
test('Doc-6.4+6.5 恢复快照 + 撤销恢复（后悔药）', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  // 保存节点A
  for (let i = 0; i < 3; i++) s.stepForward();
  const alarm1 = useReplayStore.getState().activeAlarms.find(a => a.status === 'active');
  if (alarm1) s.confirmAlarm(alarm1.alarmId, '节点A确认');
  s.setOperatorNotes('节点A备注');
  const rA = ui_save('节点A');
  assertEq(rA.kind, 'toast-success');
  const snapAId = (rA as any).snapshot.snapshotId;
  const stateA = capture();

  // 推进到节点B
  for (let i = 0; i < 6; i++) s.stepForward();
  const alarm2 = useReplayStore.getState().activeAlarms.find(a => a.status === 'active');
  if (alarm2) s.confirmAlarm(alarm2.alarmId, '节点B确认');
  s.setOperatorNotes('节点B备注');
  const stateBeforeRestore = capture();
  assert(stateBeforeRestore.cursor > stateA.cursor, '节点B比A推进');
  assert(stateBeforeRestore.confsLen > stateA.confsLen, '节点B确认更多');

  // 按说明：点恢复
  const restoreRes = ui_restore(snapAId);
  assertEq(restoreRes.kind, 'toast-success');
  assert(restoreRes.msg.includes('已恢复至'), '提示恢复至');
  assertEq(restoreRes.showUndoBanner, true, '显示撤销横幅');

  const afterRestore = capture();
  assertEq(afterRestore.cursor, stateA.cursor, '游标回到A');
  assertEq(afterRestore.confsLen, stateA.confsLen, '确认数回到A');
  assertEq(afterRestore.notes, stateA.notes, '备注回到A');
  assertEq(afterRestore.preRestore, true, 'preRestore存在');

  // 按说明：点撤销恢复
  const undoRes = ui_undoRestore();
  assertEq(undoRes.kind, 'toast-success');
  assert(undoRes.msg.includes('已撤销恢复'), '提示已撤销');
  assertEq(undoRes.showUndoBanner, false, '横幅消失');

  const afterUndo = capture();
  assertEq(afterUndo.cursor, stateBeforeRestore.cursor, '游标回到B');
  assertEq(afterUndo.confsLen, stateBeforeRestore.confsLen, '确认数回到B');
  assertEq(afterUndo.notes, stateBeforeRestore.notes, '备注回到B');
  assertEq(afterUndo.preRestore, false, 'preRestore清空');

  // 再次点撤销 - 失败
  const undoAgain = ui_undoRestore();
  assertEq(undoAgain.kind, 'toast-error');
  assert(undoAgain.msg.includes('没有可撤销'), '提示无可撤销');
});

// ============================================================
// 复现 README 6.6 导出备份 & 导入恢复
// ============================================================
test('Doc-6.6 导出备份 + 导入恢复，同名自动加后缀', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 3; i++) s.stepForward();
  s.setOperatorNotes('导出测试备注');
  const r = ui_save('导出导入节点', '交接给同事');
  assertEq(r.kind, 'toast-success');
  const snapId = (r as any).snapshot.snapshotId;
  const origSnap = useReplayStore.getState().snapshots.find(x => x.snapshotId === snapId)!;

  // 按说明：点导出
  const exportRes = ui_export(snapId);
  assertEq(exportRes.kind, 'download', '触发下载');
  assert(exportRes.filename.startsWith('snapshot-导出导入节点'), '文件名正确');
  const json = (exportRes as any).json;
  assert(json.includes('schemaVersion'), '含schema版本');
  assert(json.includes('"cursor":'), '含游标');

  // 按说明：点导入（选刚才的文件）
  const beforeCount = useReplayStore.getState().snapshots.length;
  // 由于同名冲突，auto 策略会先弹冲突对话框
  const conflictRes = ui_import(json, 'auto');
  assertEq(conflictRes.kind, 'show-import-conflict-dialog', '同名触发冲突对话框');
  assert((conflictRes as any).conflictingNames.includes('导出导入节点'), '冲突列表包含原名称');

  // 选择「保留两份」继续导入
  const importRes = ui_import(json, 'keep_both');
  assertEq(importRes.kind, 'toast-success', '导入成功');
  assert(importRes.msg.includes('保留两份'), '提示含"保留两份"');
  assert(importRes.msg.includes('改名为'), '提示含重命名详情');
  const imported = (importRes as any).snapshot;
  assert(imported.name !== origSnap.name, '同名自动改名');
  assert(imported.name.includes('导出导入节点'), '保留原名');
  assert(imported.name.includes('(导入 '), '标记导入');
  // 新格式：YYYYMMDD_HHmmss_SSS (含毫秒)
  assert(/\(导入 \d{8}_\d{6}_\d{3}\)/.test(imported.name) || /\(导入 \d{8}_\d{6}\)/.test(imported.name), '导入时间戳格式正确');
  assertEq(useReplayStore.getState().snapshots.length, beforeCount + 1, '数量+1');

  // 验证 renamedMap 一致性：提示文案、列表、落盘名称三者一致
  const renamedMap = (importRes as any).renamedMap || {};
  assertEq(renamedMap['导出导入节点'], imported.name, 'renamedMap 中记录的新名称与实际落盘一致');
  assert(importRes.msg.includes(imported.name), '成功提示中的新名称与实际落盘一致');
  const inList = useReplayStore.getState().snapshots.find(s => s.snapshotId === imported.snapshotId);
  assertEq(inList?.name, imported.name, '列表展示的名称与实际落盘一致');

  // 内容一致
  assertEq(imported.cursor, origSnap.cursor, '游标一致');
  assertEq(imported.events.length, origSnap.events.length, '事件数一致');
  assertEq(imported.confirmations.length, origSnap.confirmations.length, '确认数一致');
  assertEq(imported.operatorNotes, origSnap.operatorNotes, '备注一致');
  assertEq(imported.rules.length, origSnap.rules.length, '规则数一致');
});

// ============================================================
// 复现 README 6.6 异常导入不污染
// ============================================================
test('Doc-6.6 异常导入保护 - 损坏/不兼容文件零污染', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 2; i++) s.stepForward();
  ui_save('基准快照');
  const base = capture();
  assertEq(base.snapLen, 1);

  const badCases = [
    ['完全不是JSON', '{{not json}}'],
    ['schema版本 v99 不兼容', JSON.stringify({ schemaVersion: 99, snapshot: {} })],
    ['snapshot字段缺失', JSON.stringify({ schemaVersion: 1 })],
    ['必填字段不全', JSON.stringify({ schemaVersion: 1, snapshot: { name: 'x' } })],
    ['events空数组', JSON.stringify({
      schemaVersion: 1,
      snapshot: {
        snapshotId:'x', name:'x', createdAt:1, cursor:1, currentEventIndex:0,
        events:[], activeAlarms:[], processedEvents:[], pendingEvents:[],
        confirmations:[], rules:[], operator:'x', startTime:0, endTime:100,
      },
    })],
  ];

  for (const [caseName, data] of badCases) {
    const res = ui_import(data);
    assertEq(res.kind, 'toast-error', `${caseName} -> 错误`);
    assert(!!res.msg, `${caseName} -> 有错误信息`);
    const after = capture();
    assertEq(after, base, `${caseName} -> 零污染：状态完全不变`);
  }
});

// ============================================================
// 复现 README 6.7 刷新/重启后保留
// ============================================================
test('Doc-6.7 刷新或重启后，快照列表和内容完整保留', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  // 建两个快照
  for (let i = 0; i < 3; i++) s.stepForward();
  ui_save('刷新测试1', 'A点');
  for (let i = 0; i < 3; i++) s.stepForward();
  ui_save('刷新测试2', 'B点');

  const stateBefore = useReplayStore.getState();
  assertEq(stateBefore.snapshots.length, 2, '建了2个');
  const snap1Cursor = stateBefore.snapshots.find(x => x.name === '刷新测试1')!.cursor;
  const snap2Cursor = stateBefore.snapshots.find(x => x.name === '刷新测试2')!.cursor;
  assert(snap2Cursor > snap1Cursor, 'B在A之后');

  // 按说明：刷新前状态会自动持久化
  s.saveSession();
  const savedSnapStr = localStorage.getItem('replay:snapshots');
  assert(savedSnapStr, 'localStorage有快照数据');
  const savedArr = JSON.parse(savedSnapStr);
  assertEq(savedArr.length, 2, '持久化了2个');

  // 模拟刷新：清内存 + 清 localStorage（clearSession）+ 还原 localStorage
  const backup: Record<string, string | null> = {};
  ['replay:session', 'replay:events', 'replay:rules', 'replay:lastExport', 'replay:snapshots'].forEach(k => {
    backup[k] = localStorage.getItem(k);
  });
  s.clearSession();
  assertEq(useReplayStore.getState().snapshots.length, 0, '刷新后内存清空');

  Object.entries(backup).forEach(([k, v]) => { if (v !== null) localStorage.setItem(k, v); });
  s.loadSession(); // 页面启动时调用

  // 按预期结果验证
  const after = useReplayStore.getState();
  assertEq(after.snapshots.length, 2, '从持久化恢复出2个');
  const s1 = after.snapshots.find(x => x.name === '刷新测试1');
  const s2 = after.snapshots.find(x => x.name === '刷新测试2');
  assert(!!s1 && !!s2, '两个都在');
  assertEq(s1!.cursor, snap1Cursor, '1游标正确');
  assertEq(s2!.cursor, snap2Cursor, '2游标正确');
  assertEq(s1!.description, 'A点', '描述A正确');
  assertEq(s2!.description, 'B点', '描述B正确');

  // 能正常恢复
  const ok = s.restoreSnapshot(s1!.snapshotId);
  assert(ok, '刷新后可正常恢复');
  assertEq(useReplayStore.getState().cursor, snap1Cursor, '恢复后游标正确');
});

// ============================================================
// 复现完整流程：按 README 顺序从头到尾走一遍
// ============================================================
test('Doc-完整流程 按README顺序：新建->同名取消->同名覆盖->恢复->撤销->导出->导入->刷新保留', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  // 6.2 新建
  for (let i = 0; i < 3; i++) s.stepForward();
  let r = ui_save('第1步', '推进3个事件');
  assertEq(r.kind, 'toast-success');
  const step1Id = (r as any).snapshot.snapshotId;
  const step1Cursor = (r as any).snapshot.cursor;

  // 6.3 同名取消
  for (let i = 0; i < 2; i++) s.stepForward();
  r = ui_save('第1步');
  assertEq(r.kind, 'show-conflict-dialog');
  ui_cancelConflict();
  assertEq(useReplayStore.getState().snapshots.length, 1, '取消后数量不变');
  assertEq(useReplayStore.getState().snapshots[0].cursor, step1Cursor, '原快照没被改');

  // 6.3 同名覆盖
  r = ui_save('第1步', '已覆盖，推进5个事件');
  assertEq(r.kind, 'show-conflict-dialog');
  ui_confirmOverwrite((r as any).pendingName, (r as any).pendingDesc);
  assertEq(useReplayStore.getState().snapshots.length, 1, '覆盖后数量不变');
  const updated = useReplayStore.getState().snapshots.find(x => x.snapshotId === step1Id)!;
  assert(updated.cursor > step1Cursor, '覆盖后游标已更新');
  assertEq(updated.description, '已覆盖，推进5个事件', '描述更新');

  // 6.2 再建一个
  for (let i = 0; i < 4; i++) s.stepForward();
  r = ui_save('第2步');
  assertEq(r.kind, 'toast-success');
  const step2Id = (r as any).snapshot.snapshotId;
  assertEq(useReplayStore.getState().snapshots.length, 2);

  // 6.4 恢复
  const stBefore = capture();
  ui_restore(step1Id);
  assertEq(useReplayStore.getState().cursor, updated.cursor, '恢复到覆盖后的第1步');

  // 6.5 撤销
  ui_undoRestore();
  assertEq(capture().cursor, stBefore.cursor, '撤销后回到恢复前');

  // 6.6 导出
  const ex = ui_export(step2Id);
  assertEq(ex.kind, 'download');

  // 6.6 导入
  const before = useReplayStore.getState().snapshots.length;
  // 同名冲突：先弹对话框，再选择保留两份
  const conflictCheck = ui_import((ex as any).json, 'auto');
  if (conflictCheck.kind === 'show-import-conflict-dialog') {
    ui_import((ex as any).json, 'keep_both');
  } else {
    // 无冲突，直接导入
  }
  assertEq(useReplayStore.getState().snapshots.length, before + 1, '导入后+1');

  // 6.7 刷新保留
  s.saveSession();
  const backup: Record<string, string | null> = {};
  ['replay:session', 'replay:events', 'replay:rules', 'replay:lastExport', 'replay:snapshots'].forEach(k => {
    backup[k] = localStorage.getItem(k);
  });
  s.clearSession();
  Object.entries(backup).forEach(([k, v]) => { if (v !== null) localStorage.setItem(k, v); });
  s.loadSession();

  const final = useReplayStore.getState();
  assertEq(final.snapshots.length, before + 1, '刷新后快照数量正确');

  console.log('  📋 按文档流程完成后的快照列表:');
  final.snapshots.forEach(snap => {
    console.log(`     - ${snap.name} (cursor=${snap.cursor}, desc=${snap.description || '(无)'})`);
  });
});

// ============================================================
// 新增链路测试 - 覆盖原条目导入
// ============================================================
test('链路-同名导入：选择覆盖原条目，ID不变内容更新', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 3; i++) s.stepForward();
  const r1 = ui_save('覆盖测试', '原始内容，游标3');
  assertEq(r1.kind, 'toast-success');
  const origId = (r1 as any).snapshot.snapshotId;
  const origCursor = (r1 as any).snapshot.cursor;

  for (let i = 0; i < 5; i++) s.stepForward();
  const newCursor = useReplayStore.getState().cursor;
  assert(newCursor > origCursor, '游标已推进');

  const json = s.exportSnapshot(origId);
  const exportedData = JSON.parse(json);
  exportedData.snapshot.cursor = newCursor;
  exportedData.snapshot.currentEventIndex = useReplayStore.getState().currentEventIndex;
  exportedData.snapshot.description = '覆盖后的新描述';
  const modifiedJson = JSON.stringify(exportedData);

  const conflictRes = ui_import(modifiedJson, 'auto');
  assertEq(conflictRes.kind, 'show-import-conflict-dialog');

  const importRes = ui_import(modifiedJson, 'overwrite');
  assertEq(importRes.kind, 'toast-success');
  assert(importRes.msg.includes('已覆盖'), '提示含"已覆盖"');
  assert((importRes as any).overwrittenNames?.includes('覆盖测试'), 'overwrittenNames 记录正确');

  const after = useReplayStore.getState().snapshots;
  assertEq(after.length, 1, '数量不变');
  assertEq(after[0].snapshotId, origId, 'ID保持不变');
  assertEq(after[0].cursor, newCursor, '游标已更新为导入内容');
  assertEq(after[0].description, '覆盖后的新描述', '描述已更新');

  const logs = useReplayStore.getState().snapshotLogs;
  const importLog = [...logs].reverse().find(l => l.action === 'import');
  assert(importLog, '有导入操作日志');
  assert(importLog!.detail?.includes('覆盖模式'), '日志记录覆盖模式');
  assert(importLog!.detail?.includes('覆盖:覆盖测试'), '日志记录了被覆盖的名称');
});

// ============================================================
// 新增链路测试 - 导出后再导回（循环一致性）
// ============================================================
test('链路-导出后再导回：往返内容完整一致', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 4; i++) s.stepForward();
  const alarm = s.activeAlarms.find(a => a.status === 'active');
  if (alarm) s.confirmAlarm(alarm.alarmId, '往返测试确认');
  s.setOperatorNotes('往返测试备注');
  const r = ui_save('往返节点', '导出再导回验证');
  assertEq(r.kind, 'toast-success');
  const origSnap = (r as any).snapshot;

  const json1 = s.exportSnapshot(origSnap.snapshotId);
  // 先导入一次（改名）
  const imp1 = ui_import(json1, 'keep_both');
  assertEq(imp1.kind, 'toast-success');
  const snap1 = (imp1 as any).snapshot;

  // 再把改名后的导出来
  const json2 = s.exportSnapshot(snap1.snapshotId);
  // 再导入一次（又一次改名）
  const imp2 = ui_import(json2, 'keep_both');
  assertEq(imp2.kind, 'toast-success');
  const snap2 = (imp2 as any).snapshot;

  // 验证三次内容完全一致（除snapshotId、name、createdAt外）
  const stripped = (o: any) => {
    const c = { ...o };
    delete c.snapshotId;
    delete c.name;
    delete c.createdAt;
    return JSON.stringify(c);
  };
  assertEq(stripped(snap2), stripped(origSnap), '两次导回后内容与原始一致');
  assertEq(snap2.cursor, origSnap.cursor, '游标一致');
  assertEq(snap2.confirmations.length, origSnap.confirmations.length, '确认数一致');
  assertEq(snap2.operatorNotes, origSnap.operatorNotes, '备注一致');
  assertEq(snap2.events.length, origSnap.events.length, '事件数一致');

  // 列表数量：原始 + 两次导入 = 3
  assertEq(useReplayStore.getState().snapshots.length, 3, '共3条快照');
});

// ============================================================
// 新增链路测试 - 批量导入混合同名冲突
// ============================================================
test('链路-批量导入混合同名冲突：部分同名+部分新名称', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 2; i++) s.stepForward();
  ui_save('同名A', '本地版本');
  const localCursorA = s.cursor;
  for (let i = 0; i < 2; i++) s.stepForward();
  ui_save('同名B', '本地版本');
  const localCursorB = s.cursor;

  // 直接构造批量导入数据，不通过 store，避免触发同名冲突

  const batchData = {
    schemaVersion: 1,
    exportTime: Date.now(),
    exportedBy: '测试员',
    count: 3,
    snapshots: [],
  };

  for (let i = 0; i < 3; i++) s.stepForward();
  const importCursorA = s.cursor;
  for (let i = 0; i < 2; i++) s.stepForward();
  const importCursorB = s.cursor;
  for (let i = 0; i < 2; i++) s.stepForward();
  const importCursorC = s.cursor;

  // 直接构造3个snapshot对象
  const baseSnap: any = (snapName: string, desc: string, cursor: number) => ({
    snapshotId: 'batch-import-' + snapName,
    name: snapName,
    description: desc,
    createdAt: Date.now() + Math.random(),
    cursor,
    currentEventIndex: s.currentEventIndex,
    events: JSON.parse(JSON.stringify(s.events)),
    activeAlarms: JSON.parse(JSON.stringify(s.activeAlarms)),
    processedEvents: JSON.parse(JSON.stringify(s.processedEvents)),
    pendingEvents: JSON.parse(JSON.stringify(s.pendingEvents)),
    confirmations: JSON.parse(JSON.stringify(s.confirmations)),
    rules: JSON.parse(JSON.stringify(s.rules)),
    operator: s.operator,
    operatorNotes: s.operatorNotes,
    startTime: s.startTime,
    endTime: s.endTime,
  });

  batchData.snapshots.push(baseSnap('同名A', '导入版本A', importCursorA));
  batchData.snapshots.push(baseSnap('同名B', '导入版本B', importCursorB));
  batchData.snapshots.push(baseSnap('新名称C', '导入版本C', importCursorC));

  const batchJson = JSON.stringify(batchData);

  // 保留两份模式
  const keepRes = ui_import(batchJson, 'keep_both');
  assertEq(keepRes.kind, 'toast-success');
  assertEq((keepRes as any).importedCount, 3, '导入3个');
  const renamed = (keepRes as any).renamedMap || {};
  assert(renamed['同名A'], '同名A被重命名');
  assert(renamed['同名B'], '同名B被重命名');
  assert(!renamed['新名称C'], '新名称C未被重命名');

  const allSnaps = useReplayStore.getState().snapshots;
  assertEq(allSnaps.length, 5, '本地2 + 导入3 = 5条');

  // 同名A 应该有 2 条（本地 + 导入改名）
  const aCount = allSnaps.filter(x => x.name.includes('同名A')).length;
  assertEq(aCount, 2, '同名A出现2次');
  const cCount = allSnaps.filter(x => x.name === '新名称C').length;
  assertEq(cCount, 1, '新名称C只有1次（未改名）');

  // 验证操作日志
  const logs = useReplayStore.getState().snapshotLogs;
  const impLog = [...logs].reverse().find(l => l.action === 'import');
  assert(impLog!.snapshotNames.length === 3, '日志记录3个导入快照名');
  assert(impLog!.detail?.includes('保留两份模式'), '日志记录保留两份模式');
  assert(impLog!.detail?.includes('同名A→'), '日志记录同名A的重命名');
  assert(impLog!.detail?.includes('同名B→'), '日志记录同名B的重命名');

  // 搜索验证：能搜到改名后的导入快照
  const store = useReplayStore.getState();
  const searchA = store.filterSnapshots('同名A');
  assertEq(searchA.length, 2, '搜索"同名A"返回2条（本地+导入）');
  // 精确搜名称中的导入后缀 "(导入"，避免搜到描述里的"导入版本"
  const searchByName = store.snapshots.filter(s => s.name.includes('(导入'));
  assertEq(searchByName.length, 2, '按名称搜"(导入"返回2条（只有重命名的A和B）');
  // 直接比对：A和B都被重命名了，C没有
  const hasImportA = store.snapshots.some(s => s.name.startsWith('同名A') && s.name.includes('导入'));
  const hasImportB = store.snapshots.some(s => s.name.startsWith('同名B') && s.name.includes('导入'));
  const hasImportC = store.snapshots.some(s => s.name === '新名称C' && s.name.includes('导入'));
  assert(hasImportA, 'A有导入后缀版本');
  assert(hasImportB, 'B有导入后缀版本');
  assert(!hasImportC, 'C没有导入后缀版本');
});

// ============================================================
// 新增链路测试 - 本地重启后重新打开
// ============================================================
test('链路-本地重启后：导入的快照和操作日志均完整保留', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 3; i++) s.stepForward();
  const orig = ui_save('重启测试', '原始快照');
  const origSnap = (orig as any).snapshot;

  const json = s.exportSnapshot(origSnap.snapshotId);
  const imp = ui_import(json, 'keep_both');
  assertEq(imp.kind, 'toast-success');
  const importedSnap = (imp as any).snapshot;
  const importedName = importedSnap.name;

  // 模拟刷新
  s.saveSession();
  const snapBefore = useReplayStore.getState().snapshots.length;
  const logBefore = useReplayStore.getState().snapshotLogs.length;

  const backup: Record<string, string | null> = {};
  ['replay:session', 'replay:events', 'replay:rules', 'replay:lastExport', 'replay:snapshots', 'replay:snapshotLogs'].forEach(k => {
    backup[k] = localStorage.getItem(k);
  });
  s.clearSession();
  Object.entries(backup).forEach(([k, v]) => { if (v !== null) localStorage.setItem(k, v); });
  s.loadSession();

  // 重启后验证
  assertEq(useReplayStore.getState().snapshots.length, snapBefore, '重启后快照数量一致');
  const afterImported = useReplayStore.getState().snapshots.find(x => x.name === importedName);
  assert(!!afterImported, `重启后导入的快照"${importedName}"仍在`);
  assertEq(afterImported!.cursor, importedSnap.cursor, '重启后导入的快照游标正确');
  assertEq(afterImported!.description, importedSnap.description, '重启后描述正确');

  // 操作日志也保留
  assert(useReplayStore.getState().snapshotLogs.length >= logBefore, '重启后操作日志不减少');
  const hasImportLog = useReplayStore.getState().snapshotLogs.some(
    l => l.action === 'import' && l.snapshotNames.includes(importedName),
  );
  assert(hasImportLog, '重启后仍可追溯到导入操作日志');

  // 排序验证：导入的快照正确参与排序
  const store = useReplayStore.getState();
  const sorted = store.sortSnapshots([...store.snapshots], 'newest_first');
  assertEq(sorted[0].snapshotId, afterImported!.snapshotId, '按最新优先时，导入的快照排在最前');

  // 详情访问验证
  const ok = s.restoreSnapshot(afterImported!.snapshotId);
  assert(ok, '重启后导入的快照可以正常恢复');
  assertEq(useReplayStore.getState().cursor, afterImported!.cursor, '恢复后游标与导入时一致');
});

// ============================================================
// 新增链路测试 - 搜索、排序、详情中识别新导入
// ============================================================
test('链路-搜索排序详情：导入的快照可快速识别定位', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 2; i++) s.stepForward();
  ui_save('Alpha节点', '最早创建');
  for (let i = 0; i < 2; i++) s.stepForward();
  // 直接从 ui_save 返回值获取快照，避免查找时的问题
  const betaSaveResult: any = ui_save('Beta节点', '第二个创建');
  assertEq(betaSaveResult.kind, 'toast-success', 'Beta节点保存成功');
  const betaSnapSafe = betaSaveResult.snapshot;
  assert(!!betaSnapSafe, 'Beta节点快照对象存在');
  assertEq(betaSnapSafe.name, 'Beta节点', 'Beta节点名称正确');

  const jsonBeta = s.exportSnapshot(betaSnapSafe.snapshotId);
  const impRes = ui_import(jsonBeta, 'keep_both');
  assertEq(impRes.kind, 'toast-success', '导入成功');
  const importedBeta = (impRes as any).snapshot;
  assert(importedBeta, '导入返回的快照存在');
  const importedName = importedBeta.name;
  assert(importedName.includes('导入'), '导入的名称包含导入标记');

  // 搜索：用原名能同时搜到本地和导入版
  const store = useReplayStore.getState();
  const byName = store.filterSnapshots('Beta');
  assertEq(byName.length, 2, '搜索"Beta"返回本地+导入共2条');

  // 搜索：用精确的名称导入后缀标记
  const byNameImport = store.snapshots.filter(x => x.name.includes('(导入'));
  assertEq(byNameImport.length, 1, '名称含"(导入"的有1条');
  assertEq(byNameImport[0].snapshotId, importedBeta.snapshotId, '正是导入的那一条');

  // 排序：按最新优先，导入的应该排最前（createdAt 更大）
  const sortedNewest = store.sortSnapshots([...store.snapshots], 'newest_first');
  assertEq(sortedNewest[0].snapshotId, importedBeta.snapshotId, '最新优先排序，导入的排第一');

  // 排序：按名称A-Z，Alpha < Beta < Beta(导入...)
  const sortedName = store.sortSnapshots([...store.snapshots], 'name_asc');
  assert(sortedName[0].name.startsWith('Alpha'), '名称升序Alpha在前');
  assert(sortedName[1].name === 'Beta节点', '原名Beta在中间');
  assert(sortedName[2].name.startsWith('Beta节点') && sortedName[2].name.includes('导入'), '导入版Beta排在最后');

  // 详情访问：能展开看到导入快照的完整信息（游标、事件数、告警数与源一致）
  const detail = store.snapshots.find(x => x.snapshotId === importedBeta.snapshotId)!;
  assertEq(detail.cursor, betaSnapSafe.cursor, '详情游标与源一致');
  assertEq(detail.events.length, betaSnapSafe.events.length, '详情事件数与源一致');
  assertEq(detail.activeAlarms.length, betaSnapSafe.activeAlarms.length, '详情告警数与源一致');
  assertEq(detail.operatorNotes, betaSnapSafe.operatorNotes, '详情备注与源一致');
});

// ============================================================
// 新增链路测试 - 连续多次导入（同秒不同毫秒）
// ============================================================
test('链路-同秒连续导入：毫秒级后缀确保全部唯一', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 3; i++) s.stepForward();
  const r = ui_save('快速导入', '连续导入测试');
  const snapId = (r as any).snapshot.snapshotId;
  const json = s.exportSnapshot(snapId);

  const importedNames: string[] = [];
  for (let i = 0; i < 4; i++) {
    const imp = ui_import(json, 'keep_both');
    assertEq(imp.kind, 'toast-success');
    importedNames.push((imp as any).snapshot.name);
  }

  // 4 个导入的名称必须全部唯一
  const uniqueSet = new Set(importedNames);
  assertEq(uniqueSet.size, 4, '连续4次导入名称全部唯一');

  // 每个名称都包含原名和导入标记
  for (const n of importedNames) {
    assert(n.startsWith('快速导入'), `以原名开头: ${n}`);
    assert(n.includes('导入'), `包含导入标记: ${n}`);
    // 格式校验：YYYYMMDD_HHmmss_SSS 或带 _2 _3 后缀
    assert(/\(导入 \d{8}_\d{6}_\d{3}(?:_\d+)?\)/.test(n) || /\(导入 \d{8}_\d{6}(?:_\d+)?\)/.test(n),
      `时间戳格式正确: ${n}`);
  }

  // 总数：1 原始 + 4 导入 = 5
  assertEq(useReplayStore.getState().snapshots.length, 5);
});

// ============================================================
// 汇总
// ============================================================
console.log('\n========================================');
console.log(`文档复现测试完成: ${passed} 通过, ${failed} 失败`);
if (errors.length > 0) {
  console.error('\n失败列表:');
  errors.forEach(e => console.error(e));
  process.exit(1);
} else {
  console.log('🎉 所有按说明文档步骤复现的测试通过！');
  process.exit(0);
}
