// 快照功能回归测试
// 使用: npx tsx tests/snapshots.test.ts
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

function captureState() {
  const s = useReplayStore.getState();
  return {
    cursor: s.cursor,
    idx: s.currentEventIndex,
    eventsLen: s.events.length,
    alarmsLen: s.activeAlarms.length,
    confLen: s.confirmations.length,
    rulesLen: s.rules.length,
    notes: s.operatorNotes,
    operator: s.operator,
  };
}

// ============================================================
// 测试1：保存快照基本功能
// ============================================================
test('Snapshot-保存快照包含完整状态', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 5; i++) s.stepForward();
  const alarm = useReplayStore.getState().activeAlarms.find(a => a.status === 'active');
  if (alarm) s.confirmAlarm(alarm.alarmId, '测试确认');
  s.setOperatorNotes('演练备注1');

  const before = captureState();

  const result = s.saveSnapshot('测试快照1', '这是测试描述');
  assert(result.success, '保存成功');
  assert(result.snapshot, '返回快照对象');
  assertEq(result.snapshot?.name, '测试快照1');
  assertEq(result.snapshot?.description, '这是测试描述');
  assertEq(result.snapshot?.cursor, before.cursor, '快照游标正确');
  assertEq(result.snapshot?.currentEventIndex, before.idx, '快照索引正确');
  assertEq(result.snapshot?.events.length, before.eventsLen, '快照事件数正确');
  assertEq(result.snapshot?.activeAlarms.length, before.alarmsLen, '快照告警数正确');
  assertEq(result.snapshot?.confirmations.length, before.confLen, '快照确认数正确');
  assertEq(result.snapshot?.rules.length, before.rulesLen, '快照规则数正确');
  assertEq(result.snapshot?.operatorNotes, before.notes, '快照备注正确');
  assertEq(result.snapshot?.operator, before.operator, '快照操作员正确');

  const after = useReplayStore.getState();
  assertEq(after.snapshots.length, 1, '快照列表有1个');
  assertEq(after.snapshots[0].name, '测试快照1');
});

// ============================================================
// 测试2：同名快照冲突检测与强制覆盖
// ============================================================
test('Snapshot-同名快照冲突检测与覆盖', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  const r1 = s.saveSnapshot('冲突测试');
  assert(r1.success, '首次保存成功');
  const firstId = r1.snapshot!.snapshotId;

  s.stepForward();
  s.stepForward();

  const r2 = s.saveSnapshot('冲突测试');
  assert(!r2.success, '同名不覆盖时返回失败');
  assert(r2.conflict, '返回冲突标记');
  assert(r2.existingSnapshot, '返回已有快照');
  assertEq(r2.existingSnapshot?.snapshotId, firstId, '冲突快照ID正确');

  const state1 = useReplayStore.getState();
  assertEq(state1.snapshots.length, 1, '未覆盖时仍只有1个快照');
  assertEq(state1.snapshots[0].snapshotId, firstId, 'ID不变');

  const r3 = s.saveSnapshot('冲突测试', undefined, true);
  assert(r3.success, '强制覆盖成功');

  const state2 = useReplayStore.getState();
  assertEq(state2.snapshots.length, 1, '覆盖后仍1个快照');
  assertEq(state2.snapshots[0].snapshotId, firstId, '覆盖保留原ID');
  assert(state2.snapshots[0].cursor > r1.snapshot!.cursor, '游标已更新');
});

// ============================================================
// 测试3：恢复快照与撤销恢复
// ============================================================
test('Snapshot-恢复快照后可撤销回上一状态', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 3; i++) s.stepForward();
  const pointA = captureState();

  const saveResult = s.saveSnapshot('恢复测试');
  assert(saveResult.success);
  const snapId = saveResult.snapshot!.snapshotId;

  for (let i = 0; i < 4; i++) s.stepForward();
  const alarm = useReplayStore.getState().activeAlarms.find(a => a.status === 'active');
  if (alarm) s.confirmAlarm(alarm.alarmId, '后续确认');
  s.setOperatorNotes('后续备注');
  const pointB = captureState();

  assert(pointB.cursor > pointA.cursor, '推进后游标更大');
  assert(pointB.confLen >= pointA.confLen, '推进后确认更多');

  const restoreOk = s.restoreSnapshot(snapId);
  assert(restoreOk, '恢复成功');

  const afterRestore = captureState();
  assertEq(afterRestore.cursor, pointA.cursor, '恢复后游标回到A点');
  assertEq(afterRestore.confLen, pointA.confLen, '恢复后确认数回到A点');
  assertEq(afterRestore.notes, pointA.notes, '恢复后备注回到A点');

  const preRestore = useReplayStore.getState().preRestoreSnapshot;
  assert(preRestore, '保存了恢复前状态');
  assertEq(preRestore.cursor, pointB.cursor, '恢复前状态游标正确');

  const undoOk = s.undoRestoreSnapshot();
  assert(undoOk, '撤销恢复成功');

  const afterUndo = captureState();
  assertEq(afterUndo.cursor, pointB.cursor, '撤销后游标回到B点');
  assertEq(afterUndo.confLen, pointB.confLen, '撤销后确认数回到B点');
  assertEq(afterUndo.notes, pointB.notes, '撤销后备注回到B点');
  assertEq(useReplayStore.getState().preRestoreSnapshot, null, '撤销后preRestore清空');

  const undoAgain = s.undoRestoreSnapshot();
  assert(!undoAgain, '再次撤销失败');
  assert(useReplayStore.getState().errorMessage.includes('没有可撤销'), '错误提示正确');
});

