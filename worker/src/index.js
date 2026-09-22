const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const MAX_ITEMS = 30;

const DEFAULT_POLICY = Object.freeze({
  version: "2",
  interests: [],
  blockedTopics: [],
  highValueDescription:
    "从标题可以明确看出包含具体事实、知识、方法、步骤、数据、可复用经验或值得深入了解的信息",
  lowValueDescription:
    "标题党、空泛情绪、日常打卡、无上下文的随手发、重复搬运、互动诱导、刻意制造焦虑，或标题没有展示具体信息价值",
  filterAds: true,
  filterCommercial: true,
  thresholds: {
    blocked: 0.8,
    commercial: 0.75,
    veryLowQuality: 0.8,
    lowQuality: 0.6,
    relevance: 0.5,
    relevanceConfidence: 0.35
  }
});

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function cleanString(value, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parsePolicy(raw) {
  if (!raw) return DEFAULT_POLICY;

  let custom;
  try {
    custom = JSON.parse(raw);
  } catch {
    throw new Error("FILTER_POLICY_JSON is not valid JSON");
  }

  const thresholds = custom.thresholds || {};
  return {
    version: cleanString(custom.version, 50) || DEFAULT_POLICY.version,
    interests: Array.isArray(custom.interests)
      ? custom.interests.map((value) => cleanString(value, 200)).filter(Boolean).slice(0, 30)
      : DEFAULT_POLICY.interests,
    blockedTopics: Array.isArray(custom.blockedTopics)
      ? custom.blockedTopics.map((value) => cleanString(value, 200)).filter(Boolean).slice(0, 30)
      : DEFAULT_POLICY.blockedTopics,
    highValueDescription:
      cleanString(custom.highValueDescription, 1000) || DEFAULT_POLICY.highValueDescription,
    lowValueDescription:
      cleanString(custom.lowValueDescription, 1000) || DEFAULT_POLICY.lowValueDescription,
    filterAds: custom.filterAds !== false,
    filterCommercial: custom.filterCommercial !== false,
    thresholds: {
      blocked: clamp(finiteNumber(thresholds.blocked, DEFAULT_POLICY.thresholds.blocked)),
      commercial: clamp(
        finiteNumber(thresholds.commercial, DEFAULT_POLICY.thresholds.commercial)
      ),
      veryLowQuality: clamp(
        finiteNumber(
          thresholds.veryLowQuality,
          DEFAULT_POLICY.thresholds.veryLowQuality
        )
      ),
      lowQuality: clamp(
        finiteNumber(thresholds.lowQuality, DEFAULT_POLICY.thresholds.lowQuality)
      ),
      relevance: clamp(
        finiteNumber(thresholds.relevance, DEFAULT_POLICY.thresholds.relevance)
      ),
      relevanceConfidence: clamp(
        finiteNumber(
          thresholds.relevanceConfidence,
          DEFAULT_POLICY.thresholds.relevanceConfidence
        )
      )
    }
  };
}

function sanitizeItem(item, index) {
  if (!item || typeof item !== "object") return null;

  return {
    key: cleanString(item.key, 40) || String(index),
    title: cleanString(item.title, 300),
    category: cleanString(item.category, 100),
    contentType: cleanString(item.contentType, 30) || "unknown",
    isAds: item.isAds === true
  };
}

function bearerToken(request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function isAuthorized(request, env) {
  return Boolean(env.CLIENT_TOKEN) && bearerToken(request) === env.CLIENT_TOKEN;
}

function buildState(posts, policy) {
  return {
    language: "Chinese social-media titles; judge the supplied text as written",
    evidenceLimit:
      "Judge content only from the title, category, and content type. Do not use or infer author identity. Do not infer unseen image, video, or article content. A vague title that does not demonstrate concrete value should be treated as low-value content.",
    preference: {
      interests: policy.interests.length ? policy.interests : ["No topic preference configured"],
      blockedTopics: policy.blockedTopics.length
        ? policy.blockedTopics
        : ["No blocked topics configured"],
      highValueContent: policy.highValueDescription,
      lowValueContent: policy.lowValueDescription
    },
    posts: posts.map((item) => ({
      title: item.title || "No usable title",
      category: item.category || "Unknown category",
      contentType: item.contentType
    }))
  };
}

function buildQuestions(posts, policy) {
  const questions = {};

  posts.forEach((_post, index) => {
    const target = `Evaluate only \`posts[${index}]\`. Base the answer only on fields present in state.`;

    questions[`relevance_${index}`] = {
      type: "score",
      instructions: `${target} How likely is this post to match the user's interests and high-value-content preference?`,
      criteria: [
        "The title is vague, sensational, purely emotional, routine sharing, or shows no concrete informational value",
        "The title identifies a topic but suggests little specific, reusable, or substantive value",
        "The title clearly promises at least one useful fact, method, explanation, comparison, or concrete experience",
        "The title clearly promises substantial, specific, reusable knowledge or unusually valuable first-hand experience"
      ]
    };

    questions[`low_quality_${index}`] = {
      type: "noul",
      instructions: `${target} Is there strong evidence that this post matches \`preference.lowValueContent\`?`,
      criteria: {
        true: "The available title or metadata provides strong evidence of low-value content",
        false: "The title itself demonstrates concrete informational or practical value"
      }
    };

    if (policy.filterCommercial) {
      questions[`commercial_${index}`] = {
        type: "noul",
        instructions: `${target} Is its primary purpose clearly selling, promotion, lead generation, or disguised advertising?`,
        criteria: {
          true: "Clear commercial promotion, price-led selling, merchant advertising, or lead generation",
          false: "Not primarily commercial, or there is not enough evidence"
        }
      };
    }

    if (policy.blockedTopics.length) {
      questions[`blocked_${index}`] = {
        type: "noul",
        instructions: `${target} Is this post clearly about one or more topics in \`preference.blockedTopics\`?`,
        criteria: {
          true: "The post clearly belongs to a blocked topic",
          false: "It does not, or the title is too ambiguous to establish that"
        }
      };
    }
  });

  return questions;
}

function readNoul(answers, key) {
  const value = answers?.[key]?.noul;
  return clamp(finiteNumber(value, 0));
}

function readScore(answers, key) {
  const answer = answers?.[key] || {};
  return {
    value: clamp(finiteNumber(answer.score, 1.5) / 3),
    confidence: clamp(finiteNumber(answer.confidence, 0))
  };
}

function makeModelDecision(item, index, answers, policy) {
  const relevance = readScore(answers, `relevance_${index}`);
  const lowQuality = readNoul(answers, `low_quality_${index}`);
  const commercial = policy.filterCommercial
    ? readNoul(answers, `commercial_${index}`)
    : 0;
  const blocked = policy.blockedTopics.length
    ? readNoul(answers, `blocked_${index}`)
    : 0;

  const reasonCodes = [];
  if (blocked >= policy.thresholds.blocked) reasonCodes.push("BLOCKED_TOPIC");
  if (commercial >= policy.thresholds.commercial) reasonCodes.push("COMMERCIAL");
  if (lowQuality >= policy.thresholds.veryLowQuality) {
    reasonCodes.push("LOW_QUALITY");
  }
  if (
    lowQuality < policy.thresholds.veryLowQuality &&
    relevance.value <= policy.thresholds.relevance &&
    relevance.confidence >= policy.thresholds.relevanceConfidence &&
    lowQuality >= policy.thresholds.lowQuality
  ) {
    reasonCodes.push("LOW_RELEVANCE_AND_QUALITY");
  }

  const keepScore = clamp(
    relevance.value * 0.65 +
      (1 - lowQuality) * 0.35 -
      commercial * 0.2 -
      blocked * 0.5
  );

  return {
    key: item.key,
    action: reasonCodes.length ? "drop" : "keep",
    keepScore: Number(keepScore.toFixed(4)),
    relevance: Number(relevance.value.toFixed(4)),
    relevanceConfidence: Number(relevance.confidence.toFixed(4)),
    lowQuality: Number(lowQuality.toFixed(4)),
    commercial: Number(commercial.toFixed(4)),
    blocked: Number(blocked.toFixed(4)),
    reasonCodes
  };
}

async function callTypeSafe(posts, policy, env) {
  if (!env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY is not configured");

  const timeoutMs = Math.max(500, Number(env.TYPESAFE_TIMEOUT_MS) || 4500);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(TYPESAFE_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        state: buildState(posts, policy),
        model: env.TYPESAFE_MODEL || "jev-1.13.0",
        questions: buildQuestions(posts, policy)
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(`TypeSafe returned ${response.status}: ${details}`);
    }

    const result = await response.json();
    if (!result || typeof result.answers !== "object") {
      throw new Error("TypeSafe response does not contain answers");
    }
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

async function filterItems(items, policy, env) {
  const decisions = new Array(items.length);
  const modelItems = [];

  items.forEach((item, inputIndex) => {
    if (item.isAds && policy.filterAds) {
      decisions[inputIndex] = {
        key: item.key,
        action: "drop",
        keepScore: 0,
        relevance: 0,
        relevanceConfidence: 1,
        lowQuality: 1,
        commercial: 1,
        blocked: 0,
        reasonCodes: ["AD_FLAG"]
      };
      return;
    }

    if (item.contentType === "live") {
      decisions[inputIndex] = {
        key: item.key,
        action: "drop",
        keepScore: 0,
        relevance: 0,
        relevanceConfidence: 1,
        lowQuality: 1,
        commercial: 0,
        blocked: 0,
        reasonCodes: ["LIVE_CARD"]
      };
      return;
    }

    if (!item.title) {
      decisions[inputIndex] = {
        key: item.key,
        action: "drop",
        keepScore: 0,
        relevance: 0,
        relevanceConfidence: 1,
        lowQuality: 1,
        commercial: 0,
        blocked: 0,
        reasonCodes: ["NO_CONTENT"]
      };
      return;
    }

    modelItems.push({ item, inputIndex });
  });

  let modelResult = null;
  if (modelItems.length) {
    modelResult = await callTypeSafe(
      modelItems.map((entry) => entry.item),
      policy,
      env
    );
    modelItems.forEach((entry, modelIndex) => {
      decisions[entry.inputIndex] = makeModelDecision(
        entry.item,
        modelIndex,
        modelResult.answers,
        policy
      );
    });
  }

  return { decisions, modelResult };
}

async function handleFilter(request, env) {
  if (!isAuthorized(request, env)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  if (!body || !Array.isArray(body.items) || body.items.length > MAX_ITEMS) {
    return json({ error: `items must be an array with at most ${MAX_ITEMS} entries` }, 400);
  }

  const items = body.items.map(sanitizeItem).filter(Boolean);
  if (items.length !== body.items.length) {
    return json({ error: "every item must be an object" }, 400);
  }
  if (new Set(items.map((item) => item.key)).size !== items.length) {
    return json({ error: "item keys must be unique" }, 400);
  }

  let policy;
  try {
    policy = parsePolicy(env.FILTER_POLICY_JSON);
  } catch (error) {
    return json({ error: "invalid_server_policy", message: String(error.message) }, 500);
  }

  const startedAt = Date.now();
  try {
    const { decisions, modelResult } = await filterItems(items, policy, env);
    return json({
      decisions,
      model: modelResult?.model || null,
      policyVersion: policy.version,
      durationMs: Date.now() - startedAt,
      usage: modelResult?.usage || { input_tokens: 0, output_tokens: 0 }
    });
  } catch (error) {
    console.error("Filter request failed", error);
    return json({ error: "filter_failed" }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        model: env.TYPESAFE_MODEL || "jev-1.13.0",
        configured: Boolean(env.TYPESAFE_API_KEY && env.CLIENT_TOKEN)
      });
    }

    if (request.method === "POST" && url.pathname === "/filter") {
      return handleFilter(request, env);
    }

    return json({ error: "not_found" }, 404);
  }
};

export { DEFAULT_POLICY, buildQuestions, buildState, filterItems, parsePolicy };
