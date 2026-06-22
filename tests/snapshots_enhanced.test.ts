// 快照功能增强版回归测试
// 使用: npx tsx tests/snapshots_enhanced.test.ts
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
    snapLen: s.snapshots.length,
    logLen: s.snapshotLogs.length,
  };
}

function freshSession() {
  const store = useReplayStore.getState();
  store.clearSession();
  store.loadSampleEvents();
}

function createMultipleSnapshots(count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const store = useReplayStore.getState();
    store.stepForward();
    if (i % 2 === 0) {
      const st = useReplayStore.getState();
      const alarm = st.activeAlarms.find(a => a.status === 'active');
      if (alarm) {
        useReplayStore.getState().confirmAlarm(alarm.alarmId, `确认${i}`);
      }
    }
    const r = useReplayStore.getState().saveSnapshot(`测试快照${i + 1}`, `描述${i + 1}`);
    assert(r.success, `保存快照${i + 1}成功`);
    ids.push(r.snapshot!.snapshotId);
  }
  return ids;
}

// ============================================================
// 测试1：单个快照重命名
// ============================================================
test('Enhanced-单个快照重命名', () => {
  freshSession();

  const r = useReplayStore.getState().saveSnapshot('原名', '原描述');
  assert(r.success);
  const id = r.snapshot!.snapshotId;

  const r1 = useReplayStore.getState().renameSnapshot(id, '');
  assert(!r1.success, '空名称被拒绝');
  assert(r1.error?.includes('不能为空'));

  const r2 = useReplayStore.getState().renameSnapshot(id, '   ');
  assert(!r2.success, '全空格被拒绝');

  const r3 = useReplayStore.getState().renameSnapshot(id, '新名称');
  assert(r3.success, '正常重命名成功');
  assertEq(useReplayStore.getState().snapshots.find(x => x.snapshotId === id)?.name, '新名称');

  const r4 = useReplayStore.getState().renameSnapshot(id, '新名称');
  assert(r4.success, '同名重命名直接成功');

  const logs = useReplayStore.getState().snapshotLogs;
  const renameLog = logs.find(l => l.action === 'rename');
  assert(renameLog, '重命名有日志记录');
  assert(renameLog!.snapshotNames[0].includes('原名'), '日志包含原名');
  assert(renameLog!.snapshotNames[0].includes('新名称'), '日志包含新名');
});

// ============================================================
// 测试2：单个快照更新备注
// ============================================================
test('Enhanced-单个快照更新备注', () => {
  freshSession();

  const r = useReplayStore.getState().saveSnapshot('备注测试');
  assert(r.success);
  const id = r.snapshot!.snapshotId;

  const u1 = useReplayStore.getState().updateSnapshotDescription(id, '新的备注描述');
  assert(u1.success);
  assertEq(useReplayStore.getState().snapshots.find(x => x.snapshotId === id)?.description, '新的备注描述');

  const u2 = useReplayStore.getState().updateSnapshotDescription(id, '   ');
  assert(u2.success, '清空备注成功');
  assertEq(useReplayStore.getState().snapshots.find(x => x.snapshotId === id)?.description, undefined);

  const logs = useReplayStore.getState().snapshotLogs;
  const updateLog = logs.find(l => l.action === 'update' && l.detail?.includes('新的备注描述'));
  assert(updateLog, '更新备注有日志');
});

// ============================================================
// 测试3：批量重命名 - 前缀模式
// ============================================================
test('Enhanced-批量重命名_前缀模式', () => {
  freshSession();

  const ids = createMultipleSnapshots(3);

  const result = useReplayStore.getState().batchRenameSnapshots(ids, 'prefix', '[重要]');
  assert(result.success, '批量前缀成功');
  assertEq(result.updatedCount, 3);

  const after = useReplayStore.getState().snapshots;
  for (const snap of after) {
    assert(snap.name.startsWith('[重要]'), `名称应该有前缀: ${snap.name}`);
  }

  const logs = useReplayStore.getState().snapshotLogs;
  const batchLog = logs.find(l => l.action === 'batch_rename');
  assert(batchLog, '批量重命名有日志');
  assertEq(batchLog!.snapshotIds.length, 3);
});

// ============================================================
// 测试4：批量重命名 - 后缀模式
// ============================================================
test('Enhanced-批量重命名_后缀模式', () => {
  freshSession();

  const ids = createMultipleSnapshots(3);

  const result = useReplayStore.getState().batchRenameSnapshots(ids, 'suffix', '-已审核');
  assert(result.success);
  assertEq(result.updatedCount, 3);

  const after = useReplayStore.getState().snapshots;
  for (const snap of after) {
    assert(snap.name.endsWith('-已审核'), `名称应该有后缀: ${snap.name}`);
  }
});

// ============================================================
// 测试5：批量重命名 - 替换模式（带序号）
// ============================================================
test('Enhanced-批量重命名_替换模式带序号', () => {
  freshSession();

  const ids = createMultipleSnapshots(4);

  const result = useReplayStore.getState().batchRenameSnapshots(ids, 'replace', '节点');
  assert(result.success);
  assertEq(result.updatedCount, 4);

  const names = useReplayStore.getState().snapshots.map(x => x.name).sort();
  assertEq(names, ['节点1', '节点2', '节点3', '节点4']);
});

