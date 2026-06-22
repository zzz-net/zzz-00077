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

function ui_import(json: string) {
  const store = useReplayStore.getState();
  const r = store.importSnapshot(json);
  return r.success && r.snapshot ? { kind: 'toast-success', msg: `已导入快照 "${r.snapshot.name}"`, snapshot: r.snapshot } : { kind: 'toast-error', msg: `导入失败：${r.error || '未知错误'}` };
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
  const importRes = ui_import(json);
  assertEq(importRes.kind, 'toast-success', '导入成功');
  assert(importRes.msg.includes('已导入快照'), '提示已导入');
  const imported = (importRes as any).snapshot;
  assert(imported.name !== origSnap.name, '同名自动改名');
  assert(imported.name.includes('导出导入节点'), '保留原名');
  assert(imported.name.includes('(导入 '), '标记导入');
  assertEq(useReplayStore.getState().snapshots.length, beforeCount + 1, '数量+1');

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
  ui_import((ex as any).json);
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
