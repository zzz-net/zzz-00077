// 快照功能 - 贴近用户操作的页面交互集成测试
// 模拟 SnapshotPanel 中用户真实点击/输入的完整链路
// 使用: npx tsx tests/snapshot_ui.test.ts
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
  createElement: () => ({
    href: '',
    download: '',
    click: () => {},
  }),
  body: { appendChild: () => {}, removeChild: () => {} },
};

// Mock window.confirm（用户取消/确认删除）
const confirmCalls: boolean[] = [];
(global as any).confirm = (msg: string) => {
  return confirmCalls.shift() ?? true;
};

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
function snapshotOfState() {
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
// 模拟用户操作（对应 SnapshotPanel 中的 UI 动作）
// ============================================================

/** 模拟用户在名称输入框输入 */
function userTypeSaveName(name: string) { return name; }
/** 模拟用户在描述输入框输入 */
function userTypeDesc(desc: string) { return desc; }

/** 模拟用户点击"保存"按钮 - 对应 SnapshotPanel 的 handleSave */
function uiClickSave(userName: string, userDesc: string = '') {
  const store = useReplayStore.getState();
  if (!userName.trim()) {
    return { kind: 'toast-error', message: '快照名称不能为空' as const };
  }
  const conflict = store.checkSnapshotConflict(userName.trim());
  if (conflict.hasConflict && conflict.existingSnapshot) {
    return {
      kind: 'show-conflict-dialog' as const,
      existingSnapshot: conflict.existingSnapshot,
      pendingName: userName.trim(),
      pendingDesc: userDesc.trim(),
    };
  }
  const result = store.saveSnapshot(userName, userDesc);
  if (result.success) {
    return { kind: 'toast-success' as const, message: `已保存快照 "${result.snapshot?.name}"`, snapshot: result.snapshot };
  }
  return { kind: 'toast-error' as const, message: result.error || '保存失败' };
}

/** 模拟用户在冲突弹窗点击"取消" */
function uiClickCancelConflict() {
  return { kind: 'dialog-closed' as const };
}

/** 模拟用户在冲突弹窗点击"确认覆盖" */
function uiClickConfirmOverwrite(pendingName: string, pendingDesc: string) {
  const store = useReplayStore.getState();
  const result = store.saveSnapshot(pendingName, pendingDesc, true);
  if (result.success) {
    return { kind: 'toast-success' as const, message: `已覆盖快照 "${pendingName}"` };
  }
  return { kind: 'toast-error' as const, message: result.error || '覆盖失败' };
}

/** 模拟用户点击某条快照的"恢复"按钮 */
function uiClickRestore(snapId: string) {
  const store = useReplayStore.getState();
  const snap = store.snapshots.find(s => s.snapshotId === snapId);
  const ok = store.restoreSnapshot(snapId);
  if (ok && snap) {
    return { kind: 'toast-success' as const, message: `已恢复至 "${snap.name}"`, showUndoBanner: true };
  }
  return { kind: 'toast-error' as const, message: '恢复失败' };
}

/** 模拟用户点击"撤销恢复"横幅按钮 */
function uiClickUndoRestore() {
  const store = useReplayStore.getState();
  const ok = store.undoRestoreSnapshot();
  if (ok) {
    return { kind: 'toast-success' as const, message: '已撤销恢复', showUndoBanner: false };
  }
  return { kind: 'toast-error' as const, message: '没有可撤销的恢复操作' };
}

/** 模拟用户点击"删除"按钮（确认/取消两种情况） */
function uiClickDelete(snapId: string, userConfirms: boolean) {
  const store = useReplayStore.getState();
  const snap = store.snapshots.find(s => s.snapshotId === snapId);
  confirmCalls.push(userConfirms);
  if (!userConfirms) {
    return { kind: 'user-cancelled-delete' as const };
  }
  const ok = store.deleteSnapshot(snapId);
  if (ok && snap) {
    return { kind: 'toast-success' as const, message: `已删除快照 "${snap.name}"` };
  }
  return { kind: 'toast-error' as const, message: '删除失败' };
}

/** 模拟用户点击"导出"按钮 */
function uiClickExport(snapId: string) {
  const store = useReplayStore.getState();
  const json = store.exportSnapshot(snapId);
  const snap = store.snapshots.find(s => s.snapshotId === snapId);
  if (json && snap) {
    return { kind: 'download-started' as const, json, filename: `snapshot-${snap.name}-${Date.now()}.json` };
  }
  return { kind: 'toast-error' as const, message: '导出失败' };
}

/** 模拟用户导入文件（通过 file input 选文件后读取） */
function uiSelectFileAndImport(jsonContent: string) {
  const store = useReplayStore.getState();
  const result = store.importSnapshot(jsonContent);
  if (result.success && result.snapshot) {
    return { kind: 'toast-success' as const, message: `已导入快照 "${result.snapshot.name}"`, snapshot: result.snapshot };
  }
  return { kind: 'toast-error' as const, message: `导入失败：${result.error || '未知错误'}` };
}

// ============================================================
// 测试用例
// ============================================================

test('UI-01 用户输入空名称点保存 -> 显示错误提示', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  const res = uiClickSave('', '描述');
  assertEq(res.kind, 'toast-error', '返回错误toast');
  assert(res.message.includes('不能为空'), '提示不能为空');
  assertEq(useReplayStore.getState().snapshots.length, 0, '无快照');
});