// ============================================================
// 测试6：批量重命名 - 冲突自动追加序号
// ============================================================
test('Enhanced-批量重命名_冲突自动处理', () => {
  freshSession();

  const ids = createMultipleSnapshots(2);
  useReplayStore.getState().saveSnapshot('节点1(1)');

  const result = useReplayStore.getState().batchRenameSnapshots(ids, 'replace', '节点');
  assert(result.success);
  assertEq(result.updatedCount, 2);

  const names = new Set(useReplayStore.getState().snapshots.map(x => x.name));
  assertEq(names.size, 3, '所有名称唯一');
  assert(names.has('节点1'), '包含节点1');
  assert(names.has('节点2'), '包含节点2');
});

// ============================================================
// 测试7：批量更新备注 - 替换/追加/前置
// ============================================================
test('Enhanced-批量更新备注_三种模式', () => {
  freshSession();

  const ids = createMultipleSnapshots(2);

  const r1 = useReplayStore.getState().batchUpdateSnapshotsDescription(ids, '统一备注', 'replace');
  assert(r1.success);
  assertEq(r1.updatedCount, 2);
  for (const snap of useReplayStore.getState().snapshots) {
    assertEq(snap.description, '统一备注');
  }

  const r2 = useReplayStore.getState().batchUpdateSnapshotsDescription(ids, '追加内容', 'append');
  assert(r2.success);
  for (const snap of useReplayStore.getState().snapshots) {
    assert(snap.description?.includes('统一备注 追加内容'), `追加后: ${snap.description}`);
  }

  const r3 = useReplayStore.getState().batchUpdateSnapshotsDescription(ids, '【前置】', 'prepend');
  assert(r3.success);
  for (const snap of useReplayStore.getState().snapshots) {
    assert(snap.description?.startsWith('【前置】'), `前置后: ${snap.description}`);
  }
});

// ============================================================
// 测试8：批量删除
// ============================================================
test('Enhanced-批量删除', () => {
  freshSession();

  const ids = createMultipleSnapshots(5);
  assertEq(useReplayStore.getState().snapshots.length, 5);

  const toDelete = ids.slice(0, 3);
  const result = useReplayStore.getState().batchDeleteSnapshots(toDelete);
  assert(result.success);
  assertEq(result.deletedCount, 3);
  assertEq(useReplayStore.getState().snapshots.length, 2);

  const remaining = useReplayStore.getState().snapshots.map(x => x.snapshotId);
  for (const id of toDelete) {
    assert(!remaining.includes(id), `已删除的ID不应该存在: ${id}`);
  }

  const logs = useReplayStore.getState().snapshotLogs;
  const batchDelLog = logs.find(l => l.action === 'batch_delete');
  assert(batchDelLog, '批量删除有日志');
  assertEq(batchDelLog!.snapshotIds.length, 3);
});

// ============================================================
// 测试9：关键词筛选
// ============================================================
test('Enhanced-关键词筛选_按名称备注操作员', () => {
  freshSession();

  useReplayStore.getState().saveSnapshot('告警演练_A', '核心系统告警处理');
  useReplayStore.getState().saveSnapshot('告警演练_B', '边缘节点测试');
  useReplayStore.getState().saveSnapshot('日常巡检', '常规检查');

  const byName = useReplayStore.getState().filterSnapshots('告警');
  assertEq(byName.length, 2, '按名称筛选告警');

  const byDesc = useReplayStore.getState().filterSnapshots('核心');
  assertEq(byDesc.length, 1, '按备注筛选核心');
  assert(byDesc[0].name === '告警演练_A');

  const byOperator = useReplayStore.getState().filterSnapshots('操作员');
  assert(byOperator.length >= 1, '按操作员筛选');

  const all = useReplayStore.getState().filterSnapshots('');
  assertEq(all.length, 3, '空关键词返回全部');

  const none = useReplayStore.getState().filterSnapshots('不存在的关键词');
  assertEq(none.length, 0, '无匹配返回空');
});

// ============================================================
// 测试10：排序 - 时间和名称
// ============================================================
test('Enhanced-排序_时间和名称', () => {
  freshSession();

  useReplayStore.getState().saveSnapshot('B快照', '');
  useReplayStore.getState().saveSnapshot('A快照', '');
  useReplayStore.getState().saveSnapshot('C快照', '');

  const snaps = useReplayStore.getState().snapshots;

  const byNameAsc = useReplayStore.getState().sortSnapshots(snaps, 'name_asc');
  assertEq(byNameAsc.map(x => x.name), ['A快照', 'B快照', 'C快照']);

  const byNameDesc = useReplayStore.getState().sortSnapshots(snaps, 'name_desc');
  assertEq(byNameDesc.map(x => x.name), ['C快照', 'B快照', 'A快照']);

  const byNewest = useReplayStore.getState().sortSnapshots(snaps, 'newest_first');
  for (let i = 1; i < byNewest.length; i++) {
    assert(byNewest[i - 1].createdAt >= byNewest[i].createdAt, '最新优先排序');
  }

  const byOldest = useReplayStore.getState().sortSnapshots(snaps, 'oldest_first');
  for (let i = 1; i < byOldest.length; i++) {
    assert(byOldest[i - 1].createdAt <= byOldest[i].createdAt, '最早优先排序');
  }
});

