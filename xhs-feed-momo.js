/*
 * Shadowrocket HTTP response script
 * Target: https://rec.xiaohongshu.com/api/sns/v6/homefeed
 * Effect: replace visible author nicknames with "momo".
 */

var REPLACEMENT_NICKNAME = "momo";

function replaceNickname(owner) {
  if (
    owner &&
    typeof owner === "object" &&
    typeof owner.nickname === "string" &&
    owner.nickname.length > 0
  ) {
    owner.nickname = REPLACEMENT_NICKNAME;
    return 1;
  }

  return 0;
}

function rewriteHomeFeed(body) {
  var payload = JSON.parse(body);
  var changedCount = 0;

  if (!payload || !Array.isArray(payload.data)) {
    throw new Error("Unexpected response: data is not an array");
  }

  payload.data.forEach(function (item) {
    if (!item || typeof item !== "object") {
      return;
    }

    // Normal note cards: data[].user.nickname
    changedCount += replaceNickname(item.user);

    // Live cards: data[].live.nickname
    changedCount += replaceNickname(item.live);
  });

  console.log(
    "[xhs-feed-momo] Replaced " + changedCount + " nickname(s) with momo"
  );

  return JSON.stringify(payload);
}

try {
  if (!$response || typeof $response.body !== "string" || !$response.body) {
    console.log("[xhs-feed-momo] Empty response body; passing through");
    $done({});
  } else {
    $done({ body: rewriteHomeFeed($response.body) });
  }
} catch (error) {
  // Fail open: parsing or schema changes must not break the home feed.
  console.log(
    "[xhs-feed-momo] Rewrite failed; passing through: " + String(error)
  );
  $done({});
}