test('UI-02 用户正常命名保存 -> 成功，快照出现在列表', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  const name = userTypeSaveName('演练初态');
  const desc = userTypeDesc('刚载入数据，还没推进');
  const res = uiClickSave(name, desc);

  assertEq(res.kind, 'toast-success', '成功toast');
  assert(res.message.includes('演练初态'), 'toast显示正确名称');
  const state = useReplayStore.getState();
  assertEq(state.snapshots.length, 1, '列表有1条');
  assertEq(state.snapshots[0].name, '演练初态', '名称正确');
  assertEq(state.snapshots[0].description, '刚载入数据，还没推进', '描述正确');
});

test('UI-03 用户同名保存 -> 弹出冲突对话框，用户点取消，不覆盖', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  const r1 = s.saveSnapshot('重名检查点');
  assert(r1.success, '先建一个');
  const originalId = r1.snapshot!.snapshotId;
  const originalCursor = r1.snapshot!.cursor;

  // 推进几步，状态变了
  for (let i = 0; i < 5; i++) s.stepForward();

  // 用户尝试同名保存
  const name = userTypeSaveName('重名检查点');
  const res = uiClickSave(name);
  assertEq(res.kind, 'show-conflict-dialog', '弹出冲突对话框');
  assertEq(res.existingSnapshot?.snapshotId, originalId, '弹窗显示正确的已有快照');

  // 用户点取消
  const cancelRes = uiClickCancelConflict();
  assertEq(cancelRes.kind, 'dialog-closed', '弹窗关闭');

  // 验证：原快照没被覆盖
  const state = useReplayStore.getState();
  assertEq(state.snapshots.length, 1, '还是1条，没新增');
  const theSnap = state.snapshots.find(x => x.snapshotId === originalId);
  assert(!!theSnap, '原ID还在');
  assertEq(theSnap!.cursor, originalCursor, '原快照游标没变，没被覆盖');
});

test('UI-04 用户同名保存 -> 冲突后点确认覆盖 -> 原快照内容更新', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  const r1 = s.saveSnapshot('覆盖检查点', '原始描述');
  assert(r1.success);
  const originalId = r1.snapshot!.snapshotId;
  const originalCursor = r1.snapshot!.cursor;

  for (let i = 0; i < 6; i++) s.stepForward();
  const newCursor = useReplayStore.getState().cursor;
  assert(newCursor > originalCursor, '游标推进了');

  const name = userTypeSaveName('覆盖检查点');
  const desc = userTypeDesc('已推进到事件6');
  const conflictRes = uiClickSave(name, desc);
  assertEq(conflictRes.kind, 'show-conflict-dialog', '冲突弹窗');
  assert(conflictRes.pendingName === '覆盖检查点', '保存了pending名称');

  const overwriteRes = uiClickConfirmOverwrite(conflictRes.pendingName, conflictRes.pendingDesc);
  assertEq(overwriteRes.kind, 'toast-success', '覆盖成功toast');

  const state = useReplayStore.getState();
  assertEq(state.snapshots.length, 1, '仍1条');
  const updated = state.snapshots[0];
  assertEq(updated.snapshotId, originalId, 'ID不变（原快照被覆盖）');
  assertEq(updated.cursor, newCursor, '游标已更新为新值');
  assertEq(updated.description, '已推进到事件6', '描述已更新');
});

