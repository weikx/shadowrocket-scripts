import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const script = fs.readFileSync(
  new URL("../shadowrocket/xhs-feed-jev.js", import.meta.url),
  "utf8"
);

function runScript(mode, decisions) {
  const input = {
    data: Array.from({ length: 10 }, (_, index) => ({
      id: String(index),
      title: `标题 ${index}`,
      type: "normal",
      is_ads: false,
      user: { nickname: `作者 ${index}` },
      recommend: { category_name: "测试" }
    }))
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Script test timed out")), 1000);
    const context = {
      $argument:
        `endpoint=https%3A%2F%2Ffilter.example.com%2Ffilter&token=test-token&mode=${mode}` +
        "&timeoutMs=500&minKeep=6&minKeepRatio=0.4",
      $response: { body: JSON.stringify(input) },
      $httpClient: {
        post(_options, callback) {
          callback(null, { status: 200 }, JSON.stringify({ decisions, model: "test" }));
        }
      },
      $done(value) {
        clearTimeout(timer);
        resolve({ input, value });
      },
      console,
      setTimeout,
      clearTimeout,
      isFinite,
      JSON,
      Number,
      Math,
      String,
      Boolean,
      Array,
      Object,
      RegExp,
      decodeURIComponent
    };
    vm.runInNewContext(script, context);
  });
}

test("observe mode marks decisions without deleting feed items", async () => {
  const { value } = await runScript("observe", [
    { key: "0", action: "drop", keepScore: 0.13 },
    { key: "1", action: "keep", keepScore: 0.86 }
  ]);
  const output = JSON.parse(value.body);
  assert.equal(output.data.length, 10);
  assert.equal(output.data[0].user.nickname, "[过滤 13] 作者 0");
  assert.equal(output.data[1].user.nickname, "[保留 86] 作者 1");
});

test("filter mode deletes strongest drops but preserves the minimum count", async () => {
  const decisions = Array.from({ length: 8 }, (_, index) => ({
    key: String(index),
    action: "drop",
    keepScore: index / 10
  }));
  const { value } = await runScript("filter", decisions);
  const output = JSON.parse(value.body);
  assert.equal(output.data.length, 6);
  assert.deepEqual(
    output.data.map((item) => item.id),
    ["4", "5", "6", "7", "8", "9"]
  );
});
