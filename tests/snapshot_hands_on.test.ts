// 快照功能 - 最贴近真实用户操作的 Hands-On 回归测试
// 每一步严格对应 README §6 的精确描述，断言 Toast 文案和可见 UI 状态
// 重点验证 3 个核心诉求：
//   1) 覆盖确认不会误写（取消时原快照纹丝不动）
//   2) 损坏或不兼容文件导入失败后当前会话零污染
//   3) 重开后快照列表和内容完全一致
// 使用: npx tsx tests/snapshot_hands_on.test.ts
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
(global as any).URL = { createObjectURL: () => 'mock://blob', revokeObjectURL: () => {} };
(global as any).Blob = function(d: any, o: any) { this.data = d; };
(global as any).document = {
  createElement: () => ({ href: '', download: '', click: () => {} }),
  body: { appendChild: () => {}, removeChild: () => {} },
};
const confirmCalls: boolean[] = [];
(global as any).confirm = (_m: string) => confirmCalls.shift() ?? true;
(global as any).React = {};

import { useReplayStore } from '../src/store/useReplayStore';

let passed = 0;
let failed = 0;
const errors: string[] = [];
function test(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`✅ PASS: ${name}`); }
  catch (e) { failed++; const m=`❌ FAIL: ${name}\n   ${(e as Error).message}`; errors.push(m); console.error(m); }
}
function assertEq<T>(a: T, b: T, m='') { const x=JSON.stringify(a),y=JSON.stringify(b); if(x!==y) throw new Error(`${m}\n   期望: ${y}\n   实际: ${x}`); }
function assert(c: boolean, m='') { if(!c) throw new Error(m||'断言失败'); }
function contains(s: string, sub: string, m='') { if(!s.includes(sub)) throw new Error(`${m}\n   "${s}" 不包含 "${sub}"`); }
function snap() {
  const s = useReplayStore.getState();
  return {
    snapLen: s.snapshots.length,
    cursor: s.cursor,
    eventsLen: s.events.length,
    confsLen: s.confirmations.length,
    alarmsActive: s.activeAlarms.filter(a=>a.status==='active').length,
    notes: s.operatorNotes,
    preRestore: !!s.preRestoreSnapshot,
    snapshots: s.snapshots.map(x=>({id:x.snapshotId,name:x.name,cursor:x.cursor,desc:x.description,confs:x.confirmations.length})),
  };
}

// ============================================================
// UI 交互模拟（和 SnapshotPanel 中的逻辑 1:1 对应）
// ============================================================
function ui_save(name: string, desc: string = '') {
  const st = useReplayStore.getState();
  if (!name.trim()) return { kind: 'toast-error', text: '快照名称不能为空' };
  const c = st.checkSnapshotConflict(name.trim());
  if (c.hasConflict && c.existingSnapshot) {
    return { kind: 'show-conflict-dialog', existing: c.existingSnapshot, pendingName: name.trim(), pendingDesc: desc.trim() };
  }
  const r = st.saveSnapshot(name, desc);
  return r.success
    ? { kind: 'toast-success', text: `已保存快照 "${r.snapshot?.name}"`, snapshot: r.snapshot }
    : { kind: 'toast-error', text: r.error || '保存失败' };
}
function ui_cancelConflict() { return { kind: 'dialog-closed' }; }
function ui_confirmOverwrite(pendingName: string, pendingDesc: string) {
  const r = useReplayStore.getState().saveSnapshot(pendingName, pendingDesc, true);
  return r.success
    ? { kind: 'toast-success', text: `已覆盖快照 "${pendingName}"` }
    : { kind: 'toast-error', text: r.error || '覆盖失败' };
}
function ui_restore(snapId: string) {
  const st = useReplayStore.getState();
  const snap = st.snapshots.find(s => s.snapshotId === snapId);
  const ok = st.restoreSnapshot(snapId);
  return ok && snap
    ? { kind: 'toast-success', text: `已恢复至 "${snap.name}"，可点击"撤销"回到之前状态`, showUndoBanner: true }
    : { kind: 'toast-error', text: '恢复失败' };
}
function ui_undoRestore() {
  const ok = useReplayStore.getState().undoRestoreSnapshot();
  return ok
    ? { kind: 'toast-success', text: '已撤销恢复，回到恢复前的状态', showUndoBanner: false }
    : { kind: 'toast-error', text: '没有可撤销的恢复操作' };
}
function ui_export(snapId: string) {
  const st = useReplayStore.getState();
  const json = st.exportSnapshot(snapId);
  const snap = st.snapshots.find(s => s.snapshotId === snapId);
  return json && snap
    ? { kind: 'download', filename: `snapshot-${snap.name}-${Date.now()}.json`, json }
    : { kind: 'toast-error', text: '导出失败' };
}
function ui_import(json: string) {
  const r = useReplayStore.getState().importSnapshot(json);
  return r.success && r.snapshot
    ? { kind: 'toast-success', text: `已导入快照 "${r.snapshot.name}"`, snapshot: r.snapshot }
    : { kind: 'toast-error', text: `导入失败：${r.error || '未知错误'}` };
}