test('UI-05 用户选一条快照点恢复 -> 状态恢复 + 显示撤销横幅；再点撤销 -> 回到恢复前', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 4; i++) s.stepForward();
  const alarm = useReplayStore.getState().activeAlarms.find(a => a.status === 'active');
  if (alarm) s.confirmAlarm(alarm.alarmId, '确认处理');
  s.setOperatorNotes('节点A备注');
  const rA = s.saveSnapshot('节点A');
  assert(rA.success);
  const snapAId = rA.snapshot!.snapshotId;
  const stateA = {
    cursor: useReplayStore.getState().cursor,
    confs: useReplayStore.getState().confirmations.length,
    notes: useReplayStore.getState().operatorNotes,
  };

  for (let i = 0; i < 6; i++) s.stepForward();
  const alarm2 = useReplayStore.getState().activeAlarms.find(a => a.status === 'active');
  if (alarm2) s.confirmAlarm(alarm2.alarmId, '另一个确认');
  s.setOperatorNotes('节点B备注');
  const stateBeforeRestore = {
    cursor: useReplayStore.getState().cursor,
    confs: useReplayStore.getState().confirmations.length,
    notes: useReplayStore.getState().operatorNotes,
  };
  assert(stateBeforeRestore.cursor > stateA.cursor, '已推进');
  assert(stateBeforeRestore.confs >= stateA.confs);

  // 用户点恢复
  const restoreRes = uiClickRestore(snapAId);
  assertEq(restoreRes.kind, 'toast-success', '恢复成功toast');
  assertEq(restoreRes.showUndoBanner, true, '显示撤销横幅');
  const st = snapshotOfState();
  assertEq(st.preRestore, true, 'preRestore快照存在');

  const state = useReplayStore.getState();
  assertEq(state.cursor, stateA.cursor, '游标回到A');
  assertEq(state.confirmations.length, stateA.confs, '确认数回到A');
  assertEq(state.operatorNotes, stateA.notes, '备注回到A');

  // 用户点撤销恢复横幅按钮
  const undoRes = uiClickUndoRestore();
  assertEq(undoRes.kind, 'toast-success', '撤销成功toast');
  assertEq(undoRes.showUndoBanner, false, '横幅消失');
  const st2 = snapshotOfState();
  assertEq(st2.preRestore, false, 'preRestore已清空');

  const afterUndo = useReplayStore.getState();
  assertEq(afterUndo.cursor, stateBeforeRestore.cursor, '撤销后游标回到恢复前');
  assertEq(afterUndo.confirmations.length, stateBeforeRestore.confs, '撤销后确认数回到恢复前');
  assertEq(afterUndo.operatorNotes, stateBeforeRestore.notes, '撤销后备注回到恢复前');

  // 再次点撤销 -> 错误
  const undoAgain = uiClickUndoRestore();
  assertEq(undoAgain.kind, 'toast-error', '无操作可撤销');
  assert(undoAgain.message.includes('没有可撤销'), '提示正确');
});

test('UI-06 用户点删除，弹 confirm 时取消 -> 快照还在', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();
  const r = s.saveSnapshot('待删除');
  assert(r.success);
  const id = r.snapshot!.snapshotId;

  const res = uiClickDelete(id, false); // false = 用户点取消
  assertEq(res.kind, 'user-cancelled-delete', '用户取消了删除');
  assertEq(useReplayStore.getState().snapshots.length, 1, '快照还在');
  assert(!!useReplayStore.getState().snapshots.find(x => x.snapshotId === id), 'ID还在');
});

test('UI-07 用户点删除，confirm时点确定 -> 快照被删除', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();
  const r = s.saveSnapshot('要删');
  assert(r.success);
  const id = r.snapshot!.snapshotId;

  const res = uiClickDelete(id, true); // true = 用户点确定
  assertEq(res.kind, 'toast-success', '删除成功');
  assert(res.message.includes('要删'), 'toast含名称');
  assertEq(useReplayStore.getState().snapshots.length, 0, '已删除');
  assert(!useReplayStore.getState().snapshots.find(x => x.snapshotId === id), 'ID没了');
});

