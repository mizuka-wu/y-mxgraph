/**
 * iframe bridge 内部变更的 origin 标识。
 * 当 provider 端产生 ydoc-update 时，使用此 origin 标记，
 * 以便 server 端的 UndoManager 能正确追踪来自 iframe 的变更。
 */
export const IFRAME_ORIGIN: object = {};