// ============================================================
// 测试4：快照导入导出往返
// ============================================================
test('Snapshot-导入导出往返数据一致', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 6; i++) s.stepForward();
  const alarm = useReplayStore.getState().activeAlarms.find(a => a.status === 'active');
  if (alarm) s.confirmAlarm(alarm.alarmId, '导出测试确认');
  s.setOperatorNotes('导出测试备注');

  const saveResult = s.saveSnapshot('往返测试', '导出描述');
  assert(saveResult.success);
  const snapId = saveResult.snapshot!.snapshotId;
  const originalSnap = saveResult.snapshot!;

  const exportJson = s.exportSnapshot(snapId);
  assert(exportJson, '导出JSON非空');

  const parsed = JSON.parse(exportJson);
  assertEq(parsed.schemaVersion, 1, 'schema版本正确');
  assert(parsed.exportTime > 0, '导出时间存在');
  assertEq(parsed.snapshot.name, '往返测试', '导出名称正确');
  assertEq(parsed.snapshot.description, '导出描述', '导出描述正确');

  const beforeImport = useReplayStore.getState().snapshots.length;

  const importResult = s.importSnapshot(exportJson);
  assert(importResult.success, '导入成功');
  assert(importResult.snapshot, '返回导入快照');

  const afterImport = useReplayStore.getState();
  assertEq(afterImport.snapshots.length, beforeImport + 1, '导入后快照数+1');

  const imported = afterImport.snapshots.find(x => x.snapshotId === importResult.snapshot!.snapshotId);
  assert(imported, '导入快照存在');
  assert(imported!.name.includes('往返测试'), '名称保留');
  assertEq(imported!.cursor, originalSnap.cursor, '导入游标一致');
  assertEq(imported!.currentEventIndex, originalSnap.currentEventIndex, '导入索引一致');
  assertEq(imported!.events.length, originalSnap.events.length, '导入事件数一致');
  assertEq(imported!.activeAlarms.length, originalSnap.activeAlarms.length, '导入告警数一致');
  assertEq(imported!.confirmations.length, originalSnap.confirmations.length, '导入确认数一致');
  assertEq(imported!.operatorNotes, originalSnap.operatorNotes, '导入备注一致');
  assertEq(imported!.rules.length, originalSnap.rules.length, '导入规则数一致');

  const importedEventsId = imported!.events.map(e => e.eventId).sort();
  const originalEventsId = originalSnap.events.map(e => e.eventId).sort();
  assertEq(importedEventsId, originalEventsId, '导入事件ID一致');
});

// ============================================================
// 测试5：跨刷新/重启快照持久化
// ============================================================
test('Snapshot-跨刷新/重启快照保留完整', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 4; i++) s.stepForward();
  const r1 = s.saveSnapshot('持久化A', '描述A');
  assert(r1.success);

  for (let i = 0; i < 3; i++) s.stepForward();
  s.setOperatorNotes('持久化备注');
  const r2 = s.saveSnapshot('持久化B', '描述B');
  assert(r2.success);

  s.saveSession();

  const snapBefore = useReplayStore.getState().snapshots;
  assertEq(snapBefore.length, 2, '保存前2个快照');

  const savedStorageSnap = localStorage.getItem('replay:snapshots');
  assert(savedStorageSnap, 'localStorage有快照数据');

  const storageBackup: Record<string, string | null> = {};
  Object.values({
    SESSION: 'replay:session',
    EVENTS: 'replay:events',
    RULES: 'replay:rules',
    LAST_EXPORT: 'replay:lastExport',
    SNAPSHOTS: 'replay:snapshots',
  }).forEach(key => {
    storageBackup[key] = localStorage.getItem(key);
  });

  s.clearSession();
  assertEq(useReplayStore.getState().snapshots.length, 0, '清空后快照为0');

  Object.entries(storageBackup).forEach(([key, val]) => {
    if (val !== null) localStorage.setItem(key, val);
  });

  s.loadSession();

  const snapAfter = useReplayStore.getState().snapshots;
  assertEq(snapAfter.length, 2, '加载后恢复2个快照');

  const snapA = snapAfter.find(x => x.name === '持久化A');
  const snapB = snapAfter.find(x => x.name === '持久化B');
  assert(snapA && snapB, '两个快照都存在');
  assertEq(snapA.description, '描述A');
  assertEq(snapB.description, '描述B');
  assert(snapB.cursor > snapA.cursor, 'B点游标大于A点');
  assertEq(snapB.operatorNotes, '持久化备注', '备注持久化正确');
  assertEq(snapA.events.length, snapB.events.length, '事件数一致');

  const restoreOk = s.restoreSnapshot(snapA.snapshotId);
  assert(restoreOk, '持久化的快照可以正常恢复');
  assertEq(useReplayStore.getState().cursor, snapA.cursor, '恢复到正确游标');
});