test('UI-08 用户导出某快照再导入 -> 列表新增，内容一致，同名自动重命名', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();
  for (let i = 0; i < 3; i++) s.stepForward();
  s.setOperatorNotes('往返备注');
  const r = s.saveSnapshot('导出导入', '往返测试');
  assert(r.success);
  const snapId = r.snapshot!.snapshotId;
  const origSnap = useReplayStore.getState().snapshots.find(x => x.snapshotId === snapId)!;

  // 用户点导出
  const exportRes = uiClickExport(snapId);
  assertEq(exportRes.kind, 'download-started', '触发下载');
  assert(exportRes.filename.startsWith('snapshot-导出导入'), '文件名正确');
  const json = exportRes.json;
  assert(json.includes('schemaVersion'), '含schema版本');

  // 用户再点导入（选刚才的文件）
  const beforeCount = useReplayStore.getState().snapshots.length;
  const importRes = uiSelectFileAndImport(json);
  assertEq(importRes.kind, 'toast-success', '导入成功');
  assert(importRes.message.includes('导出导入'), 'toast含原名称');
  assert(importRes.snapshot!.name !== origSnap.name, '同名自动改名了');
  assert(importRes.snapshot!.name.includes('导出导入'), '改名仍保留原名');
  assert(importRes.snapshot!.name.includes('导入'), '标记了导入');
  assertEq(useReplayStore.getState().snapshots.length, beforeCount + 1, '多了1条');

  // 内容一致
  const imported = importRes.snapshot!;
  assertEq(imported.cursor, origSnap.cursor, '游标一致');
  assertEq(imported.events.length, origSnap.events.length, '事件数一致');
  assertEq(imported.confirmations.length, origSnap.confirmations.length, '确认数一致');
  assertEq(imported.operatorNotes, origSnap.operatorNotes, '备注一致');
  assertEq(imported.rules.length, origSnap.rules.length, '规则数一致');
});

test('UI-09 用户导入损坏/不兼容文件 -> 仅显示错误，现有会话完全未被污染', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();
  for (let i = 0; i < 2; i++) s.stepForward();
  s.saveSnapshot('基准快照');
  const base = snapshotOfState();
  assertEq(base.snapLen, 1);

  const badCases: [string, string][] = [
    ['完全不是JSON', '{{not json]]'],
    ['schema版本不兼容', JSON.stringify({ schemaVersion: 99, snapshot: {} })],
    ['snapshot字段缺失', JSON.stringify({ schemaVersion: 1 })],
    ['必填字段不全', JSON.stringify({ schemaVersion: 1, snapshot: { name: '不全' } })],
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
    const res = uiSelectFileAndImport(data);
    assertEq(res.kind, 'toast-error', `${caseName} -> 错误toast`);
    assert(!!res.message, `${caseName} -> 有错误说明`);
    const after = snapshotOfState();
    assertEq(after, base, `${caseName} -> 现有状态未被任何污染`);
  }
});

test('UI-10 模拟刷新(清空内存+从localStorage恢复) -> 快照仍在并可恢复', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 3; i++) s.stepForward();
  const r1 = s.saveSnapshot('刷新测试1', 'A点');
  for (let i = 0; i < 3; i++) s.stepForward();
  const r2 = s.saveSnapshot('刷新测试2', 'B点');
  assert(r1.success && r2.success);
  const snap1Cursor = r1.snapshot!.cursor;
  const snap2Cursor = r2.snapshot!.cursor;
  assert(snap2Cursor > snap1Cursor);

  // 用户点击保存会话（或自动save）
  s.saveSession();

  // 备份 localStorage（模拟浏览器刷新前保留的内容）
  const backup: Record<string, string | null> = {};
  ['replay:session', 'replay:events', 'replay:rules', 'replay:lastExport', 'replay:snapshots'].forEach(k => {
    backup[k] = localStorage.getItem(k);
  });

  // 模拟刷新：清 store + 清 localStorage（clearSession 会清）
  s.clearSession();
  assertEq(useReplayStore.getState().snapshots.length, 0, '刷新后内存快照清空');

  // 模拟浏览器刷新后 localStorage 还在
  Object.entries(backup).forEach(([k, v]) => {
    if (v !== null) localStorage.setItem(k, v);
  });

  // 页面启动时 loadSession
  s.loadSession();

  const afterRefresh = useReplayStore.getState();
  assertEq(afterRefresh.snapshots.length, 2, '刷新后从持久化恢复出2条');
  const a = afterRefresh.snapshots.find(x => x.name === '刷新测试1');
  const b = afterRefresh.snapshots.find(x => x.name === '刷新测试2');
  assert(!!a && !!b, '两条都在');
  assertEq(a!.cursor, snap1Cursor, '1游标正确');
  assertEq(b!.cursor, snap2Cursor, '2游标正确');
  assertEq(a!.description, 'A点', '描述正确');

  // 能正常恢复
  const ok = s.restoreSnapshot(a!.snapshotId);
  assert(ok, '刷新后恢复功能可用');
  assertEq(useReplayStore.getState().cursor, snap1Cursor, '恢复后游标正确');
});