// ============================================================
// 测试11：批量导出和导入
// ============================================================
test('Enhanced-批量导出导入往返', () => {
  freshSession();

  createMultipleSnapshots(3);
  const allIds = useReplayStore.getState().snapshots.map(x => x.snapshotId);

  const exportJson = useReplayStore.getState().batchExportSnapshots(allIds);
  assert(exportJson && exportJson.length > 0, '批量导出JSON非空');

  const parsed = JSON.parse(exportJson);
  assertEq(parsed.schemaVersion, 1, '批量版本正确');
  assertEq(parsed.count, 3, '导出数量正确');
  assert(Array.isArray(parsed.snapshots) && parsed.snapshots.length === 3);

  const logs = useReplayStore.getState().snapshotLogs;
  const batchExportLog = logs.find(l => l.action === 'batch_export');
  assert(batchExportLog, '批量导出有日志');

  freshSession();
  assertEq(useReplayStore.getState().snapshots.length, 0, '清空后无快照');

  const result = useReplayStore.getState().importSnapshots(exportJson, 'keep_both');
  assert(result.success, '批量导入成功');
  assertEq(result.importedCount, 3);
  assertEq(useReplayStore.getState().snapshots.length, 3);

  const importedNames = useReplayStore.getState().snapshots.map(x => x.name).sort();
  assert(importedNames.includes('测试快照1'), '导入内容正确');
});

// ============================================================
// 测试12：导入冲突 - 三种策略
// ============================================================
test('Enhanced-导入冲突_三种策略', () => {
  freshSession();

  useReplayStore.getState().saveSnapshot('冲突快照', '本地版本');
  const snapId = useReplayStore.getState().snapshots[0].snapshotId;
  const exportJson = useReplayStore.getState().exportSnapshot(snapId);
  assert(exportJson.length > 0);

  freshSession();
  useReplayStore.getState().saveSnapshot('冲突快照', '新本地版本');

  const check = useReplayStore.getState().checkImportConflicts(exportJson);
  assert(check.success);
  assert(check.hasConflict, '检测到冲突');
  assertEq(check.conflictingNames, ['冲突快照']);

  const resultCancel = useReplayStore.getState().importSnapshots(exportJson, 'cancel');
  assert(!resultCancel.success, '取消策略不导入');
  assertEq(useReplayStore.getState().snapshots.length, 1, '取消后数量不变');

  const resultKeep = useReplayStore.getState().importSnapshots(exportJson, 'keep_both');
  assert(resultKeep.success, '保留两份成功');
  assertEq(useReplayStore.getState().snapshots.length, 2, '保留两份后数量+1');
  const keepNames = useReplayStore.getState().snapshots.map(x => x.name);
  assert(keepNames.includes('冲突快照'), '保留原名');
  const renamedSnap = keepNames.find(n => n.startsWith('冲突快照') && n !== '冲突快照')!;
  assert(renamedSnap, '新名自动生成');
  assert(renamedSnap.includes('(导入 '), '新名包含"导入"标记');
  assert(/\(导入 \d{8}_\d{6}\)/.test(renamedSnap), `新名包含时间戳格式: ${renamedSnap}`);
  assert(resultKeep.renamedMap, '返回renamedMap');
  assertEq(resultKeep.renamedMap!['冲突快照'], renamedSnap, 'renamedMap映射正确');

  const storedSnap = useReplayStore.getState().snapshots.find(s => s.name === renamedSnap);
  assert(storedSnap, '列表中可找到重命名的快照');
  assertEq(storedSnap!.name, renamedSnap, '列表名称与renamedMap一致');

  freshSession();
  useReplayStore.getState().saveSnapshot('冲突快照', '新本地版本');

  const resultOverwrite = useReplayStore.getState().importSnapshots(exportJson, 'overwrite');
  assert(resultOverwrite.success, '覆盖成功');
  assertEq(useReplayStore.getState().snapshots.length, 1, '覆盖后数量不变');
  const overwritten = useReplayStore.getState().snapshots.find(x => x.name === '冲突快照')!;
  assert(overwritten, '覆盖后的快照存在');
  assertEq(overwritten.description, '本地版本', '覆盖后描述为导入版本');
});

// ============================================================
// 测试13：操作日志 - 完整追溯
// ============================================================
test('Enhanced-操作日志_完整追溯', () => {
  freshSession();

  const r1 = useReplayStore.getState().saveSnapshot('日志测试1');
  const r2 = useReplayStore.getState().saveSnapshot('日志测试2');
  assert(r1.success && r2.success);

  const restoreOk = useReplayStore.getState().restoreSnapshot(r1.snapshot!.snapshotId);
  assert(restoreOk);

  const undoOk = useReplayStore.getState().undoRestoreSnapshot();
  assert(undoOk);

  const exportJson = useReplayStore.getState().exportSnapshot(r2.snapshot!.snapshotId);
  assert(exportJson.length > 0);

  useReplayStore.getState().importSnapshots(exportJson, 'keep_both');

  useReplayStore.getState().deleteSnapshot(r2.snapshot!.snapshotId);

  useReplayStore.getState().renameSnapshot(r1.snapshot!.snapshotId, '日志测试改名');

  const logs = useReplayStore.getState().snapshotLogs;
  const actions = logs.map(l => l.action);

  assert(actions.includes('create'), '有创建日志');
  assert(actions.includes('restore'), '有恢复日志');
  assert(actions.includes('undo_restore'), '有撤销恢复日志');
  assert(actions.includes('export'), '有导出日志');
  assert(actions.includes('import'), '有导入日志');
  assert(actions.includes('delete'), '有删除日志');
  assert(actions.includes('rename'), '有重命名日志');

  for (const log of logs) {
    assert(log.logId, '每条日志有ID');
    assert(log.timestamp > 0, '每条日志有时间戳');
    assert(log.operator, '每条日志有操作员');
  }
});