// ============================================================
// 测试6：异常导入保护（不污染现有会话）
// ============================================================
test('Snapshot-异常导入不污染现有会话', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  for (let i = 0; i < 2; i++) s.stepForward();
  const r = s.saveSnapshot('基准快照');
  assert(r.success);

  const beforeState = {
    snapLen: useReplayStore.getState().snapshots.length,
    cursor: useReplayStore.getState().cursor,
    eventsLen: useReplayStore.getState().events.length,
    confLen: useReplayStore.getState().confirmations.length,
    notes: useReplayStore.getState().operatorNotes,
  };

  const badCases = [
    { name: '无效JSON', data: 'not json at all' },
    { name: '空对象', data: '{}' },
    { name: '错误schema版本', data: JSON.stringify({ schemaVersion: 999, snapshot: {} }) },
    { name: '缺少snapshot', data: JSON.stringify({ schemaVersion: 1 }) },
    { name: 'snapshot为null', data: JSON.stringify({ schemaVersion: 1, snapshot: null }) },
    { name: '缺少必填字段', data: JSON.stringify({ schemaVersion: 1, snapshot: { name: 'x' } }) },
    { name: 'events为空数组', data: JSON.stringify({
      schemaVersion: 1,
      snapshot: {
        snapshotId: 'x', name: 'x', createdAt: 1, cursor: 1, currentEventIndex: 0,
        events: [], activeAlarms: [], processedEvents: [], pendingEvents: [],
        confirmations: [], rules: [], operator: 'x', startTime: 0, endTime: 100,
      },
    }) },
  ];

  for (const tc of badCases) {
    const result = s.importSnapshot(tc.data);
    assert(!result.success, `${tc.name} 应失败`);
    assert(result.error, `${tc.name} 应有错误信息`);

    const afterState = {
      snapLen: useReplayStore.getState().snapshots.length,
      cursor: useReplayStore.getState().cursor,
      eventsLen: useReplayStore.getState().events.length,
      confLen: useReplayStore.getState().confirmations.length,
      notes: useReplayStore.getState().operatorNotes,
    };
    assertEq(afterState, beforeState, `${tc.name} 不污染现有状态`);
  }
});

// ============================================================
// 测试7：导入同名快照自动重命名
// ============================================================
test('Snapshot-导入同名自动重命名不冲突', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  s.stepForward();
  const r1 = s.saveSnapshot('重名测试');
  assert(r1.success);
  const snapId = r1.snapshot!.snapshotId;

  const exportJson = s.exportSnapshot(snapId);

  const beforeCount = useReplayStore.getState().snapshots.length;

  const importResult = s.importSnapshot(exportJson);
  assert(importResult.success, '导入成功');
  assertEq(useReplayStore.getState().snapshots.length, beforeCount + 1, '快照数增加');
  assert(importResult.snapshot!.name !== '重名测试', '名称被修改');
  assert(importResult.snapshot!.name.includes('重名测试'), '名称包含原名');
  assert(importResult.snapshot!.name.includes('导入'), '名称标记导入');

  const names = useReplayStore.getState().snapshots.map(x => x.name);
  const uniqueNames = new Set(names);
  assertEq(uniqueNames.size, names.length, '所有名称唯一');
});

// ============================================================
// 测试8：删除快照
// ============================================================
test('Snapshot-删除快照', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  const r1 = s.saveSnapshot('删前');
  const r2 = s.saveSnapshot('删后');
  assert(r1.success && r2.success);
  const id1 = r1.snapshot!.snapshotId;
  const id2 = r2.snapshot!.snapshotId;

  assertEq(useReplayStore.getState().snapshots.length, 2);

  const delOk = s.deleteSnapshot(id1);
  assert(delOk, '删除成功');
  assertEq(useReplayStore.getState().snapshots.length, 1);
  assertEq(useReplayStore.getState().snapshots[0].snapshotId, id2);

  const delAgain = s.deleteSnapshot(id1);
  assert(!delAgain, '删除不存在的失败');
  assert(useReplayStore.getState().errorMessage.includes('快照不存在'));
});

