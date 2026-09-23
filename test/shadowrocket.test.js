import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

const script = fs.readFileSync(
  new URL("../shadowrocket/xhs-feed-jev.js", import.meta.url),
  "utf8"
);

function runScript(mode, decisions, customizeInput) {
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
  if (customizeInput) customizeInput(input);
  let requestBody;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Script test timed out")), 1000);
    const context = {
      $argument:
        `endpoint=https%3A%2F%2Ffilter.example.com%2Ffilter&token=test-token&mode=${mode}` +
        "&timeoutMs=500&minKeep=6&minKeepRatio=0.4",
      $response: { body: JSON.stringify(input) },
      $httpClient: {
        post(options, callback) {
          requestBody = JSON.parse(options.body);
          callback(null, { status: 200 }, JSON.stringify({ decisions, model: "test" }));
        }
      },
      $done(value) {
        clearTimeout(timer);
        resolve({ input, requestBody, value });
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
  const { value, requestBody } = await runScript("observe", [
    {
      key: "0",
      action: "drop",
      keepScore: 0.13,
      reasonCodes: ["NEGATIVE_NOISE", "LOW_INFORMATION_VALUE"]
    },
    { key: "1", action: "keep", keepScore: 0.86 }
  ]);
  const output = JSON.parse(value.body);
  assert.equal(output.data.length, 10);
  assert.equal(output.data[0].user.nickname, "[❌应移除] 作者 0");
  assert.equal(output.data[1].user.nickname, "[✅应保留] 作者 1");
  assert.equal(
    output.data[0].title,
    "[移除原因：负面噪音、信息价值低] 标题 0"
  );
  assert.equal(output.data[1].title, "标题 1");
  assert.equal("author" in requestBody.items[0], false);
  assert.doesNotMatch(JSON.stringify(requestBody), /作者/);
});

test("observe mode shows deterministic and fallback removal reasons in titles", async () => {
  const { value } = await runScript("observe", [
    { key: "0", action: "drop", reasonCodes: ["AD_FLAG"] },
    { key: "1", action: "drop", reasonCodes: ["CONFLICT_BAIT"] },
    { key: "2", action: "drop", reasonCodes: ["GENDER_FAMILY_CONFLICT"] },
    { key: "3", action: "drop", reasonCodes: ["PERSONAL_EMOTION"] },
    { key: "4", action: "drop", reasonCodes: [] },
    { key: "5", action: "drop", reasonCodes: ["FUTURE_REASON"] }
  ]);
  const output = JSON.parse(value.body);

  assert.equal(output.data[0].title, "[移除原因：显式广告] 标题 0");
  assert.equal(output.data[1].title, "[移除原因：引战] 标题 1");
  assert.equal(output.data[2].title, "[移除原因：性别或家庭对立] 标题 2");
  assert.equal(output.data[3].title, "[移除原因：个人情绪表达] 标题 3");
  assert.equal(output.data[4].title, "[移除原因：未提供原因] 标题 4");
  assert.equal(output.data[5].title, "[移除原因：FUTURE_REASON] 标题 5");
});

test("observe mode writes a reason title when the original title is empty", async () => {
  const { value } = await runScript(
    "observe",
    [{ key: "0", action: "drop", reasonCodes: ["NO_CONTENT"] }],
    (input) => {
      input.data[0].title = "";
    }
  );
  const output = JSON.parse(value.body);

  assert.equal(output.data[0].title, "[移除原因：缺少标题和正文] 无标题");
});

test("sends available post content separately from the title", async () => {
  const { requestBody } = await runScript(
    "observe",
    [{ key: "0", action: "keep", keepScore: 0.9 }],
    (input) => {
      input.data[0].title = "一个很短的标题";
      input.data[0].desc = "正文包含三个可执行步骤和每一步的注意事项。";
      input.data[1].title = "";
      input.data[1].desc = "虽然没有标题，但正文包含完整的经验总结。";
    }
  );

  assert.equal(requestBody.items[0].title, "一个很短的标题");
  assert.equal(
    requestBody.items[0].content,
    "正文包含三个可执行步骤和每一步的注意事项。"
  );
  assert.equal(requestBody.items[1].title, "");
  assert.equal(requestBody.items[1].content, "虽然没有标题，但正文包含完整的经验总结。");
});

test("filter mode always removes live cards even below the minimum count", async () => {
  const { value } = await runScript(
    "filter",
    [{ key: "0", action: "drop", keepScore: 0, reasonCodes: ["LIVE_CARD"] }],
    (input) => {
      input.data = input.data.slice(0, 5);
      input.data[0].type = "live";
    }
  );
  const output = JSON.parse(value.body);
  assert.equal(output.data.length, 4);
  assert.deepEqual(
    output.data.map((item) => item.id),
    ["1", "2", "3", "4"]
  );
});

test("filter mode always removes conflict and personal emotion below the minimum count", async () => {
  const { value } = await runScript(
    "filter",
    [
      {
        key: "0",
        action: "drop",
        keepScore: 0.8,
        reasonCodes: ["GENDER_FAMILY_CONFLICT"]
      },
      {
        key: "1",
        action: "drop",
        keepScore: 0.8,
        reasonCodes: ["PERSONAL_EMOTION"]
      }
    ],
    (input) => {
      input.data = input.data.slice(0, 5);
    }
  );
  const output = JSON.parse(value.body);
  assert.deepEqual(
    output.data.map((item) => item.id),
    ["2", "3", "4"]
  );
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
