/**
 * 本地修改事务的 origin 标记，供 UndoManager.trackedOrigins 使用。
 * 对外导出，外部创建 Y.UndoManager 时可将其加入 trackedOrigins，
 * 以确保本地修改能正确进入撤销栈。
 */
export const LOCAL_ORIGIN: object = {};

/**
 * 完整性自愈事务的 origin 标记。
 * 不加入 trackedOrigins，自愈操作不进撤销栈。
 */
export const INTEGRITY_ORIGIN: object = {};
