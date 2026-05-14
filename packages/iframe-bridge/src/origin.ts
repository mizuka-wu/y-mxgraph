/**
 * Bridge 同步事务的 origin 标记。
 * 父容器的 UndoManager 使用此标记追踪从子 iframe 同步来的操作。
 */
export const BRIDGE_ORIGIN: object = {};