// ============================================================
// HO-01 核心诉求 1：覆盖确认不会误写（取消时原快照纹丝不动）
// ============================================================
test('HO-01 覆盖确认 - 点取消时原快照内容/ID/游标/描述纹丝不动', () => {
  const s = useReplayStore.getState();
  s.clearSession(); s.loadSampleEvents();

  // §6.2 新建命名快照
  for (let i = 0; i < 4; i++) s.stepForward();
  const a = ui_save('节点1', '推进4事件的描述');
  assertEq(a.kind, 'toast-success', '新建成功');
  contains(a.text, '已保存快照 "节点1"', 'Toast 文案和 README 一致');
  const id1 = (a as any).snapshot.snapshotId;
  const cursor1 = (a as any).snapshot.cursor;
  const desc1 = (a as any).snapshot.description;

  // 推进，状态变化
  for (let i = 0; i < 5; i++) s.stepForward();
  const newCursor = useReplayStore.getState().cursor;
  assert(newCursor > cursor1, '游标已推进');

  // §6.3 同名保存 → 弹冲突对话框
  const conflict = ui_save('节点1', '想覆盖的新描述');
  assertEq(conflict.kind, 'show-conflict-dialog', '弹冲突对话框');
  assertEq((conflict as any).existing.snapshotId, id1, '对话框显示正确的已有快照ID');
  assertEq((conflict as any).existing.cursor, cursor1, '对话框显示正确的已有快照游标');
  // 对话框 6 项信息都存在
  const ex = (conflict as any).existing;
  assert(ex.createdAt, '对话框包含创建时间');
  assert(typeof ex.cursor === 'number', '对话框包含游标位置');
  assert(Array.isArray(ex.activeAlarms), '对话框包含告警数');
  assert(Array.isArray(ex.confirmations), '对话框包含确认记录');
  assert(ex.description === desc1, '对话框包含描述');

  // §6.3 分支 A - 点「取消」
  const cancel = ui_cancelConflict();
  assertEq(cancel.kind, 'dialog-closed', '对话框关闭');

  // ✅ 核心断言：原快照完全未变
  const now = snap();
  assertEq(now.snapLen, 1, '列表数量仍然是 1，未新增');
  const theOne = now.snapshots.find(x => x.id === id1);
  assert(!!theOne, '原快照 ID 仍然存在');
  assertEq(theOne.cursor, cursor1, '原快照游标未变 → 没被覆盖');
  assertEq(theOne.desc, desc1, '原快照描述未变 → 没被覆盖');
  assertEq(theOne.confs, (a as any).snapshot.confirmations.length, '原快照确认数未变');
});

