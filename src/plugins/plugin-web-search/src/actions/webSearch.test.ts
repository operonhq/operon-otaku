/**
 * Tests for WEB_SEARCH action handler parameter resolution.
 *
 * Covers the 3-source priority chain (state > message.content > composeState)
 * and the message-text fallback when all param sources lack a `query`.
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";
import type { IAgentRuntime, Memory, State, ActionResult } from "@elizaos/core";
import { webSearch } from "./webSearch";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Tavily service stub that records the query it receives. */
function makeTavilyStub() {
  const calls: string[] = [];
  return {
    calls,
    search: mock(async (query: string) => {
      calls.push(query);
      return {
        answer: `Results for: ${query}`,
        results: [{ title: "Test", url: "https://example.com", content: "" }],
      };
    }),
  };
}

function makeRuntime(tavilyStub: ReturnType<typeof makeTavilyStub>) {
  return {
    getService: mock((name: string) => (name === "TAVILY" ? tavilyStub : null)),
    composeState: mock(async () => ({ values: {}, data: {}, text: "" } as State)),
  } as unknown as IAgentRuntime;
}

function makeMessage(text = "What is the price of ETH?"): Memory {
  return {
    id: "test-msg-id",
    entityId: "test-entity",
    roomId: "test-room",
    content: { text },
    createdAt: Date.now(),
  } as unknown as Memory;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WEB_SEARCH param resolution", () => {
  let tavily: ReturnType<typeof makeTavilyStub>;
  let runtime: IAgentRuntime;
  let message: Memory;
  const cb = mock(async () => []);

  beforeEach(() => {
    tavily = makeTavilyStub();
    runtime = makeRuntime(tavily);
    message = makeMessage();
  });

  // ---- Source 1: _state.data.actionParams ----

  it("reads query from _state.data.actionParams (highest priority)", async () => {
    const state = {
      values: {},
      data: { actionParams: { query: "state-level query" } },
      text: "",
    } as unknown as State;

    const result = (await webSearch.handler!(
      runtime, message, state, {}, cb,
    )) as ActionResult;

    expect(result.success).toBe(true);
    expect(tavily.calls[0]).toBe("state-level query");
    // Should NOT call composeState when state params are present
    expect((runtime.composeState as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  // ---- Source 2: message.content.actionParams ----

  it("reads query from message.content.actionParams when state has none", async () => {
    (message.content as Record<string, unknown>).actionParams = { query: "content-level query" };
    const state = { values: {}, data: {}, text: "" } as unknown as State;

    const result = (await webSearch.handler!(
      runtime, message, state, {}, cb,
    )) as ActionResult;

    expect(result.success).toBe(true);
    expect(tavily.calls[0]).toBe("content-level query");
    expect((runtime.composeState as ReturnType<typeof mock>).mock.calls.length).toBe(0);
  });

  // ---- Source 3: composeState fallback ----

  it("falls back to composeState when state and content have no params", async () => {
    (runtime.composeState as ReturnType<typeof mock>).mockImplementation(async () => ({
      values: {},
      data: { actionParams: { query: "composed-level query" } },
      text: "",
    }));
    const state = { values: {}, data: {}, text: "" } as unknown as State;

    const result = (await webSearch.handler!(
      runtime, message, state, {}, cb,
    )) as ActionResult;

    expect(result.success).toBe(true);
    expect(tavily.calls[0]).toBe("composed-level query");
    expect((runtime.composeState as ReturnType<typeof mock>).mock.calls.length).toBe(1);
  });

  // ---- Priority: state wins over content ----

  it("state params take priority over content params", async () => {
    (message.content as Record<string, unknown>).actionParams = { query: "content query" };
    const state = {
      values: {},
      data: { actionParams: { query: "state query" } },
      text: "",
    } as unknown as State;

    const result = (await webSearch.handler!(
      runtime, message, state, {}, cb,
    )) as ActionResult;

    expect(result.success).toBe(true);
    expect(tavily.calls[0]).toBe("state query");
  });

  // ---- Message text fallback ----

  it("falls back to message.content.text when no param source has query", async () => {
    const msg = makeMessage("What's the cheapest way to swap ETH to USDC?");
    const state = { values: {}, data: {}, text: "" } as unknown as State;

    const result = (await webSearch.handler!(
      runtime, msg, state, {}, cb,
    )) as ActionResult;

    expect(result.success).toBe(true);
    expect(tavily.calls[0]).toBe("What's the cheapest way to swap ETH to USDC?");
  });

  it("falls back to message text when params exist but query is empty string", async () => {
    const msg = makeMessage("Compare Aave and Compound yields");
    const state = {
      values: {},
      data: { actionParams: { query: "  ", topic: "finance" } },
      text: "",
    } as unknown as State;

    const result = (await webSearch.handler!(
      runtime, msg, state, {}, cb,
    )) as ActionResult;

    expect(result.success).toBe(true);
    expect(tavily.calls[0]).toBe("Compare Aave and Compound yields");
  });

  // ---- Hard failure: no query anywhere ----

  it("returns missing_required_parameter when no query and no message text", async () => {
    const msg = makeMessage("");
    const state = { values: {}, data: {}, text: "" } as unknown as State;

    const result = (await webSearch.handler!(
      runtime, msg, state, {}, cb,
    )) as ActionResult;

    expect(result.success).toBe(false);
    expect(result.error).toBe("missing_required_parameter");
  });

  // ---- Extra params flow through ----

  it("passes topic and source params alongside query", async () => {
    const state = {
      values: {},
      data: {
        actionParams: {
          query: "Aave protocol",
          topic: "finance",
          source: "theblock.com",
        },
      },
      text: "",
    } as unknown as State;

    const result = (await webSearch.handler!(
      runtime, message, state, {}, cb,
    )) as ActionResult;

    expect(result.success).toBe(true);
    // source appends site: operator
    expect(tavily.calls[0]).toBe("Aave protocol site:theblock.com");
  });
});
