// Multi-tab safety (spec §6.3). Two tabs share one IndexedDB and will
// corrupt an active session if both write to it. BroadcastChannel-based
// leader election: exactly one tab is "the leader" and owns the active
// session and the sync drain; every other tab is a follower and must go
// read-only. This module only decides who the leader is and tells Layer 3
// when that changes — it does not itself gate any repository write.
//
// Protocol: every instance announces itself and then heartbeats
// periodically. Each instance tracks every peer it's heard from
// (including itself) and computes the leader as the peer with the
// earliest bornAt (tie-broken by tabId for determinism). A peer not heard
// from within staleTimeoutMs is pruned, which is what re-elects on leader
// disappearance (a crashed or force-closed tab never sends `goodbye`).

type Message =
  | { type: "announce"; tabId: string; bornAt: number }
  | { type: "heartbeat"; tabId: string; bornAt: number }
  | { type: "goodbye"; tabId: string };

export interface LeaderElectionOptions {
  channelName?: string;
  heartbeatIntervalMs?: number;
  staleTimeoutMs?: number;
}

export interface LeaderElection {
  isLeader(): boolean;
  tabId(): string;
  // Fires whenever the computed leadership value actually flips — not on
  // every heartbeat. Returns an unsubscribe function.
  onLeadershipChange(listener: (isLeader: boolean) => void): () => void;
  // Exposed so a `visibilitychange` handler (wired by whoever constructs
  // this, since `document` isn't available in every environment this
  // module runs in) can force an immediate re-announce + recompute rather
  // than waiting for the next heartbeat tick.
  recheckLeadership(): void;
  destroy(): void;
}

const DEFAULT_CHANNEL_NAME = "gymxp-leader-election";
const DEFAULT_HEARTBEAT_MS = 2000;
const DEFAULT_STALE_TIMEOUT_MS = 5000;

export function createLeaderElection(options: LeaderElectionOptions = {}): LeaderElection {
  const channelName = options.channelName ?? DEFAULT_CHANNEL_NAME;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_MS;
  const staleTimeoutMs = options.staleTimeoutMs ?? DEFAULT_STALE_TIMEOUT_MS;

  const selfTabId = crypto.randomUUID();
  const selfBornAt = Date.now();
  const peers = new Map<string, { bornAt: number; lastSeen: number }>();
  peers.set(selfTabId, { bornAt: selfBornAt, lastSeen: Date.now() });

  const channel = new BroadcastChannel(channelName);
  const listeners = new Set<(isLeader: boolean) => void>();
  let currentlyLeader = true; // provisionally true until the first peer is heard from
  let destroyed = false;

  function computeLeaderTabId(): string {
    let leaderId: string = selfTabId;
    let leaderBornAt = peers.get(selfTabId)!.bornAt;
    for (const [tabId, info] of peers) {
      if (info.bornAt < leaderBornAt || (info.bornAt === leaderBornAt && tabId < leaderId)) {
        leaderId = tabId;
        leaderBornAt = info.bornAt;
      }
    }
    return leaderId;
  }

  function recompute(): void {
    const isLeaderNow = computeLeaderTabId() === selfTabId;
    if (isLeaderNow !== currentlyLeader) {
      currentlyLeader = isLeaderNow;
      for (const listener of listeners) listener(currentlyLeader);
    }
  }

  function pruneStale(): void {
    const cutoff = Date.now() - staleTimeoutMs;
    let changed = false;
    for (const [tabId, info] of peers) {
      if (tabId !== selfTabId && info.lastSeen < cutoff) {
        peers.delete(tabId);
        changed = true;
      }
    }
    if (changed) recompute();
  }

  channel.onmessage = (event: MessageEvent<Message>) => {
    const msg = event.data;
    if (msg.tabId === selfTabId) return;

    if (msg.type === "goodbye") {
      peers.delete(msg.tabId);
      recompute();
      return;
    }

    const isNewPeer = !peers.has(msg.tabId);
    peers.set(msg.tabId, { bornAt: msg.bornAt, lastSeen: Date.now() });
    recompute();

    // A peer's `announce` only reaches instances already listening at the
    // moment it's sent — a tab that opens later than another tab's most
    // recent broadcast would otherwise not learn about it until that
    // peer's next heartbeat (up to heartbeatIntervalMs away). Replying
    // immediately to a newly-seen announce makes discovery bidirectional
    // and near-instant instead.
    if (msg.type === "announce" && isNewPeer) {
      announce();
    }
  };

  function announce(): void {
    channel.postMessage({ type: "announce", tabId: selfTabId, bornAt: selfBornAt } satisfies Message);
  }

  announce();
  recompute();

  const heartbeatTimer = setInterval(() => {
    channel.postMessage({ type: "heartbeat", tabId: selfTabId, bornAt: selfBornAt } satisfies Message);
    pruneStale();
  }, heartbeatIntervalMs);
  // Node keeps the process alive for a pending interval; this module can
  // run in Node (tests, or a future non-browser host) where that's
  // undesirable. No-op in browsers, where timers don't have `.unref()`.
  (heartbeatTimer as unknown as { unref?: () => void }).unref?.();

  return {
    isLeader() {
      return currentlyLeader;
    },
    tabId() {
      return selfTabId;
    },
    onLeadershipChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    recheckLeadership() {
      if (destroyed) return;
      peers.set(selfTabId, { bornAt: selfBornAt, lastSeen: Date.now() });
      announce();
      pruneStale();
      recompute();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearInterval(heartbeatTimer);
      channel.postMessage({ type: "goodbye", tabId: selfTabId } satisfies Message);
      channel.close();
      listeners.clear();
    },
  };
}
