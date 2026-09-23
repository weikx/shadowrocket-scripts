/*
 * Shadowrocket HTTP response script for Xiaohongshu home feed.
 *
 * Required module arguments:
 *   endpoint=https%3A%2F%2FYOUR-WORKER.workers.dev%2Ffilter
 *   token=YOUR_CLIENT_TOKEN
 * Optional:
 *   mode=observe|filter (default: observe)
 *   timeoutMs=6000
 *   minKeep=6
 *   minKeepRatio=0.4
 */

(function () {
  var DEFAULT_CONFIG = {
    endpoint: "",
    token: "",
    mode: "observe",
    timeoutMs: 6000,
    minKeep: 6,
    minKeepRatio: 0.4
  };
  var REASON_LABELS = {
    AD_FLAG: "显式广告",
    LIVE_CARD: "直播内容",
    NO_CONTENT: "缺少标题和正文",
    BLOCKED_TOPIC: "命中屏蔽主题",
    COMMERCIAL: "商业营销",
    CONFLICT_BAIT: "引战",
    POLARIZATION: "群体对立",
    EMOTIONAL_VENTING: "情绪宣泄",
    NEGATIVE_NOISE: "负面噪音",
    ENGAGEMENT_BAIT: "互动诱导",
    LOW_INFORMATION_VALUE: "信息价值低"
  };
  var finished = false;
  var timeoutId = null;

  function finish(result) {
    if (finished) return;
    finished = true;
    if (timeoutId) clearTimeout(timeoutId);
    $done(result || {});
  }

  function decode(value) {
    try {
      return decodeURIComponent(String(value || "").replace(/\+/g, "%20"));
    } catch (_error) {
      return String(value || "");
    }
  }

  function parseArguments(raw) {
    var config = {};
    if (typeof raw !== "string" || !raw) return config;

    raw.split("&").forEach(function (part) {
      var separator = part.indexOf("=");
      var key = separator >= 0 ? part.slice(0, separator) : part;
      var value = separator >= 0 ? part.slice(separator + 1) : "";
      if (key) config[decode(key)] = decode(value);
    });
    return config;
  }

  function numberSetting(value, fallback, min, max) {
    var number = Number(value);
    if (!isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function getConfig() {
    var args = parseArguments(typeof $argument === "undefined" ? "" : $argument);
    return {
      endpoint: args.endpoint || DEFAULT_CONFIG.endpoint,
      token: args.token || DEFAULT_CONFIG.token,
      mode: args.mode === "filter" ? "filter" : "observe",
      timeoutMs: numberSetting(args.timeoutMs, DEFAULT_CONFIG.timeoutMs, 1000, 9000),
      minKeep: Math.round(numberSetting(args.minKeep, DEFAULT_CONFIG.minKeep, 0, 30)),
      minKeepRatio: numberSetting(
        args.minKeepRatio,
        DEFAULT_CONFIG.minKeepRatio,
        0,
        1
      )
    };
  }

  function itemTitle(item) {
    if (!item || typeof item !== "object") return "";
    if (item.live && typeof item.live.name === "string") return item.live.name;
    return firstText([
      item.title,
      item.display_title,
      item.name,
      item.note && item.note.title,
      item.note && item.note.display_title,
      item.note_card && item.note_card.title,
      item.note_card && item.note_card.display_title,
      item.note_info && item.note_info.title,
      item.note_info && item.note_info.display_title
    ]);
  }

  function firstText(values) {
    for (var index = 0; index < values.length; index += 1) {
      if (typeof values[index] === "string" && values[index].trim()) {
        return values[index].trim();
      }
    }
    return "";
  }

  function itemContent(item) {
    if (!item || typeof item !== "object") return "";
    return firstText([
      item.desc,
      item.content,
      item.description,
      item.note && item.note.desc,
      item.note && item.note.content,
      item.note && item.note.description,
      item.note_card && item.note_card.desc,
      item.note_card && item.note_card.content,
      item.note_card && item.note_card.description,
      item.note_info && item.note_info.desc,
      item.note_info && item.note_info.content,
      item.note_info && item.note_info.description
    ]);
  }

  function itemAuthor(item) {
    if (item && item.user && typeof item.user.nickname === "string") {
      return item.user.nickname;
    }
    if (item && item.live && typeof item.live.nickname === "string") {
      return item.live.nickname;
    }
    return "";
  }

  function itemCategory(item) {
    return item && item.recommend && typeof item.recommend.category_name === "string"
      ? item.recommend.category_name
      : "";
  }

  function toFilterItem(item, index) {
    var rawTitle = String(itemTitle(item));
    var rawContent = String(itemContent(item));
    var title = rawTitle.slice(0, 300);
    var content = rawContent === rawTitle ? "" : rawContent.slice(0, 600);

    return {
      key: String(index),
      title: title,
      content: content,
      category: String(itemCategory(item)).slice(0, 100),
      contentType: item && item.type === "live" ? "live" : String(item.type || "note"),
      isAds: Boolean(item && item.is_ads === true)
    };
  }

  function setNickname(item, nickname) {
    if (item && item.user && typeof item.user.nickname === "string") {
      item.user.nickname = nickname;
      return;
    }
    if (item && item.live && typeof item.live.nickname === "string") {
      item.live.nickname = nickname;
    }
  }

  function prependTitle(item, prefix) {
    var updated = false;
    var targets = [
      item && item.live ? [item.live, "name"] : null,
      [item, "title"],
      [item, "display_title"],
      [item, "name"],
      item && item.note ? [item.note, "title"] : null,
      item && item.note ? [item.note, "display_title"] : null,
      item && item.note_card ? [item.note_card, "title"] : null,
      item && item.note_card ? [item.note_card, "display_title"] : null,
      item && item.note_info ? [item.note_info, "title"] : null,
      item && item.note_info ? [item.note_info, "display_title"] : null
    ];

    targets.forEach(function (target) {
      if (!target || !target[0] || typeof target[0][target[1]] !== "string") return;
      var original = target[0][target[1]].trim();
      if (!original) return;
      target[0][target[1]] = prefix + " " + original;
      updated = true;
    });

    if (!updated && item && typeof item === "object") {
      item.title = prefix + " 无标题";
    }
  }

  function removalReason(decision) {
    if (!decision || !Array.isArray(decision.reasonCodes)) {
      return "未提供原因";
    }

    var labels = [];
    decision.reasonCodes.forEach(function (reasonCode) {
      var label = REASON_LABELS[String(reasonCode)] || String(reasonCode || "");
      if (label && labels.indexOf(label) < 0) labels.push(label);
    });
    return labels.length ? labels.join("、") : "未提供原因";
  }

  function observe(payload, decisions) {
    decisions.forEach(function (decision) {
      var index = Number(decision.key);
      var item = payload.data[index];
      if (!item) return;

      var original = itemAuthor(item) || "未知作者";
      var shouldDrop = decision.action === "drop";
      var marker = shouldDrop ? "❌应移除" : "✅应保留";
      setNickname(item, "[" + marker + "] " + original);
      if (shouldDrop) {
        prependTitle(item, "[移除原因：" + removalReason(decision) + "]");
      }
    });
    return 0;
  }

  function filter(payload, decisions, config) {
    var minimum = Math.max(
      Math.min(config.minKeep, payload.data.length),
      Math.ceil(payload.data.length * config.minKeepRatio)
    );
    var deterministicDrops = decisions.filter(function (decision) {
      return (
        decision.action === "drop" &&
        Array.isArray(decision.reasonCodes) &&
        decision.reasonCodes.some(function (reason) {
          return reason === "AD_FLAG" || reason === "LIVE_CARD";
        })
      );
    });
    var deterministicKeys = {};
    deterministicDrops.forEach(function (decision) {
      deterministicKeys[String(decision.key)] = true;
    });

    var remainingAfterDeterministic = payload.data.length - deterministicDrops.length;
    var maxSemanticDrops = Math.max(0, remainingAfterDeterministic - minimum);
    var semanticDrops = decisions
      .filter(function (decision) {
        return decision.action === "drop" && !deterministicKeys[String(decision.key)];
      })
      .sort(function (left, right) {
        return Number(left.keepScore || 0) - Number(right.keepScore || 0);
      })
      .slice(0, maxSemanticDrops);
    var dropCandidates = deterministicDrops.concat(semanticDrops);
    var dropKeys = {};

    dropCandidates.forEach(function (decision) {
      dropKeys[String(decision.key)] = true;
    });

    payload.data = payload.data.filter(function (_item, index) {
      return !dropKeys[String(index)];
    });
    return dropCandidates.length;
  }

  function responseStatus(response) {
    return Number((response && (response.status || response.statusCode)) || 0);
  }

  try {
    var config = getConfig();
    if (!config.endpoint || !/^https:\/\//i.test(config.endpoint)) {
      console.log("[xhs-feed-jev] Missing HTTPS Worker endpoint; passing through");
      finish({});
      return;
    }
    if (!config.token || config.token.indexOf("REPLACE_") === 0) {
      console.log("[xhs-feed-jev] Missing client token; passing through");
      finish({});
      return;
    }
    if (!$response || typeof $response.body !== "string" || !$response.body) {
      console.log("[xhs-feed-jev] Empty response body; passing through");
      finish({});
      return;
    }

    var payload = JSON.parse($response.body);
    if (!payload || !Array.isArray(payload.data) || !payload.data.length) {
      console.log("[xhs-feed-jev] No feed items; passing through");
      finish({});
      return;
    }

    var items = payload.data.map(toFilterItem);
    timeoutId = setTimeout(function () {
      console.log("[xhs-feed-jev] Worker timeout; passing through");
      finish({});
    }, config.timeoutMs);

    $httpClient.post(
      {
        url: config.endpoint,
        headers: {
          Authorization: "Bearer " + config.token,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ schemaVersion: 1, items: items }),
        timeout: Math.ceil(config.timeoutMs / 1000)
      },
      function (error, response, body) {
        if (error) {
          console.log("[xhs-feed-jev] Worker request failed: " + String(error));
          finish({});
          return;
        }

        var status = responseStatus(response);
        if (status < 200 || status >= 300) {
          console.log("[xhs-feed-jev] Worker returned HTTP " + status);
          finish({});
          return;
        }

        try {
          var result = JSON.parse(body);
          if (!result || !Array.isArray(result.decisions)) {
            throw new Error("Response does not contain decisions");
          }

          var dropped =
            config.mode === "filter"
              ? filter(payload, result.decisions, config)
              : observe(payload, result.decisions);

          console.log(
            "[xhs-feed-jev] mode=" +
              config.mode +
              " decisions=" +
              result.decisions.length +
              " dropped=" +
              dropped +
              " model=" +
              String(result.model || "rules-only") +
              " durationMs=" +
              String(result.durationMs || 0)
          );
          finish({ body: JSON.stringify(payload) });
        } catch (parseError) {
          console.log(
            "[xhs-feed-jev] Invalid Worker response; passing through: " +
              String(parseError)
          );
          finish({});
        }
      }
    );
  } catch (error) {
    console.log("[xhs-feed-jev] Rewrite failed; passing through: " + String(error));
    finish({});
  }
})();
