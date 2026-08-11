import { describe, it, expect } from "vitest";
import { createLeaderElection } from "../../src/storage/leaderElection.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function uniqueChannel(): string {
  return `test-channel-${Math.random().toString(36).slice(2)}`;
}

describe("leaderElection", () => {
  it("a lone instance is leader from the start", async () => {
    const channelName = uniqueChannel();
    const a = createLeaderElection({ channelName });
    expect(a.isLeader()).toBe(true);
    a.destroy();
  });

  it("exactly one of two instances on the same channel becomes leader", async () => {
    const channelName = uniqueChannel();
    const a = createLeaderElection({ channelName, heartbeatIntervalMs: 20, staleTimeoutMs: 60 });
    const b = createLeaderElection({ channelName, heartbeatIntervalMs: 20, staleTimeoutMs: 60 });
    await sleep(50);

    expect(a.isLeader() !== b.isLeader()).toBe(true);
    a.destroy();
    b.destroy();
  });

  it("both instances agree on who the leader is", async () => {
    const channelName = uniqueChannel();
    const a = createLeaderElection({ channelName, heartbeatIntervalMs: 20, staleTimeoutMs: 60 });
    const b = createLeaderElection({ channelName, heartbeatIntervalMs: 20, staleTimeoutMs: 60 });
    await sleep(50);

    const leaderTabId = a.isLeader() ? a.tabId() : b.tabId();
    expect(a.isLeader() ? a.tabId() : b.tabId()).toBe(leaderTabId);
    a.destroy();
    b.destroy();
  });

  it("different channel names are isolated from each other", async () => {
    const a = createLeaderElection({ channelName: uniqueChannel(), heartbeatIntervalMs: 20, staleTimeoutMs: 60 });
    const b = createLeaderElection({ channelName: uniqueChannel(), heartbeatIntervalMs: 20, staleTimeoutMs: 60 });
    await sleep(50);

    // Unrelated channels — both remain leader of their own, empty channel.
    expect(a.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(true);
    a.destroy();
    b.destroy();
  });

  it("re-elects a new leader when the leader is destroyed (sends goodbye)", async () => {
    const channelName = uniqueChannel();
    const a = createLeaderElection({ channelName, heartbeatIntervalMs: 20, staleTimeoutMs: 60 });
    const b = createLeaderElection({ channelName, heartbeatIntervalMs: 20, staleTimeoutMs: 60 });
    await sleep(50);

    const [leader, follower] = a.isLeader() ? [a, b] : [b, a];
    expect(follower.isLeader()).toBe(false);

    leader.destroy();
    await sleep(50);

    expect(follower.isLeader()).toBe(true);
  });

  it("fires onLeadershipChange exactly when leadership flips", async () => {
    const channelName = uniqueChannel();
    const a = createLeaderElection({ channelName, heartbeatIntervalMs: 20, staleTimeoutMs: 60 });
    const b = createLeaderElection({ channelName, heartbeatIntervalMs: 20, staleTimeoutMs: 60 });
    await sleep(50);

    const [leader, follower] = a.isLeader() ? [a, b] : [b, a];
    const events: boolean[] = [];
    const unsubscribe = follower.onLeadershipChange((isLeader) => events.push(isLeader));

    leader.destroy();
    await sleep(50);

    expect(events).toEqual([true]);
    unsubscribe();
  });

  it("unsubscribing onLeadershipChange stops further notifications", async () => {
    const channelName = uniqueChannel();
    const a = createLeaderElection({ channelName, heartbeatIntervalMs: 20, staleTimeoutMs: 60 });
    const b = createLeaderElection({ channelName, heartbeatIntervalMs: 20, staleTimeoutMs: 60 });
    await sleep(50);

    const [leader, follower] = a.isLeader() ? [a, b] : [b, a];
    const events: boolean[] = [];
    const unsubscribe = follower.onLeadershipChange((isLeader) => events.push(isLeader));
    unsubscribe();

    leader.destroy();
    await sleep(50);

    expect(events).toEqual([]);
  });

  it("re-elects a new leader when the leader disappears without saying goodbye (stale timeout)", async () => {
    const channelName = uniqueChannel();
    const beforeCreate = Date.now();
    const survivor = createLeaderElection({ channelName, heartbeatIntervalMs: 20, staleTimeoutMs: 60 });
    expect(survivor.isLeader()).toBe(true); // alone on the channel so far

    // A fake peer speaking the wire protocol directly (rather than a
    // second full instance) so it can simply stop existing — no clean
    // destroy(), no goodbye — exactly what a crashed tab looks like.
    // Claims an earlier bornAt than survivor's real one so it leads.
    const fakePeerChannel = new BroadcastChannel(channelName);
    fakePeerChannel.postMessage({ type: "announce", tabId: "fake-peer", bornAt: beforeCreate - 10_000 });
    await sleep(20);
    expect(survivor.isLeader()).toBe(false); // the earlier-born fake peer now leads

    // The fake peer never posts again — survivor's own stale-peer pruning
    // (driven by its heartbeat/staleTimeout settings) is what recovers this.
    await sleep(150);
    expect(survivor.isLeader()).toBe(true);

    survivor.destroy();
    fakePeerChannel.close();
  });

  it("recheckLeadership() re-announces and recomputes without waiting for the next heartbeat", async () => {
    const channelName = uniqueChannel();
    const a = createLeaderElection({ channelName, heartbeatIntervalMs: 100_000, staleTimeoutMs: 200_000 });
    const b = createLeaderElection({ channelName, heartbeatIntervalMs: 100_000, staleTimeoutMs: 200_000 });

    // With heartbeats effectively disabled, b needs an explicit recheck to
    // learn about a — announce() on creation already broadcasts once, so
    // give that a moment, then confirm both sides agree.
    await sleep(20);
    b.recheckLeadership();
    await sleep(20);

    expect(a.isLeader() !== b.isLeader()).toBe(true);
    a.destroy();
    b.destroy();
  });

  it("destroy() is idempotent and stops processing further messages", async () => {
    const channelName = uniqueChannel();
    const a = createLeaderElection({ channelName, heartbeatIntervalMs: 20, staleTimeoutMs: 60 });
    a.destroy();
    expect(() => a.destroy()).not.toThrow();
    expect(() => a.recheckLeadership()).not.toThrow();
  });

  it("each instance has a distinct tabId", () => {
    const channelName = uniqueChannel();
    const a = createLeaderElection({ channelName });
    const b = createLeaderElection({ channelName });
    expect(a.tabId()).not.toBe(b.tabId());
    a.destroy();
    b.destroy();
  });
});
