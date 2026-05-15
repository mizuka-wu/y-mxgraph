/**
 * iframe bridge 内部变更的 origin 标识。
 * 当 provider 端产生 ydoc-update 时，使用此 origin 标记，
 * 以便 server 端的 UndoManager 能正确追踪来自 iframe 的变更。
 */
export const IFRAME_ORIGIN: object = {};

/**
 * 基线数据标记（用于首次初始化）。
 * 此 origin 的更新不应进入 UndoManager 的撤销栈。
 */
export const BASELINE_ORIGIN: object = {};