// ============================================================
// 测试14：跨重启持久化 - 快照和日志都保留
// ============================================================
test('Enhanced-跨重启_快照和日志都持久化', () => {
  freshSession();

  createMultipleSnapshots(2);
  const firstId = useReplayStore.getState().snapshots[0].snapshotId;
  useReplayStore.getState().renameSnapshot(firstId, '重命名后的快照');
  const allIds = useReplayStore.getState().snapshots.map(x => x.snapshotId);
  useReplayStore.getState().batchUpdateSnapshotsDescription(allIds, '持久化备注', 'replace');

  useReplayStore.getState().saveSession();

  const snapBefore = useReplayStore.getState().snapshots;
  const logsBefore = useReplayStore.getState().snapshotLogs;
  assert(snapBefore.length > 0);
  assert(logsBefore.length > 0);

  const savedSnapStorage = localStorage.getItem('replay:snapshots');
  const savedLogStorage = localStorage.getItem('replay:snapshotLogs');
  assert(savedSnapStorage, 'localStorage有快照');
  assert(savedLogStorage, 'localStorage有日志');

  const storageBackup: Record<string, string | null> = {};
  Object.values({
    SESSION: 'replay:session',
    EVENTS: 'replay:events',
    RULES: 'replay:rules',
    LAST_EXPORT: 'replay:lastExport',
    SNAPSHOTS: 'replay:snapshots',
    SNAPSHOT_LOGS: 'replay:snapshotLogs',
  }).forEach(key => {
    storageBackup[key] = localStorage.getItem(key);
  });

  freshSession();
  assertEq(useReplayStore.getState().snapshots.length, 0);
  assertEq(useReplayStore.getState().snapshotLogs.length, 0);

  Object.entries(storageBackup).forEach(([key, val]) => {
    if (val !== null) localStorage.setItem(key, val);
  });

  useReplayStore.getState().loadSession();

  const snapAfter = useReplayStore.getState().snapshots;
  const logsAfter = useReplayStore.getState().snapshotLogs;

  assertEq(snapAfter.length, snapBefore.length, '快照数量一致');
  assert(snapAfter.every(s => s.description === '持久化备注'), `备注持久化, 实际: ${snapAfter.map(s => s.description).join(',')}`);
  assert(snapAfter.some(s => s.name === '重命名后的快照'), '重命名持久化');
  assert(logsAfter.length >= logsBefore.length, '日志至少持久化');

  const restoreOk = useReplayStore.getState().restoreSnapshot(snapAfter[0].snapshotId);
  assert(restoreOk, '持久化快照可正常恢复');
});

// ============================================================
// 测试15：损坏文件不污染当前会话
// ============================================================
test('Enhanced-损坏文件_不污染当前会话', () => {
  freshSession();

  useReplayStore.getState().saveSnapshot('基准快照', '基准描述');
  useReplayStore.getState().stepForward();

  const beforeState = captureState();
  const beforeLogs = useReplayStore.getState().snapshotLogs.length;

  const badCases = [
    { name: '完全无效JSON', data: 'this is not json at all!!!' },
    { name: '空对象', data: '{}' },
    { name: '错误schema版本', data: JSON.stringify({ schemaVersion: 999, snapshot: {} }) },
    { name: '缺少events', data: JSON.stringify({
      schemaVersion: 1,
      snapshot: {
        snapshotId: 'x', name: 'x', createdAt: 1, cursor: 1, currentEventIndex: 0,
        events: [], activeAlarms: [], processedEvents: [], pendingEvents: [],
        confirmations: [], rules: [], operator: 'x', startTime: 0, endTime: 100,
      },
    }) },
    { name: '批量格式版本错误', data: JSON.stringify({
      schemaVersion: 5, count: 1, snapshots: [],
    }) },
    { name: '批量中有损坏快照', data: JSON.stringify({
      schemaVersion: 1, count: 1, exportedBy: 't',
      snapshots: [{ name: 'bad', createdAt: 1 }],
    }) },
  ];

  for (const tc of badCases) {
    const result = useReplayStore.getState().importSnapshots(tc.data, 'keep_both');
    assert(!result.success, `${tc.name} 应失败`);
    assert(result.error, `${tc.name} 应有错误信息`);

    const afterState = captureState();
    assertEq(afterState, beforeState, `${tc.name} 不污染快照列表和状态`);
    assertEq(useReplayStore.getState().snapshotLogs.length, beforeLogs, `${tc.name} 不增加错误日志`);
  }
});