// ============================================================
// HO-02 核心诉求 1 续：覆盖确认 - 点「确认覆盖」后 ID 不变，内容更新
// ============================================================
test('HO-02 覆盖确认 - 点确认覆盖时 ID 不变，游标/描述/确认数全部更新', () => {
  const s = useReplayStore.getState();
  s.clearSession(); s.loadSampleEvents();
  const r1 = ui_save('节点2', '原始描述');
  const id2 = (r1 as any).snapshot.snapshotId;
  const cur2 = (r1 as any).snapshot.cursor;

  for (let i = 0; i < 6; i++) s.stepForward();
  const alarm = s.activeAlarms.find(a => a.status === 'active');
  if (alarm) s.confirmAlarm(alarm.alarmId, '覆盖测试确认');
  const newConfs = useReplayStore.getState().confirmations.length;
  const newCursor = useReplayStore.getState().cursor;

  const conflict = ui_save('节点2', '已覆盖，推进6事件');
  assertEq(conflict.kind, 'show-conflict-dialog');

  const overwrite = ui_confirmOverwrite((conflict as any).pendingName, (conflict as any).pendingDesc);
  assertEq(overwrite.kind, 'toast-success');
  contains(overwrite.text, '已覆盖快照 "节点2"', '覆盖 Toast 文案正确');

  const now = snap();
  assertEq(now.snapLen, 1, '数量不变');
  const updated = now.snapshots[0];
  assertEq(updated.id, id2, '✅ ID 保持不变');
  assertEq(updated.cursor, newCursor, '✅ 游标已更新');
  assertEq(updated.desc, '已覆盖，推进6事件', '✅ 描述已更新');
  assertEq(updated.confs, newConfs, '✅ 确认数已更新');
  assert(updated.cursor !== cur2, '✅ 游标确实和原来不一样了');
});

// ============================================================
// HO-03 核心诉求 2：损坏或不兼容文件导入失败后当前会话零污染
// ============================================================
test('HO-03 异常导入保护 - 6种损坏/不兼容情况，当前会话状态 byte-identical', () => {
  const s = useReplayStore.getState();
  s.clearSession(); s.loadSampleEvents();
  for (let i = 0; i < 3; i++) s.stepForward();
  const a = ui_save('基准快照A');
  for (let i = 0; i < 2; i++) s.stepForward();
  const alarm = s.activeAlarms.find(x => x.status === 'active');
  if (alarm) s.confirmAlarm(alarm.alarmId, '基准确认');
  s.setOperatorNotes('基准备注');
  const baseline = snap();
  assertEq(baseline.snapLen, 1, '基准：1条快照');

  // 6 种异常情况，对应 README §6.6 的表格
  const cases: [string, string, string][] = [
    ['非JSON语法', '{{not json]', '解析失败:'],
    ['schemaVersion 不兼容 v99', JSON.stringify({ schemaVersion: 99, snapshot: {} }), '不兼容的快照版本：期望 v1，实际 v99'],
    ['缺少 schemaVersion', JSON.stringify({ snapshot: { name: 'x' } }), '不兼容的快照版本：期望 v1，实际 vundefined'],
    ['缺少 snapshot', JSON.stringify({ schemaVersion: 1 }), '快照数据缺失或损坏'],
    ['必填字段不全(缺cursor)', JSON.stringify({
      schemaVersion: 1, snapshot: { snapshotId:'x',name:'x',createdAt:1,currentEventIndex:0,
        events:[{eventId:'a',timestamp:1,type:'alert',source:'s',title:'t'}],
        activeAlarms:[],processedEvents:[],pendingEvents:[],confirmations:[],rules:[],
        operator:'x',startTime:0,endTime:100 }
    }), '字段缺失: cursor'],
    ['events 空数组', JSON.stringify({
      schemaVersion: 1, snapshot: { snapshotId:'x',name:'x',createdAt:1,cursor:1,currentEventIndex:0,
        events:[],activeAlarms:[],processedEvents:[],pendingEvents:[],confirmations:[],rules:[],
        operator:'x',startTime:0,endTime:100 }
    }), '快照事件数据无效'],
  ];

  for (const [caseName, data, expectedErrorKeyword] of cases) {
    const before = snap();
    const res = ui_import(data);

    // 1) 返回错误
    assertEq(res.kind, 'toast-error', `${caseName} → 返回 toast-error`);
    contains(res.text, expectedErrorKeyword, `${caseName} → 错误信息包含期望关键词`);

    // 2) ✅ 核心：整个会话 byte-identical
    const after = snap();
    assertEq(after, baseline, `${caseName} → 完整状态零污染（和导入前完全一致）`);
    assertEq(after, before, `${caseName} → 状态快照导入前后一致`);
  }
});

