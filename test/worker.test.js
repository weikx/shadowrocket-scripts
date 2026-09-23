import assert from "node:assert/strict";
import test from "node:test";

import worker, { buildQuestions, parsePolicy } from "../worker/src/index.js";

const baseEnv = {
  CLIENT_TOKEN: "client-secret",
  TYPESAFE_API_KEY: "typesafe-secret",
  TYPESAFE_MODEL: "jev-1.13.0",
  TYPESAFE_TIMEOUT_MS: "2000"
};

function filterRequest(items, token = "client-secret") {
  return new Request("https://example.workers.dev/filter", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ items })
  });
}

const signalAnswerNames = [
  "commercial",
  "conflict_bait",
  "polarization",
  "emotional_venting",
  "negative_noise",
  "engagement_bait"
];
const preserveAnswerNames = [
  "experience_sharing",
  "lifestyle_sharing",
  "photography_sharing"
];

function modelAnswers(index, options = {}) {
  const answers = {
    [`content_value_${index}`]: {
      type: "score",
      score: options.contentValue ?? 2.7,
      confidence: options.contentValueConfidence ?? 0.9
    }
  };
  signalAnswerNames.forEach((name) => {
    answers[`${name}_${index}`] = {
      type: "noul",
      noul: options[name] ?? 0.05
    };
  });
  preserveAnswerNames.forEach((name) => {
    answers[`${name}_${index}`] = {
      type: "noul",
      noul: options[name] ?? 0.05
    };
  });
  if (options.blocked !== undefined) {
    answers[`blocked_${index}`] = { type: "noul", noul: options.blocked };
  }
  return answers;
}

test("health endpoint reports whether secrets are configured", async () => {
  const response = await worker.fetch(
    new Request("https://example.workers.dev/health"),
    baseEnv
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    model: "jev-1.13.0",
    configured: true
  });
});

test("filter endpoint rejects an invalid client token", async () => {
  const response = await worker.fetch(filterRequest([], "wrong-token"), baseEnv);
  assert.equal(response.status, 401);
});

test("filter endpoint rejects duplicate item keys", async () => {
  const response = await worker.fetch(
    filterRequest([
      { key: "0", title: "第一条" },
      { key: "0", title: "第二条" }
    ]),
    baseEnv
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "item keys must be unique" });
});

test("questions are atomic and include the post index in instructions", () => {
  const policy = parsePolicy();
  const questions = buildQuestions(
    [
      {
        title: "测试",
        content: "正文",
        author: "作者",
        category: "科技",
        contentType: "normal"
      }
    ],
    policy
  );
  assert.deepEqual(Object.keys(questions), [
    "content_value_0",
    "commercial_0",
    "conflict_bait_0",
    "polarization_0",
    "emotional_venting_0",
    "experience_sharing_0",
    "lifestyle_sharing_0",
    "photography_sharing_0"
  ]);
  assert.match(JSON.stringify(questions.content_value_0.instructions), /posts\[0\]/);
  assert.match(JSON.stringify(questions.content_value_0.instructions), /title/);
  assert.match(JSON.stringify(questions.content_value_0.instructions), /content/);
  assert.equal(questions.content_value_0.type, "score");
  assert.equal(questions.content_value_0.criteria.length, 4);
  assert.equal(questions.commercial_0.type, "noul");
  assert.deepEqual(Object.keys(questions.commercial_0.criteria), ["true", "false"]);
  assert.equal(questions.experience_sharing_0.type, "noul");
});