// ============================================================
// 测试16：恢复后可撤回（多轮验证）
// ============================================================
test('Enhanced-恢复撤回_多轮验证', () => {
  freshSession();

  useReplayStore.getState().stepForward();
  useReplayStore.getState().stepForward();
  const pointA = captureState();
  const rA = useReplayStore.getState().saveSnapshot('A点');
  assert(rA.success);

  for (let i = 0; i < 5; i++) useReplayStore.getState().stepForward();
  const alarm = useReplayStore.getState().activeAlarms.find(a => a.status === 'active');
  if (alarm) useReplayStore.getState().confirmAlarm(alarm.alarmId, '中间确认');
  useReplayStore.getState().setOperatorNotes('中间状态备注');
  const pointB = captureState();
  const rB = useReplayStore.getState().saveSnapshot('B点');
  assert(rB.success);

  for (let i = 0; i < 3; i++) useReplayStore.getState().stepForward();
  const pointC = captureState();

  assert(pointC.cursor > pointB.cursor && pointB.cursor > pointA.cursor);

  const restoreToA = useReplayStore.getState().restoreSnapshot(rA.snapshot!.snapshotId);
  assert(restoreToA);
  const afterA = captureState();
  assertEq(afterA.cursor, pointA.cursor, '恢复到A点游标正确');
  assert(useReplayStore.getState().preRestoreSnapshot, '恢复后有preRestore');

  const undoToC = useReplayStore.getState().undoRestoreSnapshot();
  assert(undoToC);
  const afterUndoC = captureState();
  assertEq(afterUndoC.cursor, pointC.cursor, '撤回到C点正确');
  assertEq(useReplayStore.getState().preRestoreSnapshot, null, '撤回后preRestore清空');

  const restoreToB = useReplayStore.getState().restoreSnapshot(rB.snapshot!.snapshotId);
  assert(restoreToB);
  const afterB = captureState();
  assertEq(afterB.cursor, pointB.cursor, '恢复到B点正确');
  assertEq(afterB.notes, pointB.notes, 'B点备注正确');

  const undoToC2 = useReplayStore.getState().undoRestoreSnapshot();
  assert(undoToC2);
  const afterUndoC2 = captureState();
  assertEq(afterUndoC2.cursor, pointC.cursor, '再次撤回到C点正确');

  const undoFail = useReplayStore.getState().undoRestoreSnapshot();
  assert(!undoFail, '再次撤销失败');
});

// ============================================================
// 测试17：日志容量限制
// ============================================================
test('Enhanced-日志容量限制_最多保留500条', () => {
  freshSession();

  for (let i = 0; i < 60; i++) {
    useReplayStore.getState().saveSnapshot(`日志容量测试${i}`);
  }

  const logs = useReplayStore.getState().snapshotLogs;
  assert(logs.length <= 500, `日志数量不超过500: ${logs.length}`);

  useReplayStore.getState().saveSession();
  const storedLogs = localStorage.getItem('replay:snapshotLogs');
  const parsed = JSON.parse(storedLogs || '[]');
  assert(parsed.length <= 500, `存储的日志不超过500: ${parsed.length}`);
});

// ============================================================
// 测试18：主流程综合演练
// ============================================================
test('Enhanced-主流程综合演练_完整验证', () => {
  freshSession();
  useReplayStore.getState().setOperatorNotes('开始综合演练');

  const snapIds: string[] = [];
  for (let i = 0; i < 14; i++) {
    useReplayStore.getState().stepForward();
    if (i === 2 || i === 5 || i === 8 || i === 11) {
      const r = useReplayStore.getState().saveSnapshot(`节点${i}`, `第${i}步检查点`);
      assert(r.success);
      snapIds.push(r.snapshot!.snapshotId);
    }
  }
  assertEq(snapIds.length, 4, '保存了4个节点快照');

  useReplayStore.getState().renameSnapshot(snapIds[0], '【关键】节点2');
  useReplayStore.getState().updateSnapshotDescription(snapIds[1], '修改后的节点5描述');

  const batchResult = useReplayStore.getState().batchRenameSnapshots(snapIds.slice(2), 'prefix', '批量_');
  assert(batchResult.success);

  const descResult = useReplayStore.getState().batchUpdateSnapshotsDescription(snapIds, '已审核', 'append');
  assert(descResult.success);
  assertEq(descResult.updatedCount, 4);

  const filtered = useReplayStore.getState().filterSnapshots('关键');
  assertEq(filtered.length, 1, '筛选关键快照');

  const curSnaps = useReplayStore.getState().snapshots;
  const sorted = useReplayStore.getState().sortSnapshots(curSnaps, 'oldest_first');
  for (let i = 1; i < sorted.length; i++) {
    assert(sorted[i - 1].createdAt <= sorted[i].createdAt);
  }

  const exportJson = useReplayStore.getState().batchExportSnapshots(snapIds);
  assert(exportJson.length > 0);

  useReplayStore.getState().saveSession();

  const storageBackup: Record<string, string | null> = {};
  Object.values({
    SESSION: 'replay:session',
    EVENTS: 'replay:events',
    RULES: 'replay:rules',
    LAST_EXPORT: 'replay:lastExport',
    SNAPSHOTS: 'replay:snapshots',
    SNAPSHOT_LOGS: 'replay:snapshotLogs',
  }).forEach(key => {
    storageBackup[key] = localStorage.getItem(key);
  });

  freshSession();

  Object.entries(storageBackup).forEach(([key, val]) => {
    if (val !== null) localStorage.setItem(key, val);
  });

  useReplayStore.getState().loadSession();

  const afterLoadSnaps = useReplayStore.getState().snapshots;
  assertEq(afterLoadSnaps.length, 4, `重启后4个快照, 实际: ${afterLoadSnaps.length}`);
  assert(afterLoadSnaps.some(x => x.name === '【关键】节点2'), '重命名持久化');
  assert(afterLoadSnaps.every(x => x.description?.includes('已审核')), '批量备注持久化');

  for (let i = 0; i < 10; i++) {
    const r = useReplayStore.getState().importSnapshots('not a valid json', 'keep_both');
    assert(!r.success);
  }
  assertEq(useReplayStore.getState().snapshots.length, 4, '多次无效导入不影响');

  const importResult = useReplayStore.getState().importSnapshots(exportJson, 'keep_both');
  assert(importResult.success);
  assert((importResult.importedCount || 0) > 0, '批量导入成功');

  const logs = useReplayStore.getState().snapshotLogs;
  const logActions = logs.map(l => l.action);
  assert(logActions.includes('create'));
  assert(logActions.includes('rename'));
  assert(logActions.includes('update'));
  assert(logActions.includes('batch_rename'));
  assert(logActions.includes('batch_export'));
  assert(logActions.includes('import'));

  const restoreOk = useReplayStore.getState().restoreSnapshot(snapIds[0] || afterLoadSnaps[0].snapshotId);
  assert(restoreOk, '最后验证恢复成功');

  const undoOk = useReplayStore.getState().undoRestoreSnapshot();
  assert(undoOk, '最后验证撤销成功');

  const allSnapIds = useReplayStore.getState().snapshots.map(x => x.snapshotId);
  const batchDel = useReplayStore.getState().batchDeleteSnapshots(allSnapIds);
  assertEq(batchDel.deletedCount, allSnapIds.length, '最后批量删除成功');

  console.log('  📋 主流程最终快照列表:');
  useReplayStore.getState().snapshots.forEach(snap => {
    console.log(`     - ${snap.name} (游标: ${snap.cursor}, 备注: ${snap.description || '(无)'})`);
  });
  console.log(`  📋 最终操作日志条数: ${useReplayStore.getState().snapshotLogs.length}`);
});

