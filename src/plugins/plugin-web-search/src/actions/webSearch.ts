import {
    type ActionResult,
    type HandlerCallback,
    type IAgentRuntime,
    type Memory,
    type State,
    logger,
    Action,
} from "@elizaos/core";
import { TavilyService } from "../services/tavilyService";
import type { SearchResult } from "../types";
import { resolveActionParams, extractString, extractPositiveInt, capQueryLength } from "../actionHelpers";

const DEFAULT_MAX_WEB_SEARCH_CHARS = 16000;

function MaxTokens(
    data: string,
    maxTokens: number = DEFAULT_MAX_WEB_SEARCH_CHARS
): string {
    // Character-based truncation to cap response length
    return data.length > maxTokens ? data.slice(0, maxTokens) : data;
}

export const webSearch: Action = {
    name: "WEB_SEARCH",
    similes: [
        "SEARCH_WEB",
        "INTERNET_SEARCH",
        "LOOKUP",
        "QUERY_WEB",
        "FIND_ONLINE",
        "SEARCH_ENGINE",
        "WEB_LOOKUP",
        "ONLINE_SEARCH",
        "FIND_INFORMATION",
    ],
    suppressInitialMessage: true,
    description:
        "Search the web using Tavily. Supports general web search and finance topics (crypto/DeFi/markets). Use when other actions/providers can't provide accurate or current info.\n\n" +
        "IMPORTANT - Result Quality Check:\n" +
        "- If search returns off-topic or poor results, RETRY with parameter adjustments in the SAME round\n" +
        "- Try: topic='finance' for crypto/markets, source filter (theblock.com, coindesk.com), broader time_range, advanced search_depth, or rephrased query\n" +
        "- For crypto/DeFi content: use topic='finance' + source from [theblock.com, coindesk.com, decrypt.co, dlnews.com]\n" +
        "- Don't give up after one attempt if results are clearly irrelevant",
    
    // Parameter schema for tool calling
    parameters: {
        query: {
            type: "string",
            description: "The search query to look up on the web",
            required: true,
        },
        topic: {
            type: "string",
            description: "Search topic: 'general' for web search, 'finance' for financial/crypto/DeFi content. Defaults to 'general'.",
            required: false,
        },
        source: {
            type: "string",
            description: "Specific source domain to limit results (e.g., 'bloomberg.com', 'reuters.com'). Uses site: operator.",
            required: false,
        },
        max_results: {
            type: "number",
            description: "Maximum number of results to return (1-20). Defaults to 5.",
            required: false,
        },
        search_depth: {
            type: "string",
            description: "Search depth: 'basic' for quick results or 'advanced' for comprehensive search. Defaults to 'basic'.",
            required: false,
        },
        time_range: {
            type: "string",
            description: "Time range filter: 'day', 'week', 'month', 'year' (or 'd', 'w', 'm', 'y')",
            required: false,
        },
        start_date: {
            type: "string",
            description: "Start date filter in YYYY-MM-DD format (returns results after this date)",
            required: false,
        },
        end_date: {
            type: "string",
            description: "End date filter in YYYY-MM-DD format (returns results before this date)",
            required: false,
        },
    },
    
    validate: async (
        runtime: IAgentRuntime,
        _message: Memory,
        _state?: State
    ) => {
        try {
            const service = runtime.getService<TavilyService>("TAVILY");
            return !!service;
        } catch (err) {
            logger.warn("TavilyService not available:", (err as Error).message);
            return false;
        }
    },
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state?: State,
        _options?: { [key: string]: unknown },
        callback?: HandlerCallback
    ): Promise<ActionResult> => {
        try {
            const tavilyService = runtime.getService<TavilyService>("TAVILY");
            if (!tavilyService) {
                throw new Error("TavilyService not initialized");
            }

            const params = await resolveActionParams(runtime, message, _state, "webSearch");

            // Extract query: from params first, then fall back to user's message text
            // (if the LLM chose WEB_SEARCH, the user's message IS the search intent)
            let query = extractString(params?.query);
            if (!query) {
                query = extractString(message.content?.text);
                if (query) {
                    logger.info(`[WEB_SEARCH] No 'query' param from LLM; using message text as query`);
                }
            }
            if (query) {
                query = capQueryLength(query);
            }

            if (!query) {
                const errorMsg = "Missing required parameter 'query'. Please specify what to search for.";
                logger.error(`[WEB_SEARCH] ${errorMsg}`);
                const emptyResult: ActionResult = {
                    text: errorMsg,
                    success: false,
                    error: "missing_required_parameter",
                };
                if (callback) {
                    callback({
                        text: emptyResult.text,
                        content: { error: "missing_required_parameter", details: errorMsg }
                    });
                }
                return emptyResult;
            }

            const source = extractString(params?.source);
            const topic = params?.topic === "finance"
                ? "finance"
                : "general";
            const maxResults = extractPositiveInt(params?.max_results, 1, 20, 5);
            const searchDepth = params?.search_depth === "advanced" ? "advanced" : "basic";

            // Build enhanced query with source if provided
            let enhancedQuery = query;
            if (source) {
                enhancedQuery = `${query} site:${source}`;
                logger.info(`[WEB_SEARCH] Searching with source filter: ${source}`);
            }

            logger.info(`[WEB_SEARCH] Searching for: "${enhancedQuery}" (topic: ${topic})`);

            // Store input parameters for return
            const inputParams = { 
                query,
                topic,
                source,
                max_results: maxResults,
                search_depth: searchDepth,
                time_range: params?.time_range,
                start_date: params?.start_date,
                end_date: params?.end_date,
            };

            // Use provided parameters or defaults
            const searchResponse = await tavilyService.search(enhancedQuery, {
                topic,
                max_results: maxResults,
                search_depth: searchDepth,
                time_range: params?.time_range,
                start_date: params?.start_date,
                end_date: params?.end_date,
                include_answer: true,
                include_images: false,
            });

            if (searchResponse && searchResponse.results.length) {
                const responseList = searchResponse.answer
                    ? `${searchResponse.answer}${
                          Array.isArray(searchResponse.results) &&
                          searchResponse.results.length > 0
                              ? `\n\nFor more details, you can check out these resources:\n${searchResponse.results
                                    .map(
                                        (result: SearchResult, index: number) =>
                                            `${index + 1}. [${result.title}](${result.url})`
                                    )
                                    .join("\n")}`
                              : ""
                      }`
                    : "";

                const result: ActionResult = {
                    text: MaxTokens(responseList, DEFAULT_MAX_WEB_SEARCH_CHARS),
                    success: true,
                    data: searchResponse,
                    input: inputParams,
                } as ActionResult & { input: typeof inputParams };

                if (callback) {
                    callback({ text: result.text, actions: ["WEB_SEARCH"], data: result.data });
                }

                return result;
            }

            const noResult: ActionResult = {
                text: "I couldn't find relevant results for that query.",
                success: false,
                input: inputParams,
            } as ActionResult & { input: typeof inputParams };

            if (callback) {
                callback({ text: noResult.text });
            }
            return noResult;
        } catch (error) {
            const errMsg = error instanceof Error ? error.message : String(error);
            logger.error(`[WEB_SEARCH] Action failed: ${errMsg}`);

            // Best-effort capture of input params for diagnostics
            let failureInputParams: Record<string, unknown> = {};
            try {
                const composedState = await runtime.composeState(message, ["ACTION_STATE"], true);
                const p = composedState?.data?.actionParams || composedState?.data?.webSearch || {};
                failureInputParams = {
                    query: p?.query, topic: p?.topic, source: p?.source,
                    max_results: p?.max_results, search_depth: p?.search_depth,
                    time_range: p?.time_range, start_date: p?.start_date, end_date: p?.end_date,
                };
            } catch (innerErr) {
                logger.warn(`[WEB_SEARCH] Could not capture input params for error report`);
            }

            const errorResult: ActionResult = {
                text: `Web search failed: ${errMsg}`,
                success: false,
                error: errMsg,
                input: failureInputParams,
            } as ActionResult & { input: typeof failureInputParams };

            if (callback) {
                callback({
                    text: errorResult.text,
                    content: { error: "web_search_failed", details: errMsg }
                });
            }
            return errorResult;
        }
    },
    examples: [
        [
            {
                name: "{{user}}",
                content: {
                    text: "Latest Aave news",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Let me search for Aave news from crypto sources:",
                    action: "WEB_SEARCH",
                    actionParams: {
                        query: "Aave protocol",
                        topic: "finance",
                        source: "theblock.com",
                        time_range: "week"
                    }
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "Find the latest news about SpaceX launches.",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here is the latest news about SpaceX launches:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "Can you find details about the iPhone 16 release?",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here are the details I found about the iPhone 16 release:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "What is the schedule for the next FIFA World Cup?",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here is the schedule for the next FIFA World Cup:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: { text: "Check the latest stock price of Tesla." },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here is the latest stock price of Tesla I found:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "What are the current trending movies in the US?",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here are the current trending movies in the US:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: {
                    text: "What is the latest score in the NBA finals?",
                },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here is the latest score from the NBA finals:",
                    action: "WEB_SEARCH",
                },
            },
        ],
        [
            {
                name: "{{user}}",
                content: { text: "When is the next Apple keynote event?" },
            },
            {
                name: "{{agent}}",
                content: {
                    text: "Here is the information about the next Apple keynote event:",
                    action: "WEB_SEARCH",
                },
            },
        ],
    ],
};