test("strict defaults remove live cards and never send author names to Jev", async (t) => {
  let callCount = 0;
  let requestPayload;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    callCount += 1;
    requestPayload = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: {
          ...modelAnswers(0, {
            contentValue: 0.3,
            engagement_bait: 0.8
          }),
          ...modelAnswers(1, { contentValue: 2.8 }),
          ...modelAnswers(2, {
            contentValue: 2.6,
            contentValueConfidence: 0.85
          })
        },
        usage: { input_tokens: 100, output_tokens: 20 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await worker.fetch(
    filterRequest([
      { key: "0", title: "商品限时特价", contentType: "normal", isAds: true },
      { key: "1", title: "哈哈哈哈", content: "", contentType: "normal", isAds: false },
      {
        key: "2",
        title: "如何排查 Node.js 内存泄漏",
        content: "包含定位泄漏对象、对比快照和验证修复的具体步骤。",
        contentType: "normal",
        isAds: false
      },
      { key: "3", title: "直播中", contentType: "live", isAds: false },
      {
        key: "4",
        title: "",
        content: "没有标题，但正文提供了完整的操作步骤和结果。",
        contentType: "normal",
        isAds: false
      },
      { key: "5", title: "", content: "", contentType: "normal", isAds: false }
    ]),
    baseEnv
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(callCount, 1);
  assert.equal(requestPayload.state.posts.length, 3);
  assert.equal("author" in requestPayload.state.posts[0], false);
  assert.doesNotMatch(JSON.stringify(requestPayload.state), /作者/);
  assert.equal(requestPayload.state.posts[1].content, "包含定位泄漏对象、对比快照和验证修复的具体步骤。");
  assert.deepEqual(requestPayload.state.posts[2], {
    title: "",
    content: "没有标题，但正文提供了完整的操作步骤和结果。",
    category: "Unknown category",
    contentType: "normal"
  });
  assert.equal(Object.keys(requestPayload.questions).length, 24);
  assert.deepEqual(
    result.decisions.map(({ key, action, reasonCodes }) => ({ key, action, reasonCodes })),
    [
      { key: "0", action: "drop", reasonCodes: ["AD_FLAG"] },
      {
        key: "1",
        action: "keep",
        reasonCodes: []
      },
      { key: "2", action: "keep", reasonCodes: [] },
      { key: "3", action: "drop", reasonCodes: ["LIVE_CARD"] },
      { key: "4", action: "keep", reasonCodes: [] },
      { key: "5", action: "keep", reasonCodes: [] }
    ]
  );
});

test("focused defaults only enable the requested removal categories", () => {
  const policy = parsePolicy();
  assert.equal(policy.version, "6");
  assert.equal(policy.enabledSignals.commercial, true);
  assert.equal(policy.enabledSignals.conflictBait, true);
  assert.equal(policy.enabledSignals.polarization, true);
  assert.equal(policy.enabledSignals.emotionalVenting, true);
  assert.equal(policy.enabledSignals.negativeNoise, false);
  assert.equal(policy.enabledSignals.engagementBait, false);
  assert.equal(policy.thresholds.commercial, 0.8);
  assert.equal(policy.thresholds.conflictBait, 0.82);
  assert.equal(policy.thresholds.polarization, 0.82);
  assert.equal(policy.thresholds.emotionalVenting, 0.88);
  assert.equal(policy.thresholds.negativeNoise, 0.8);
  assert.equal(policy.thresholds.engagementBait, 0.75);
  assert.equal(policy.thresholds.experienceSharing, 0.55);
  assert.equal(policy.thresholds.lifestyleSharing, 0.6);
  assert.equal(policy.thresholds.photographySharing, 0.6);
  assert.equal(policy.thresholds.maxContentValueForDrop, 0.4);
  assert.equal(policy.thresholds.minContentValueConfidence, 0.6);
});

test("legacy relevance threshold names remain compatible", () => {
  const policy = parsePolicy(
    JSON.stringify({ thresholds: { relevance: 0.4, relevanceConfidence: 0.6 } })
  );
  assert.equal(policy.thresholds.maxContentValueForDrop, 0.4);
  assert.equal(policy.thresholds.minContentValueConfidence, 0.6);
});

test("negative topics are kept when they contain reliable information", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: modelAnswers(0, {
          contentValue: 2.8,
          contentValueConfidence: 0.9,
          emotional_venting: 0.92,
          negative_noise: 0.95,
          engagement_bait: 0.88
        }),
        usage: { input_tokens: 100, output_tokens: 20 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await worker.fetch(
    filterRequest([
      {
        key: "0",
        title: "新型诈骗高发",
        content: "列出诈骗步骤、警方数据和三个核验方法。",
        contentType: "normal",
        isAds: false
      }
    ]),
    baseEnv
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.decisions[0].action, "keep");
  assert.deepEqual(result.decisions[0].reasonCodes, []);
  assert.equal(result.decisions[0].signals.negativeNoise, 0);
});

test("pure low-information emotional venting is removed with one precise reason", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: modelAnswers(0, {
          contentValue: 0.6,
          contentValueConfidence: 0.9,
          emotional_venting: 0.91,
          negative_noise: 0.93
        }),
        usage: { input_tokens: 100, output_tokens: 20 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await worker.fetch(
    filterRequest([
      {
        key: "0",
        title: "一切都完了",
        content: "太可怕了，真的受不了了。",
        contentType: "normal",
        isAds: false
      }
    ]),
    baseEnv
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.decisions[0].action, "drop");
  assert.deepEqual(result.decisions[0].reasonCodes, ["EMOTIONAL_VENTING"]);
});

test("low information value alone never removes a post", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: modelAnswers(0, {
          contentValue: 1.2,
          contentValueConfidence: 0.85
        }),
        usage: { input_tokens: 100, output_tokens: 20 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await worker.fetch(
    filterRequest([
      {
        key: "0",
        title: "今天随便发一下",
        content: "就这样吧。",
        contentType: "normal",
        isAds: false
      }
    ]),
    baseEnv
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.decisions[0].action, "keep");
  assert.deepEqual(result.decisions[0].reasonCodes, []);
});

test("uncertain low information score does not remove a post by itself", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: modelAnswers(0, {
          contentValue: 0.6,
          contentValueConfidence: 0.2,
          emotional_venting: 0.95,
          negative_noise: 0.95,
          engagement_bait: 0.95
        }),
        usage: { input_tokens: 100, output_tokens: 20 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await worker.fetch(
    filterRequest([
      {
        key: "0",
        title: "证据不足的边界样本",
        content: "正文很短。",
        contentType: "normal",
        isAds: false
      }
    ]),
    baseEnv
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.decisions[0].action, "keep");
  assert.deepEqual(result.decisions[0].reasonCodes, []);
});

test("experience, lifestyle, and photography sharing override low-value soft filters", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: {
          ...modelAnswers(0, {
            contentValue: 0.6,
            contentValueConfidence: 0.9,
            emotional_venting: 0.9,
            negative_noise: 0.9,
            engagement_bait: 0.9,
            experience_sharing: 0.82
          }),
          ...modelAnswers(1, {
            contentValue: 0.4,
            contentValueConfidence: 0.9,
            engagement_bait: 0.88,
            lifestyle_sharing: 0.86
          }),
          ...modelAnswers(2, {
            contentValue: 0.3,
            contentValueConfidence: 0.9,
            engagement_bait: 0.9,
            photography_sharing: 0.91
          })
        },
        usage: { input_tokens: 100, output_tokens: 20 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await worker.fetch(
    filterRequest([
      {
        key: "0",
        title: "第一次独自租房踩过的坑",
        content: "记录我的看房经历和最后的选择。",
        contentType: "normal",
        isAds: false
      },
      {
        key: "1",
        title: "今天给猫做了小蛋糕",
        content: "周末生活记录。",
        contentType: "normal",
        isAds: false
      },
      {
        key: "2",
        title: "雨后的上海街拍",
        content: "记录今天最喜欢的一组夜景。",
        contentType: "normal",
        isAds: false
      }
    ]),
    baseEnv
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(
    result.decisions.map(({ action, reasonCodes, keepReasonCodes }) => ({
      action,
      reasonCodes,
      keepReasonCodes
    })),
    [
      { action: "keep", reasonCodes: [], keepReasonCodes: ["EXPERIENCE_SHARING"] },
      { action: "keep", reasonCodes: [], keepReasonCodes: ["LIFESTYLE_SHARING"] },
      { action: "keep", reasonCodes: [], keepReasonCodes: ["PHOTOGRAPHY_SHARING"] }
    ]
  );
});

test("preserve signals do not override conflict bait or polarization", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: modelAnswers(0, {
          contentValue: 0.6,
          contentValueConfidence: 0.9,
          conflict_bait: 0.9,
          polarization: 0.9,
          lifestyle_sharing: 0.9
        }),
        usage: { input_tokens: 100, output_tokens: 20 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await worker.fetch(
    filterRequest([
      {
        key: "0",
        title: "生活分享",
        content: "用群体攻击和挑衅制造争吵。",
        contentType: "normal",
        isAds: false
      }
    ]),
    baseEnv
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(result.decisions[0].action, "drop");
  assert.deepEqual(result.decisions[0].reasonCodes, [
    "CONFLICT_BAIT",
    "POLARIZATION"
  ]);
  assert.deepEqual(result.decisions[0].keepReasonCodes, ["LIFESTYLE_SHARING"]);
});

test("commercial, conflict bait, and polarization are hard filter signals", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: modelAnswers(0, {
          contentValue: 2.7,
          commercial: 0.9,
          conflict_bait: 0.9,
          polarization: 0.9
        }),
        usage: { input_tokens: 100, output_tokens: 20 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await worker.fetch(
    filterRequest([
      {
        key: "0",
        title: "测试",
        content: "有一些具体内容。",
        contentType: "normal",
        isAds: false
      }
    ]),
    baseEnv
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(result.decisions[0].reasonCodes, [
    "COMMERCIAL",
    "CONFLICT_BAIT",
    "POLARIZATION"
  ]);
});

test("disabled semantic signals are neither asked nor required", async (t) => {
  let requestPayload;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    requestPayload = JSON.parse(init.body);
    return new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: {
          content_value_0: { type: "score", score: 2.7, confidence: 0.9 }
        },
        usage: { input_tokens: 100, output_tokens: 10 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await worker.fetch(
    filterRequest([
      { key: "0", title: "测试", contentType: "normal", isAds: false }
    ]),
    {
      ...baseEnv,
      FILTER_POLICY_JSON: JSON.stringify({
        enabledSignals: Object.fromEntries(
          [
            "commercial",
            "conflictBait",
            "polarization",
            "emotionalVenting",
            "negativeNoise",
            "engagementBait"
          ].map((key) => [key, false])
        ),
        enabledPreserveSignals: Object.fromEntries(
          ["experienceSharing", "lifestyleSharing", "photographySharing"].map(
            (key) => [key, false]
          )
        )
      })
    }
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(requestPayload.questions), ["content_value_0"]);
  assert.equal(result.decisions[0].action, "keep");
});

test("retries TypeSafe rate limits before returning a decision", async (t) => {
  let callCount = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { "retry-after": "0" }
      });
    }
    return new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: modelAnswers(0, { commercial: 0.02 }),
        usage: { input_tokens: 100, output_tokens: 10 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await worker.fetch(
    filterRequest([
      {
        key: "0",
        title: "",
        content: "包含完整步骤的正文",
        contentType: "normal",
        isAds: false
      }
    ]),
    baseEnv
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(callCount, 2);
  assert.equal(result.decisions[0].action, "keep");
});

test("fails open at the client boundary when TypeSafe omits an answer", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: "jev-1.13.0",
        answers: {
          ...modelAnswers(0),
          commercial_0: undefined
        },
        usage: { input_tokens: 100, output_tokens: 10 }
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await worker.fetch(
    filterRequest([
      {
        key: "0",
        title: "测试内容",
        content: "包含具体步骤",
        contentType: "normal",
        isAds: false
      }
    ]),
    baseEnv
  );

  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "filter_failed" });
});