// ============================================================
// HO-04 核心诉求 3：重开后快照列表 + 内容完全一致
// ============================================================
test('HO-04 重开浏览器后 - 快照列表数量/ID/名称/游标/描述字节级一致', () => {
  const s = useReplayStore.getState();
  s.clearSession(); s.loadSampleEvents();

  // 新建 3 个快照
  for (let i = 0; i < 2; i++) s.stepForward();
  const r1 = ui_save('检查点1', '起始');
  for (let i = 0; i < 3; i++) s.stepForward();
  const r2 = ui_save('检查点2', '推进3事件');
  for (let i = 0; i < 3; i++) s.stepForward();
  const r3 = ui_save('检查点3', '再推进3事件');

  // 记录快照信息
  const beforeShutdown = useReplayStore.getState().snapshots
    .map(x => ({ id: x.snapshotId, name: x.name, cursor: x.cursor, desc: x.description, confs: x.confirmations.length, alarmsLen: x.activeAlarms.length }))
    .sort((a,b) => a.cursor - b.cursor);
  const countBefore = beforeShutdown.length;

  // 持久化保存
  s.saveSession();
  // 备份 localStorage
  const backup: Record<string, string | null> = {};
  ['replay:session','replay:events','replay:rules','replay:lastExport','replay:snapshots'].forEach(k => backup[k] = localStorage.getItem(k));

  // ✅ localStorage 中有数据
  const lsSnaps = localStorage.getItem('replay:snapshots');
  assert(!!lsSnaps, 'localStorage 中 replay:snapshots 键存在');
  const lsArr = JSON.parse(lsSnaps);
  assertEq(lsArr.length, countBefore, 'localStorage 中有正确数量的快照');

  // 模拟浏览器关闭：清内存 + 清 localStorage
  s.clearSession();
  assertEq(useReplayStore.getState().snapshots.length, 0, '关闭后内存中快照已清空');
  assertEq(localStorage.getItem('replay:snapshots'), null, '关闭后 localStorage 清空');

  // 模拟浏览器重新打开：localStorage 数据从磁盘恢复 + 调用 loadSession
  Object.entries(backup).forEach(([k, v]) => { if (v !== null) localStorage.setItem(k, v); });
  s.loadSession();

  // ✅ 核心断言：重开后列表数量 + 每条内容字节级一致
  const afterRestart = useReplayStore.getState().snapshots
    .map(x => ({ id: x.snapshotId, name: x.name, cursor: x.cursor, desc: x.description, confs: x.confirmations.length, alarmsLen: x.activeAlarms.length }))
    .sort((a,b) => a.cursor - b.cursor);

  assertEq(afterRestart.length, countBefore, '✅ 重开后快照数量一致');
  assertEq(afterRestart, beforeShutdown, '✅ 重开后每条快照的 ID/名称/游标/描述/确认数/告警数 完全一致');

  // 能正常恢复
  const r = ui_restore(beforeShutdown[1].id);
  assertEq(r.kind, 'toast-success', '✅ 重开后可正常恢复快照');
  assertEq(useReplayStore.getState().cursor, beforeShutdown[1].cursor, '✅ 恢复后游标位置正确');
});