// ============================================================
// 测试19：同名导入时间规则命名一致性
// ============================================================
test('Import-同名导入_时间规则命名_提示列表落盘一致', () => {
  freshSession();

  useReplayStore.getState().saveSnapshot('巡检点A', '本地巡检');
  const snapId = useReplayStore.getState().snapshots[0].snapshotId;
  const exportJson = useReplayStore.getState().exportSnapshot(snapId);

  useReplayStore.getState().saveSnapshot('巡检点B', '另一个本地');
  const snapId2 = useReplayStore.getState().snapshots[1].snapshotId;
  const exportJson2 = useReplayStore.getState().exportSnapshot(snapId2);

  freshSession();
  useReplayStore.getState().saveSnapshot('巡检点A', '新本地');
  useReplayStore.getState().saveSnapshot('巡检点B', '另一个新本地');

  const result = useReplayStore.getState().importSnapshots(exportJson, 'keep_both');
  assert(result.success, '导入成功');
  assertEq(result.importedCount, 1, '导入了1个');
  assert(result.renamedMap, '有renamedMap');
  const newNameA = result.renamedMap!['巡检点A'];
  assert(newNameA, '巡检点A被重命名');
  assert(/\(导入 \d{8}_\d{6}\)/.test(newNameA), `新名符合时间格式: ${newNameA}`);

  const storedA = useReplayStore.getState().snapshots.find(s => s.name === newNameA);
  assert(storedA, '列表中存在重命名的快照');
  assertEq(storedA!.description, '本地巡检', '描述来自导入文件');

  const localStorageData = JSON.parse(localStorage.getItem('replay:snapshots') || '[]');
  const storedInLS = localStorageData.find((s: any) => s.name === newNameA);
  assert(storedInLS, 'localStorage中存在重命名的快照');
  assertEq(storedInLS.name, newNameA, 'localStorage名称与返回名称一致');

  const result2 = useReplayStore.getState().importSnapshots(exportJson2, 'keep_both');
  assert(result2.success, '第二个导入成功');
  assert(result2.renamedMap, '第二个有renamedMap');
  const newNameB = result2.renamedMap!['巡检点B'];
  assert(newNameB, '巡检点B被重命名');

  const allNames = useReplayStore.getState().snapshots.map(s => s.name);
  assert(allNames.includes('巡检点A'), '保留原巡检点A');
  assert(allNames.includes('巡检点B'), '保留原巡检点B');
  assert(allNames.includes(newNameA), '列表包含重命名A');
  assert(allNames.includes(newNameB), '列表包含重命名B');

  const uniqueNames = new Set(allNames);
  assertEq(uniqueNames.size, allNames.length, '所有快照名称唯一');
});

// ============================================================
// 测试20：批量导入后排序和搜索一致性
// ============================================================
test('Import-批量导入后_排序搜索一致', () => {
  freshSession();

  useReplayStore.getState().saveSnapshot('Alpha', '第一个');
  useReplayStore.getState().saveSnapshot('Beta', '第二个');

  const ids = useReplayStore.getState().snapshots.map(s => s.snapshotId);
  const exportJson = useReplayStore.getState().batchExportSnapshots(ids);

  freshSession();
  useReplayStore.getState().saveSnapshot('Gamma', '第三个');
  useReplayStore.getState().saveSnapshot('Alpha', '同名Alpha');

  const result = useReplayStore.getState().importSnapshots(exportJson, 'keep_both');
  assert(result.success, '批量导入成功');
  assertEq(result.importedCount, 2, '导入2个');

  const allSnaps = useReplayStore.getState().snapshots;
  assertEq(allSnaps.length, 4, '总共4个');

  const byNameAsc = useReplayStore.getState().sortSnapshots(allSnaps, 'name_asc');
  for (let i = 1; i < byNameAsc.length; i++) {
    assert(byNameAsc[i - 1].name.localeCompare(byNameAsc[i].name, 'zh-CN') <= 0, `名称升序: ${byNameAsc[i - 1].name} <= ${byNameAsc[i].name}`);
  }

  const byNewest = useReplayStore.getState().sortSnapshots(allSnaps, 'newest_first');
  for (let i = 1; i < byNewest.length; i++) {
    assert(byNewest[i - 1].createdAt >= byNewest[i].createdAt, '最新优先排序');
  }

  const searchAlpha = useReplayStore.getState().filterSnapshots('Alpha');
  assert(searchAlpha.length === 2, `搜索Alpha找到2个: 实际${searchAlpha.length}`);
  const alphaNames = searchAlpha.map(s => s.name);
  assert(alphaNames.includes('Alpha'), '搜索结果包含原名Alpha');
  assert(alphaNames.some(n => n.startsWith('Alpha') && n.includes('(导入')), '搜索结果包含重命名的Alpha');

  const renamedName = result.renamedMap!['Alpha'];
  const searchRenamed = useReplayStore.getState().filterSnapshots(renamedName!);
  assert(searchRenamed.length >= 1, '按重命名全名搜索可找到');

  const searchBeta = useReplayStore.getState().filterSnapshots('Beta');
  assertEq(searchBeta.length, 1, '搜索Beta找到1个');

  const searchNone = useReplayStore.getState().filterSnapshots('不存在的名字');
  assertEq(searchNone.length, 0, '搜索不存在的返回空');
});

