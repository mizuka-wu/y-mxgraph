/**
 * 本地修改事务的 origin 标记，供 UndoManager.trackedOrigins 使用。
 * 对外导出，外部创建 Y.UndoManager 时可将其加入 trackedOrigins，
 * 以确保只追踪 binding 内部产生的本地变更。
 */
export const LOCAL_ORIGIN: object = {};