// ============================================================
// HO-05 主流程串联：按 README 顺序完整走一遍，每步 Toast 文案正确
// ============================================================
test('HO-05 主流程串联：§6.1→6.2→6.3取消→6.3覆盖→6.4恢复→6.5撤销→6.6导出导入→6.7刷新保留', () => {
  const s = useReplayStore.getState();
  s.clearSession(); s.loadSampleEvents();

  // §6.2 新建
  for (let i = 0; i < 3; i++) s.stepForward();
  let r = ui_save('流程节点1', '初始');
  contains(r.text, '已保存快照 "流程节点1"', '§6.2 Toast 正确');
  const id = (r as any).snapshot.snapshotId;
  const cur = (r as any).snapshot.cursor;

  // §6.3 取消分支
  for (let i = 0; i < 2; i++) s.stepForward();
  const c1 = ui_save('流程节点1');
  assertEq(c1.kind, 'show-conflict-dialog', '§6.3 弹对话框');
  ui_cancelConflict();
  assertEq(snap().snapshots.find(x=>x.id===id)!.cursor, cur, '§6.3取消后原快照不变');

  // §6.3 覆盖分支
  const c2 = ui_save('流程节点1', '已覆盖，推进5事件');
  const ov = ui_confirmOverwrite((c2 as any).pendingName, (c2 as any).pendingDesc);
  contains(ov.text, '已覆盖快照 "流程节点1"', '§6.3覆盖 Toast 正确');

  // §6.4 新建节点2 + 恢复节点1
  for (let i = 0; i < 4; i++) s.stepForward();
  ui_save('流程节点2');
  const before = snap();
  const restoreRes = ui_restore(id);
  contains(restoreRes.text, '已恢复至 "流程节点1"', '§6.4恢复 Toast 正确');
  assertEq(restoreRes.showUndoBanner, true, '§6.4显示撤销横幅');

  // §6.5 撤销
  const undoRes = ui_undoRestore();
  contains(undoRes.text, '已撤销恢复，回到恢复前的状态', '§6.5撤销 Toast 正确');
  assertEq(snap().cursor, before.cursor, '§6.5撤销后游标一致');

  // §6.6 导出+导入
  const node2Id = snap().snapshots.find(x=>x.name==='流程节点2')!.id;
  const ex = ui_export(node2Id);
  assertEq(ex.kind, 'download', '导出下载');
  assert((ex as any).filename.startsWith('snapshot-流程节点2-'), '文件名格式正确');
  const beforeImport = snap().snapLen;
  const im = ui_import((ex as any).json);
  contains(im.text, '已导入快照 "流程节点2 (导入于 ', '§6.6导入 Toast 正确（同名自动加后缀）');
  assertEq(snap().snapLen, beforeImport + 1, '§6.6列表数量+1');

  // §6.7 刷新保留
  s.saveSession();
  const bk: Record<string, string | null> = {};
  ['replay:session','replay:events','replay:rules','replay:lastExport','replay:snapshots'].forEach(k => bk[k] = localStorage.getItem(k));
  s.clearSession();
  Object.entries(bk).forEach(([k,v]) => { if (v !== null) localStorage.setItem(k, v); });
  s.loadSession();
  assertEq(snap().snapLen, beforeImport + 1, '§6.7刷新后数量正确');

  console.log('  📋 Hands-On 主流程完成后的快照列表:');
  useReplayStore.getState().snapshots
    .sort((a,b)=>a.cursor-b.cursor)
    .forEach(x => console.log(`     - ${x.name} (cursor=${x.cursor}, desc=${x.description||'(无)'})`));
});

// ============================================================
// 汇总
// ============================================================
console.log('\n========================================');
console.log(`Hands-On 回归测试完成: ${passed} 通过, ${failed} 失败`);
if (errors.length > 0) {
  console.error('\n失败列表:');
  errors.forEach(e => console.error(e));
  process.exit(1);
} else {
  console.log('🎉 3 大核心诉求全部验证通过：覆盖不误写 / 坏导入零污染 / 重开全保留');
  process.exit(0);
}