// ============================================================
// 测试21：导出再导回一致性
// ============================================================
test('Import-导出再导回_名称内容一致', () => {
  freshSession();

  useReplayStore.getState().stepForward();
  useReplayStore.getState().stepForward();
  const r = useReplayStore.getState().saveSnapshot('导出测试', '导出用描述');
  assert(r.success);
  const originalId = r.snapshot!.snapshotId;

  const exportJson = useReplayStore.getState().exportSnapshot(originalId);
  assert(exportJson.length > 0, '导出成功');

  const parsed = JSON.parse(exportJson);
  assertEq(parsed.schemaVersion, 1);
  assertEq(parsed.snapshot.name, '导出测试');
  assertEq(parsed.snapshot.description, '导出用描述');

  freshSession();
  assertEq(useReplayStore.getState().snapshots.length, 0);

  const importResult = useReplayStore.getState().importSnapshots(exportJson, 'keep_both');
  assert(importResult.success, '导回成功');
  assertEq(importResult.importedCount, 1, '导回1个');
  assert(!importResult.renamedMap || Object.keys(importResult.renamedMap).length === 0, '无冲突无重命名');

  const imported = useReplayStore.getState().snapshots[0];
  assertEq(imported.name, '导出测试', '导回名称一致');
  assertEq(imported.description, '导出用描述', '导回描述一致');
  assert(imported.snapshotId !== originalId, '新ID');

  const restoreOk = useReplayStore.getState().restoreSnapshot(imported.snapshotId);
  assert(restoreOk, '导回快照可恢复');

  freshSession();
  useReplayStore.getState().saveSnapshot('导出测试', '冲突版本');
  const conflictImport = useReplayStore.getState().importSnapshots(exportJson, 'keep_both');
  assert(conflictImport.success, '同名导回成功');
  assert(conflictImport.renamedMap, '同名导回有重命名');
  const renamedName = conflictImport.renamedMap!['导出测试'];
  assert(renamedName, '导出测试被重命名');
  assert(renamedName.includes('导出测试'), '重命名保留原名前缀');
  assert(renamedName.includes('(导入 '), '重命名包含导入标记');

  const allSnaps = useReplayStore.getState().snapshots;
  const byName = allSnaps.map(s => s.name);
  assert(byName.includes('导出测试'), '保留原名');
  assert(byName.includes(renamedName), '保留新名');

  const overwrittenSnap = allSnaps.find(s => s.name === renamedName)!;
  assertEq(overwrittenSnap.description, '导出用描述', '重命名快照的内容来自导入文件');
});

// ============================================================
// 测试22：本地重启后重开_导入快照名称持久化
// ============================================================
test('Import-本地重启_导入快照名称持久化', () => {
  freshSession();

  useReplayStore.getState().saveSnapshot('持久化测试', 'v1导出');
  const snapId = useReplayStore.getState().snapshots[0].snapshotId;
  const exportJson = useReplayStore.getState().exportSnapshot(snapId);

  freshSession();
  useReplayStore.getState().saveSnapshot('持久化测试', 'v2本地');

  const importResult = useReplayStore.getState().importSnapshots(exportJson, 'keep_both');
  assert(importResult.success, '导入成功');
  const renamedName = importResult.renamedMap!['持久化测试'];
  assert(renamedName, '有重命名');

  useReplayStore.getState().saveSession();

  const storageBackup: Record<string, string | null> = {};
  Object.values({
    SESSION: 'replay:session',
    EVENTS: 'replay:events',
    RULES: 'replay:rules',
    LAST_EXPORT: 'replay:lastExport',
    SNAPSHOTS: 'replay:snapshots',
    SNAPSHOT_LOGS: 'replay:snapshotLogs',
  }).forEach(key => {
    storageBackup[key] = localStorage.getItem(key);
  });

  const namesBefore = useReplayStore.getState().snapshots.map(s => s.name).sort();
  assert(namesBefore.includes('持久化测试'), '重启前有原名');
  assert(namesBefore.includes(renamedName), '重启前有重命名');

  const origBefore = useReplayStore.getState().snapshots.find(s => s.name === '持久化测试')!;
  assertEq(origBefore.description, 'v2本地', '重启前原名描述正确');
  const renamedBefore = useReplayStore.getState().snapshots.find(s => s.name === renamedName)!;
  assertEq(renamedBefore.description, 'v1导出', '重启前重命名描述正确');

  freshSession();
  assertEq(useReplayStore.getState().snapshots.length, 0, '清空后无快照');

  Object.entries(storageBackup).forEach(([key, val]) => {
    if (val !== null) localStorage.setItem(key, val);
  });

  useReplayStore.getState().loadSession();

  const namesAfter = useReplayStore.getState().snapshots.map(s => s.name).sort();
  assertEq(namesAfter.length, namesBefore.length, '重启后数量一致');
  for (const name of namesBefore) {
    assert(namesAfter.includes(name), `重启后保留名称: ${name}`);
  }

  const originalSnap = useReplayStore.getState().snapshots.find(s => s.name === '持久化测试');
  assertEq(originalSnap!.description, 'v2本地', '重启后原名快照描述正确');

  const renamedSnap = useReplayStore.getState().snapshots.find(s => s.name === renamedName);
  assertEq(renamedSnap!.description, 'v1导出', '重启后重命名快照描述正确');

  const restoreOk = useReplayStore.getState().restoreSnapshot(renamedSnap!.snapshotId);
  assert(restoreOk, '重启后重命名快照可恢复');
});