test('UI-11 主流程演练：推进->保存->冲突取消->覆盖->恢复->撤销->导出->导入', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  // 推进3步，保存
  for (let i = 0; i < 3; i++) s.stepForward();
  let r = uiClickSave(userTypeSaveName('第1步'), '推进3事件');
  assertEq(r.kind, 'toast-success', '第1步保存成功');
  const snap1 = (r as any).snapshot.snapshotId;

  // 再推进，重名保存，取消冲突
  for (let i = 0; i < 2; i++) s.stepForward();
  r = uiClickSave('第1步');
  assertEq(r.kind, 'show-conflict-dialog', '冲突');
  const cc = uiClickCancelConflict();
  assertEq(cc.kind, 'dialog-closed', '取消了');
  assertEq(useReplayStore.getState().snapshots.length, 1, '仍1条');

  // 重名保存，改为确认覆盖
  r = uiClickSave('第1步', '已覆盖，共推进5事件');
  assertEq(r.kind, 'show-conflict-dialog', '再次冲突');
  const co = uiClickConfirmOverwrite((r as any).pendingName, (r as any).pendingDesc);
  assertEq(co.kind, 'toast-success', '覆盖成功');
  assertEq(useReplayStore.getState().snapshots.length, 1, '仍1条');
  assertEq(useReplayStore.getState().snapshots[0].description, '已覆盖，共推进5事件', '描述更新');

  // 再推进4步，保存第2条
  for (let i = 0; i < 4; i++) s.stepForward();
  r = uiClickSave('第2步');
  assertEq(r.kind, 'toast-success', '第2步保存');
  const snap2 = (r as any).snapshot.snapshotId;

  // 恢复第1步
  const stateBefore = snapshotOfState();
  const restoreRes = uiClickRestore(snap1);
  assertEq(restoreRes.kind, 'toast-success', '恢复');
  const undoRes = uiClickUndoRestore();
  assertEq(undoRes.kind, 'toast-success', '撤销恢复');
  const afterUndo = snapshotOfState();
  assertEq(afterUndo.cursor, stateBefore.cursor, '撤销后游标');
  assertEq(afterUndo.preRestore, false);

  // 导出第2步，再导入
  const exportRes = uiClickExport(snap2);
  assertEq(exportRes.kind, 'download-started', '导出');
  const beforeImport = useReplayStore.getState().snapshots.length;
  const importRes = uiSelectFileAndImport((exportRes as any).json);
  assertEq(importRes.kind, 'toast-success', '导入');
  assertEq(useReplayStore.getState().snapshots.length, beforeImport + 1, '多1条');

  // 尝试导入坏数据
  const ssBefore = snapshotOfState();
  const badImport = uiSelectFileAndImport('garbage');
  assertEq(badImport.kind, 'toast-error', '坏导入失败');
  assertEq(snapshotOfState(), ssBefore, '坏导入无影响');

  // 最后确认一共3条快照
  assertEq(useReplayStore.getState().snapshots.length, 3, '最终3条');
  console.log('  📋 主流程最终快照列表:');
  useReplayStore.getState().snapshots.forEach(x => {
    console.log(`     - ${x.name} (cursor=${x.cursor}, alarms=${x.activeAlarms.length})`);
  });
});

// ============================================================
// 汇总
// ============================================================
console.log('\n========================================');
console.log(`UI集成测试完成: ${passed} 通过, ${failed} 失败`);
if (errors.length > 0) {
  console.error('\n失败列表:');
  errors.forEach(e => console.error(e));
  process.exit(1);
} else {
  console.log('🎉 所有页面交互链路测试通过！');
  process.exit(0);
}