// ============================================================
// 测试9：主流程演练 - 保存多节点、恢复、撤销
// ============================================================
test('Snapshot-主流程演练完整验证', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();
  s.setOperatorNotes('开始演练');

  const total = useReplayStore.getState().events.length;
  const milestones: { id: string; cursor: number }[] = [];

  for (let i = 0; i < total; i++) {
    s.stepForward();

    if (i === 3) {
      const r = s.saveSnapshot(`节点${i}`, '第1个检查点');
      assert(r.success);
      milestones.push({ id: r.snapshot!.snapshotId, cursor: r.snapshot!.cursor });
    }
    if (i === 7) {
      const alarm = useReplayStore.getState().activeAlarms.find(a => a.status === 'active');
      if (alarm) s.confirmAlarm(alarm.alarmId, `节点${i}确认`);
      s.setOperatorNotes(`节点${i}备注`);
      const r = s.saveSnapshot(`节点${i}`, '第2个检查点');
      assert(r.success);
      milestones.push({ id: r.snapshot!.snapshotId, cursor: r.snapshot!.cursor });
    }
    if (i === 11) {
      const r = s.saveSnapshot(`节点${i}`, '第3个检查点');
      assert(r.success);
      milestones.push({ id: r.snapshot!.snapshotId, cursor: r.snapshot!.cursor });
    }
  }

  assertEq(milestones.length, 3, '3个节点');
  assertEq(useReplayStore.getState().snapshots.length, 3, '3个快照');

  s.saveSession();

  const storageBackup: Record<string, string | null> = {};
  Object.values({
    SESSION: 'replay:session',
    EVENTS: 'replay:events',
    RULES: 'replay:rules',
    LAST_EXPORT: 'replay:lastExport',
    SNAPSHOTS: 'replay:snapshots',
  }).forEach(key => {
    storageBackup[key] = localStorage.getItem(key);
  });

  s.clearSession();

  Object.entries(storageBackup).forEach(([key, val]) => {
    if (val !== null) localStorage.setItem(key, val);
  });

  s.loadSession();

  assertEq(useReplayStore.getState().snapshots.length, 3, '重启后3个快照');

  for (let i = milestones.length - 1; i >= 0; i--) {
    const ms = milestones[i];
    const ok = s.restoreSnapshot(ms.id);
    assert(ok, `恢复节点${i}成功`);
    assertEq(useReplayStore.getState().cursor, ms.cursor, `节点${i}游标正确`);

    const undoOk = s.undoRestoreSnapshot();
    assert(undoOk, `撤销节点${i}成功`);
  }

  const exportJson = s.exportSnapshot(milestones[1].id);
  const importResult = s.importSnapshot(exportJson);
  assert(importResult.success, '导入成功');
  assertEq(useReplayStore.getState().snapshots.length, 4, '导入后4个快照');

  const exportJson2 = s.exportSnapshot(milestones[1].id);
  const parsed2 = JSON.parse(exportJson2);
  parsed2.schemaVersion = 2;
  const badResult = s.importSnapshot(JSON.stringify(parsed2));
  assert(!badResult.success, '版本不兼容被拒绝');
  assert(badResult.error!.includes('不兼容的快照版本'), '错误信息正确');
  assertEq(useReplayStore.getState().snapshots.length, 4, '拒绝后还是4个快照');

  console.log('  📋 主流程快照列表:');
  useReplayStore.getState().snapshots.forEach(snap => {
    console.log(`     - ${snap.name} (游标: ${snap.cursor}, 告警: ${snap.activeAlarms.length})`);
  });
});

// ============================================================
// 测试10：空名称验证
// ============================================================
test('Snapshot-空名称被拒绝', () => {
  const s = useReplayStore.getState();
  s.clearSession();
  s.loadSampleEvents();

  const r1 = s.saveSnapshot('');
  assert(!r1.success, '空串失败');
  assert(r1.error!.includes('不能为空'));

  const r2 = s.saveSnapshot('   ');
  assert(!r2.success, '全空格失败');

  assertEq(useReplayStore.getState().snapshots.length, 0, '无快照');
});

// ============================================================
// 汇总
// ============================================================
console.log('\n========================================');
console.log(`测试完成: ${passed} 通过, ${failed} 失败`);
if (errors.length > 0) {
  console.error('\n失败列表:');
  errors.forEach(e => console.error(e));
  process.exit(1);
} else {
  console.log('🎉 所有快照功能测试通过！');
  process.exit(0);
}