// ============================================================
// 测试23：多次同名导入_名称递增不冲突
// ============================================================
test('Import-多次同名导入_名称递增不冲突', () => {
  freshSession();

  useReplayStore.getState().saveSnapshot('重复快照', 'v1');
  const snapId = useReplayStore.getState().snapshots[0].snapshotId;
  const exportJson = useReplayStore.getState().exportSnapshot(snapId);

  useReplayStore.getState().saveSnapshot('重复快照', 'v2-local');

  const r1 = useReplayStore.getState().importSnapshots(exportJson, 'keep_both');
  assert(r1.success, '第一次导入成功');
  assert(r1.renamedMap, '第一次有重命名');
  const name1 = r1.renamedMap!['重复快照'];

  const r2 = useReplayStore.getState().importSnapshots(exportJson, 'keep_both');
  assert(r2.success, '第二次导入成功');
  assert(r2.renamedMap, '第二次有重命名');
  const name2 = r2.renamedMap!['重复快照'];

  assert(name1 !== name2, `两次导入新名不同: ${name1} vs ${name2}`);

  const allNames = useReplayStore.getState().snapshots.map(s => s.name);
  const uniqueNames = new Set(allNames);
  assertEq(uniqueNames.size, allNames.length, `所有名称唯一: ${allNames.join(', ')}`);

  assert(allNames.includes('重复快照'), '保留原名');
  assert(allNames.includes(name1), '第一次导入名');
  assert(allNames.includes(name2), '第二次导入名');

  const lsData = JSON.parse(localStorage.getItem('replay:snapshots') || '[]');
  const lsNames = lsData.map((s: any) => s.name);
  for (const name of allNames) {
    assert(lsNames.includes(name), `localStorage包含: ${name}`);
  }
});

// ============================================================
// 测试24：批量导出再批量导回_完整链路
// ============================================================
test('Import-批量导出再导回_完整链路', () => {
  freshSession();

  createMultipleSnapshots(3);
  const allIds = useReplayStore.getState().snapshots.map(s => s.snapshotId);

  const exportJson = useReplayStore.getState().batchExportSnapshots(allIds);

  freshSession();
  createMultipleSnapshots(3);

  const check = useReplayStore.getState().checkImportConflicts(exportJson);
  assert(check.success, '冲突检查成功');
  assert(check.hasConflict, '检测到冲突');
  assert(check.conflictingNames!.length === 3, '3个冲突');

  const result = useReplayStore.getState().importSnapshots(exportJson, 'keep_both');
  assert(result.success, '批量导入成功');
  assertEq(result.importedCount, 3, '导入3个');
  assert(result.renamedMap, '有重命名映射');
  assertEq(Object.keys(result.renamedMap!).length, 3, '3个被重命名');

  const allSnaps = useReplayStore.getState().snapshots;
  assertEq(allSnaps.length, 6, '总共6个');

  for (const [origName, newName] of Object.entries(result.renamedMap!)) {
    const found = allSnaps.find(s => s.name === newName);
    assert(found, `列表包含重命名: ${newName}`);
    assert(found!.name === newName, `列表名与renamedMap一致: ${newName}`);

    const lsData = JSON.parse(localStorage.getItem('replay:snapshots') || '[]');
    const lsFound = lsData.find((s: any) => s.name === newName);
    assert(lsFound, `localStorage包含: ${newName}`);
    assertEq(lsFound.name, newName, `localStorage名与renamedMap一致: ${newName}`);
  }

  const search1 = useReplayStore.getState().filterSnapshots('测试快照');
  assertEq(search1.length, 6, '搜索原名前缀找到所有6个');

  const sorted = useReplayStore.getState().sortSnapshots(allSnaps, 'name_asc');
  for (let i = 1; i < sorted.length; i++) {
    assert(sorted[i - 1].name.localeCompare(sorted[i].name, 'zh-CN') <= 0);
  }
});

// ============================================================
// 汇总
// ============================================================
console.log('\n========================================');
console.log(`增强版测试完成: ${passed} 通过, ${failed} 失败`);
if (errors.length > 0) {
  console.error('\n失败列表:');
  errors.forEach(e => console.error(e));
  process.exit(1);
} else {
  console.log('🎉 所有增强版快照功能测试通过！');
  process.exit(0);
}
