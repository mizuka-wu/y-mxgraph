export {};

declare global {
  // 最小 mxGraph / Editor 依赖占位，避免 TS 报错（后续可细化）
  class mxEventSource {
    constructor();
    addListener(name: string, fn: (sender: any, evt?: any) => void): void;
    fireEvent(evt: any): void;
    removeListener?(name: string, fn: any): void;
  }
  class mxEventObject {
    constructor(name: string, ...args: any[]);
    getProperty(name: string): any;
  }
  const mxEvent: any;
  const mxUtils: any;
  const mxResources: any;
  const mxClient: any;
  const EditorUi: any;
  const Editor: any;
  const Graph: any;
  const P2PCollab: any;

  interface DrawioFileStats {
    opened: number;
    merged: number;
    fileMerged: number;
    fileReloaded: number;
    conflicts: number;
    timeouts: number;
    saved: number;
    closed: number;
    destroyed: number;
    joined: number;
    checksumErrors: number;
    bytesSent: number;
    bytesReceived: number;
    msgSent: number;
    msgReceived: number;
    cacheHits: number;
    cacheMiss: number;
    cacheFail: number;
  }

  class DrawioFile extends mxEventSource {
    // 静态字段
    static SYNC: string;
    static LAST_WRITE_WINS: boolean;
    static RESTRICT_EXPORT: boolean;

    // 重要实例字段
    ui: any;
    data: string | null;
    initialData: string | null;
    created: number;
    stats: DrawioFileStats;

    autosaveDelay: number;
    maxAutosaveDelay: number;
    optimisticSyncDelay: number;
    autosaveThread: any;
    lastAutosave: number | null;
    lastSaved: number | null;
    lastChanged: number | null;

    opened: any;
    modified: boolean;
    shadowModified: boolean;
    shadowPages: any[] | null;
    changeListenerEnabled: boolean;
    lastAutosaveRevision: any;
    maxAutosaveRevisionDelay: number;
    inConflictState: boolean;
    invalidChecksum: boolean;
    ageStart: number | null;

    sync?: DrawioFileSync | null;
    ownPages?: any[] | null;
    theirPages?: any[] | null;

    constructor(ui: any, data?: string);

    // 数据
    setData(data: string): void;
    getData(): string | null;
    getSize(): number;

    // Shadow 页
    getShadowPages(): any[];
    setShadowPages(pages: any[] | null): void;

    // Patch / 合并 / 刷新
    patch(
      patches: any[],
      resolver?: any,
      undoable?: boolean,
      skipRealtimeUpdate?: boolean
    ): any[];
    ignorePatches(patches: any[] | null): boolean;
    mergeFile(
      latest: DrawioFile,
      onSuccess?: () => void,
      onError?: (e: any) => void,
      shadow?: any,
      immediate?: boolean
    ): void;
    reloadFile(onSuccess?: () => void, onError?: (e: any) => void): void;
    synchronizeFile(onSuccess?: () => void, onError?: (e: any) => void): void;
    updateFile(
      onSuccess?: () => void,
      onError?: (e: any) => void,
      guard?: () => boolean,
      shadow?: any,
      immediate?: boolean
    ): void;

    // 描述符（descriptor）
    loadDescriptor(cb: (desc: any) => void, err?: (e: any) => void): void;
    loadPatchDescriptor(cb: (desc: any) => void, err?: (e: any) => void): void;
    patchDescriptor(desc: any, fromDesc: any): void;
    getDescriptor(): any;
    setDescriptor(desc: any): void;
    setDescriptorRevisionId(desc: any, rev: any): void;
    getDescriptorRevisionId(desc: any): any;
    setDescriptorEtag(desc: any, etag: any): void;
    getDescriptorEtag(desc: any): any;
    getDescriptorSecret(desc: any): string | null;
    getDescriptorChecksum(desc: any): string | null;

    // 版本
    getLatestVersion(
      cb: (file: DrawioFile | null) => void,
      err?: (e: any) => void
    ): void;
    getLatestVersionId(cb: (id: any) => void, err?: (e: any) => void): void;
    getLastModifiedDate(): Date;
    setCurrentRevisionId(id: any): void;
    getCurrentRevisionId(): any;
    setCurrentEtag(etag: any): void;
    getCurrentEtag(): any;

    // 保存
    save(
      revision?: any,
      onSuccess?: () => void,
      onError?: (e: any) => void,
      unloading?: boolean,
      overwrite?: boolean,
      manual?: boolean
    ): void;
    saveAs(
      name?: string,
      onSuccess?: () => void,
      onError?: (e: any) => void
    ): void;
    saveFile(
      onSuccess?: () => void,
      onError?: (e: any) => void,
      unloading?: boolean,
      overwrite?: boolean
    ): void;
    createData(): string;
    updateFileData(): void;

    // 状态
    isEditable(): boolean;
    isModified(): boolean;
    setModified(m: boolean): void;
    getShadowModified(): boolean;
    setShadowModified(m: boolean): void;

    // 同步 / 实时
    isPolling(): boolean;
    getPollingInterval(): number;
    isSyncSupported(): boolean;
    startSync(): void;
    isRealtime(): boolean;
    isRealtimeSupported(): boolean;
    isRealtimeEnabled(): boolean;
    setRealtimeEnabled(): void;
    isRealtimeOptional(): boolean;
    getRealtimeState(): number;
    getRealtimeError(): any;
    isOptimisticSync(): boolean;

    // 通道 / 用户
    getChannelId(): string;
    getChannelKey(id?: string): string | null;
    getCurrentUser(): { id: string; displayName?: string } | null;

    // UI 相关
    open(): void;
    installListeners(): void;
    addAllSavedStatus(text?: string): void;

    // 其他
    getHash(): string;
    getId(): string;
    getTitle(): string;
    isAutosaveOptional(): boolean;
    isAutosave(): boolean;
    isRenamable(): boolean;
    rename(name: string, success?: () => void, fail?: (e: any) => void): void;
    isMovable(): boolean;
    isTrashed(): boolean;
    move(folder: any, success?: () => void, fail?: (e: any) => void): void;
    getFileUrl(): string | null;
    getFolderUrl(publicUrl?: boolean): string | null;
    getPublicUrl(cb: (url: string | null) => void): void;
    isRestricted(): boolean;
    addConflictStatus(msg?: string, click?: () => void): void;
    setConflictStatus(msg: string, click?: () => void): void;
    addUnsavedStatus(err?: any): void;
    saveDraft(data?: string): void;
    removeDraft(): void;
  }

  class DrawioFileSync extends mxEventSource {
    // 静态字段
    static PROTOCOL: number;
    static ENABLE_SOCKETS: boolean;

    // 实例字段
    file: DrawioFile;
    ui: any;
    channelId: string | null;
    channel: any;
    key?: string | null;
    pusher?: any;
    p2pCollab?: any;
    enabled: boolean;

    lastModified?: Date;
    lastMessage?: string | null;
    lastMessageModified?: Date | null;
    lastActivity: number;

    cleanupThread?: any;
    updateStatusThread?: any;
    reloadThread?: any;

    clientId: string;
    syncChangeCounter: number;
    catchupRetryCount: number;
    maxCatchupRetries: number;

    maxCacheEntrySize: number;
    maxSyncMessageSize: number;
    syncSendMessageDelay: number;
    syncReceiveMessageDelay: number;
    cleanupDelay: number;
    maxCacheReadyRetries: number;
    cacheReadyDelay: number;
    maxOptimisticRetries: number;
    inactivityTimeoutSeconds: number;

    constructor(file: DrawioFile);

    // 生命周期 / 连接
    start(): void;
    stop(): void;
    destroy(): void;
    isConnected(): boolean;
    updateOnlineState(): void;
    updateStatus(): void;
    resetUpdateStatusThread(): void;
    installListeners(): void;

    // 实时
    updateRealtime(): void;
    initRealtime(): void;
    resetRealtime(): void;
    isRealtimeActive(): boolean;

    // 消息/变更
    notify(message: any): void;
    sendJoinMessage(): void;
    createMessage(data: any): { v: number; d: any; c: string };
    objectToString(obj: any): string;
    stringToObject(s: string): any;
    fileSaving(): void;
    fileDataUpdated(): void;
    fileSaved(
      pages: any[],
      desc: any,
      onSuccess?: () => void,
      onError?: (e: any) => void,
      token?: string,
      checksum?: string
    ): void;

    // 同步流程
    fileChangedNotify(data?: any, immediate?: boolean): void;
    fileChanged(
      onOk?: (upToDate?: boolean) => void,
      onError?: (e: any) => void,
      guard?: () => boolean,
      lazy?: boolean,
      immediate?: boolean
    ): any;
    optimisticSync(attempt?: number): void;

    // 本地/远端变化
    localFileChanged(): void;
    sendLocalChanges(): void;
    doSendLocalChanges(changes: any[]): void;
    receiveRemoteChanges(msg: { c: any[]; id: string; t: number }): void;
    doReceiveRemoteChanges(changes: any[]): void;

    // Patch 辅助
    extractLocal(patch: any): any;
    extractRemove(patch: any): any;
    patchRealtime(
      patches: any[],
      backup?: any,
      ownPending?: any,
      immediate?: boolean
    ): any | null;

    // 合并 / 追赶 / 重载
    merge(
      patches: any[],
      checksum: string | null,
      desc: any,
      onSuccess?: (ok?: boolean) => void,
      onError?: (e: any) => void,
      guard?: () => boolean,
      immediate?: boolean
    ): void;
    fastForward(desc: any): void;
    reloadDescriptor(): void;
    updateDescriptor(desc: any): void;
    catchup(
      desc: any,
      onSuccess?: (ok?: boolean) => void,
      onError?: (e: any) => void,
      guard?: () => boolean,
      immediate?: boolean
    ): void;
    reload(
      onSuccess?: () => void,
      onError?: (e: any) => void,
      guard?: () => boolean,
      shadow?: any,
      immediate?: boolean
    ): void;
    descriptorChanged(fromRev: any): void;
    getIdParameters(): string;
    fileConflict(
      desc: any,
      onSuccess?: (ok?: boolean) => void,
      onError?: (e: any) => void
    ): void;

    // 维护
    scheduleCleanup(lazy?: boolean | null): void;
    cleanup(
      done?: (() => void) | null,
      onError?: (e: any) => void,
      checkFile?: boolean
    ): void;
    testChecksum(): void;
  }
}
