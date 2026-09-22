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

test("questions are independent and include the post index in instructions", () => {
  const policy = parsePolicy();
  const questions = buildQuestions(
    [{ title: "测试", author: "作者", category: "科技", contentType: "normal" }],
    policy
  );
  assert.deepEqual(Object.keys(questions), [
    "relevance_0",
    "low_quality_0",
    "commercial_0"
  ]);
  assert.match(questions.relevance_0.instructions, /posts\[0\]/);
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
          relevance_0: { type: "score", score: 0.3, confidence: 0.9 },
          low_quality_0: { type: "noul", noul: 0.7 },
          commercial_0: { type: "noul", noul: 0.1 },
          relevance_1: { type: "score", score: 2.8, confidence: 0.9 },
          low_quality_1: { type: "noul", noul: 0.05 },
          commercial_1: { type: "noul", noul: 0.02 }
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
      { key: "1", title: "哈哈哈哈", contentType: "normal", isAds: false },
      { key: "2", title: "如何排查 Node.js 内存泄漏", contentType: "normal", isAds: false },
      { key: "3", title: "直播中", contentType: "live", isAds: false },
      { key: "4", title: "", contentType: "normal", isAds: false }
    ]),
    baseEnv
  );
  const result = await response.json();

  assert.equal(response.status, 200);
  assert.equal(callCount, 1);
  assert.equal(requestPayload.state.posts.length, 2);
  assert.equal("author" in requestPayload.state.posts[0], false);
  assert.doesNotMatch(JSON.stringify(requestPayload.state), /作者/);
  assert.equal(Object.keys(requestPayload.questions).length, 6);
  assert.deepEqual(
    result.decisions.map(({ key, action, reasonCodes }) => ({ key, action, reasonCodes })),
    [
      { key: "0", action: "drop", reasonCodes: ["AD_FLAG"] },
      { key: "1", action: "drop", reasonCodes: ["LOW_RELEVANCE_AND_QUALITY"] },
      { key: "2", action: "keep", reasonCodes: [] },
      { key: "3", action: "drop", reasonCodes: ["LIVE_CARD"] },
      { key: "4", action: "drop", reasonCodes: ["NO_CONTENT"] }
    ]
  );
});

test("strict default thresholds are more selective", () => {
  const policy = parsePolicy();
  assert.equal(policy.version, "2");
  assert.equal(policy.thresholds.commercial, 0.75);
  assert.equal(policy.thresholds.veryLowQuality, 0.8);
  assert.equal(policy.thresholds.lowQuality, 0.6);
  assert.equal(policy.thresholds.relevance, 0.5);
  assert.equal(policy.thresholds.relevanceConfidence, 0.35);
});
