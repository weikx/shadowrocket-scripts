const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const MAX_ITEMS = 30;
const SIGNAL_KEYS = Object.freeze([
  "commercial",
  "conflictBait",
  "polarization",
  "emotionalVenting",
  "negativeNoise",
  "engagementBait"
]);
const PRESERVE_SIGNAL_KEYS = Object.freeze([
  "experienceSharing",
  "lifestyleSharing",
  "photographySharing"
]);

const SIGNAL_RULES = Object.freeze({
  commercial: Object.freeze({
    answerPrefix: "commercial",
    reasonCode: "COMMERCIAL",
    requiresLowInformationValue: false
  }),
  conflictBait: Object.freeze({
    answerPrefix: "conflict_bait",
    reasonCode: "CONFLICT_BAIT",
    requiresLowInformationValue: false
  }),
  polarization: Object.freeze({
    answerPrefix: "polarization",
    reasonCode: "POLARIZATION",
    requiresLowInformationValue: false
  }),
  emotionalVenting: Object.freeze({
    answerPrefix: "emotional_venting",
    reasonCode: "EMOTIONAL_VENTING",
    requiresLowInformationValue: true
  }),
  negativeNoise: Object.freeze({
    answerPrefix: "negative_noise",
    reasonCode: "NEGATIVE_NOISE",
    requiresLowInformationValue: true
  }),
  engagementBait: Object.freeze({
    answerPrefix: "engagement_bait",
    reasonCode: "ENGAGEMENT_BAIT",
    requiresLowInformationValue: true
  })
});

const PRESERVE_SIGNAL_RULES = Object.freeze({
  experienceSharing: Object.freeze({
    answerPrefix: "experience_sharing",
    reasonCode: "EXPERIENCE_SHARING"
  }),
  lifestyleSharing: Object.freeze({
    answerPrefix: "lifestyle_sharing",
    reasonCode: "LIFESTYLE_SHARING"
  }),
  photographySharing: Object.freeze({
    answerPrefix: "photography_sharing",
    reasonCode: "PHOTOGRAPHY_SHARING"
  })
});

const DEFAULT_CONTENT_VALUE_CRITERIA = Object.freeze([
  "The supplied text contains no usable information: it is empty in substance, vague, purely emotional, a slogan, a tease, or context-free sharing",
  "The supplied text names a topic, opinion, or experience but gives little concrete context, evidence, explanation, or reusable takeaway",
  "The supplied text provides at least one concrete fact, explanation, comparison, method, actionable suggestion, or specific first-hand experience",
  "The supplied text provides multiple concrete facts, steps, data points, well-supported analysis, or unusually useful and reusable first-hand insight"
]);

const DEFAULT_SIGNAL_DEFINITIONS = Object.freeze({
  commercial: {
    true:
      "The primary purpose is to sell or promote a product, service, course, merchant, account, discount, affiliate offer, private-message lead, or other conversion action, including disguised advertising",
    false:
      "The post is not primarily promotional. Independent reviews, comparisons, consumer warnings, and factual discussion of products are not commercial merely because a product is mentioned"
  },
  conflictBait: {
    true:
      "The wording deliberately provokes hostile argument, outrage, insults, ridicule, accusation, or a comment fight as a primary engagement strategy",
    false:
      "It presents criticism, disagreement, controversy, or a strong opinion with substantive context and without primarily trying to provoke interpersonal hostility"
  },
  polarization: {
    true:
      "It divides identity or social groups into opposing camps and uses sweeping stereotypes, superiority or inferiority claims, collective blame, contempt, or hostility toward a group",
    false:
      "It neutrally compares groups or discusses inequality, discrimination, demographics, or social conflict with evidence and nuance rather than promoting group hostility"
  },
  emotionalVenting: {
    true:
      "The post is mainly unprocessed anger, sadness, resentment, grievance, anxiety, or self-pity, with little concrete context, reflection, lesson, or reusable insight",
    false:
      "It may express emotion, but also provides concrete experience, reflection, explanation, coping methods, or information useful to another reader"
  },
  negativeNoise: {
    true:
      "The primary effect is to amplify fear, anger, shame, anxiety, despair, humiliation, or catastrophizing without enough factual context, analysis, verification, or useful guidance",
    false:
      "Factual bad news, risk analysis, public-safety or health warnings, scam alerts, consumer warnings, and problem-solving content remain informative even when the subject is negative"
  },
  engagementBait: {
    true:
      "The post withholds substance or uses a sensational curiosity gap, exaggerated promise, vague teaser, or low-context request for comments, likes, follows, or guesses mainly to drive engagement",
    false:
      "A question or strong headline is not bait when the post supplies useful context or seeks a concrete, answerable exchange"
  }
});

const DEFAULT_PRESERVE_SIGNAL_DEFINITIONS = Object.freeze({
  experienceSharing: {
    true:
      "The post shares a genuine first-hand experience, process, outcome, review, lesson, observation, or personal account. It does not need to be instructional or universally reusable",
    false:
      "It contains no recognizable first-hand experience and is only a slogan, unsupported assertion, vague question, copied claim, or promotional pitch"
  },
  lifestyleSharing: {
    true:
      "The post genuinely documents or shares an everyday-life moment, routine, meal, trip, home, pet, family activity, outfit, hobby, or personal taste. Ordinary life sharing may be worth preserving even without a tutorial or broad informational value",
    false:
      "It is not meaningfully about a personal everyday-life moment, or the apparent lifestyle framing is primarily an advertisement, hostile provocation, or empty engagement tactic"
  },
  photographySharing: {
    true:
      "Photography or visual creation is itself the central subject or creative output, such as a photo diary, scenery, portrait, street photography, composition, camera practice, editing, or a clearly identified photographic work. A short caption can still qualify",
    false:
      "There is no supplied textual evidence that photography or visual creation is central. Do not infer photography merely because an unseen image or video may exist"
  }
});

const DEFAULT_POLICY = Object.freeze({
  version: "5",
  blockedTopics: [],
  highValueDescription:
    "帮助读者了解事实、理解问题或做出判断，提供明确的背景、解释、方法、步骤、数据、对比、可执行建议或可复用的一手经验",
  contentValueCriteria: DEFAULT_CONTENT_VALUE_CRITERIA,
  filterAds: true,
  enabledSignals: Object.freeze({
    commercial: true,
    conflictBait: true,
    polarization: true,
    emotionalVenting: true,
    negativeNoise: true,
    engagementBait: true
  }),
  signalDefinitions: DEFAULT_SIGNAL_DEFINITIONS,
  enabledPreserveSignals: Object.freeze({
    experienceSharing: true,
    lifestyleSharing: true,
    photographySharing: true
  }),
  preserveSignalDefinitions: DEFAULT_PRESERVE_SIGNAL_DEFINITIONS,
  thresholds: {
    blockedTopic: 0.8,
    commercial: 0.75,
    conflictBait: 0.7,
    polarization: 0.7,
    emotionalVenting: 0.8,
    negativeNoise: 0.8,
    engagementBait: 0.75,
    experienceSharing: 0.55,
    lifestyleSharing: 0.6,
    photographySharing: 0.6,
    maxContentValueForDrop: 0.45,
    minContentValueConfidence: 0.4
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

function parseContentValueCriteria(value) {
  if (!Array.isArray(value) || value.length !== 4) {
    return DEFAULT_CONTENT_VALUE_CRITERIA;
  }
  const criteria = value.map((entry) => cleanString(entry, 1000));
  return criteria.every(Boolean) ? criteria : DEFAULT_CONTENT_VALUE_CRITERIA;
}

function parseEnabledSignals(value, keys, defaults) {
  const custom = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    keys.map((key) => {
      if (typeof custom[key] === "boolean") return [key, custom[key]];
      return [key, defaults[key]];
    })
  );
}

function parseSignalDefinitions(value, keys, defaults) {
  const custom = value && typeof value === "object" ? value : {};
  return Object.fromEntries(
    keys.map((key) => {
      const entry = custom[key] && typeof custom[key] === "object" ? custom[key] : {};
      return [
        key,
        {
          true: cleanString(entry.true, 1000) || defaults[key].true,
          false: cleanString(entry.false, 1000) || defaults[key].false
        }
      ];
    })
  );
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
    blockedTopics: Array.isArray(custom.blockedTopics)
      ? custom.blockedTopics.map((value) => cleanString(value, 200)).filter(Boolean).slice(0, 30)
      : DEFAULT_POLICY.blockedTopics,
    highValueDescription:
      cleanString(custom.highValueDescription, 1000) || DEFAULT_POLICY.highValueDescription,
    contentValueCriteria: parseContentValueCriteria(custom.contentValueCriteria),
    filterAds: custom.filterAds !== false,
    enabledSignals: {
      ...parseEnabledSignals(
        custom.enabledSignals,
        SIGNAL_KEYS,
        DEFAULT_POLICY.enabledSignals
      ),
      commercial:
        typeof custom.enabledSignals?.commercial === "boolean"
          ? custom.enabledSignals.commercial
          : custom.filterCommercial !== false
    },
    signalDefinitions: parseSignalDefinitions(
      custom.signalDefinitions,
      SIGNAL_KEYS,
      DEFAULT_SIGNAL_DEFINITIONS
    ),
    enabledPreserveSignals: parseEnabledSignals(
      custom.enabledPreserveSignals,
      PRESERVE_SIGNAL_KEYS,
      DEFAULT_POLICY.enabledPreserveSignals
    ),
    preserveSignalDefinitions: parseSignalDefinitions(
      custom.preserveSignalDefinitions,
      PRESERVE_SIGNAL_KEYS,
      DEFAULT_PRESERVE_SIGNAL_DEFINITIONS
    ),
    thresholds: {
      blockedTopic: clamp(
        finiteNumber(
          thresholds.blockedTopic,
          finiteNumber(thresholds.blocked, DEFAULT_POLICY.thresholds.blockedTopic)
        )
      ),
      commercial: clamp(
        finiteNumber(thresholds.commercial, DEFAULT_POLICY.thresholds.commercial)
      ),
      conflictBait: clamp(
        finiteNumber(thresholds.conflictBait, DEFAULT_POLICY.thresholds.conflictBait)
      ),
      polarization: clamp(
        finiteNumber(thresholds.polarization, DEFAULT_POLICY.thresholds.polarization)
      ),
      emotionalVenting: clamp(
        finiteNumber(
          thresholds.emotionalVenting,
          DEFAULT_POLICY.thresholds.emotionalVenting
        )
      ),
      negativeNoise: clamp(
        finiteNumber(thresholds.negativeNoise, DEFAULT_POLICY.thresholds.negativeNoise)
      ),
      engagementBait: clamp(
        finiteNumber(
          thresholds.engagementBait,
          DEFAULT_POLICY.thresholds.engagementBait
        )
      ),
      experienceSharing: clamp(
        finiteNumber(
          thresholds.experienceSharing,
          DEFAULT_POLICY.thresholds.experienceSharing
        )
      ),
      lifestyleSharing: clamp(
        finiteNumber(
          thresholds.lifestyleSharing,
          DEFAULT_POLICY.thresholds.lifestyleSharing
        )
      ),
      photographySharing: clamp(
        finiteNumber(
          thresholds.photographySharing,
          DEFAULT_POLICY.thresholds.photographySharing
        )
      ),
      maxContentValueForDrop: clamp(
        finiteNumber(
          thresholds.maxContentValueForDrop,
          finiteNumber(
            thresholds.contentValue,
            finiteNumber(
              thresholds.relevance,
              DEFAULT_POLICY.thresholds.maxContentValueForDrop
            )
          )
        )
      ),
      minContentValueConfidence: clamp(
        finiteNumber(
          thresholds.minContentValueConfidence,
          finiteNumber(
            thresholds.contentValueConfidence,
            finiteNumber(
              thresholds.relevanceConfidence,
              DEFAULT_POLICY.thresholds.minContentValueConfidence
            )
          )
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
    content: cleanString(item.content, 600),
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
    language: "Chinese social-media posts; judge the supplied text as written",
    evaluationGoal:
      "Keep posts that help a reader learn facts, understand a situation, solve a problem, or make a decision. Also preserve genuine first-hand experiences, personal lifestyle sharing, and photography or visual-creation sharing even when they are not broadly instructional. Judge information utility separately from whether the topic or emotion is positive or negative.",
    evidenceLimit:
      "Judge only the supplied title, content, category, and content type. Consider title and content together; either field may be empty. Do not penalize a missing title when the content itself provides useful evidence. Do not use or infer author identity. Do not infer unseen image, video, or other details.",
    policy: {
      blockedTopics: policy.blockedTopics.length
        ? policy.blockedTopics
        : ["No blocked topics configured"],
      highValueContent: policy.highValueDescription
    },
    posts: posts.map((item) => ({
      title: item.title,
      content: item.content,
      category: item.category || "Unknown category",
      contentType: item.contentType
    }))
  };
}

function buildQuestions(posts, policy) {
  const questions = {};

  posts.forEach((_post, index) => {
    const target = `Evaluate only \`posts[${index}]\`. Base the answer only on fields present in state.`;
    const inspect = `Consider \`posts[${index}].title\` and \`posts[${index}].content\` together. Either may be empty.`;
    const preserveInspect = `Consider \`posts[${index}].title\`, \`posts[${index}].content\`, and \`posts[${index}].category\` together. Title or content may be empty.`;
    const addSignalQuestion = (key, question) => {
      if (!policy.enabledSignals[key]) return;
      questions[`${SIGNAL_RULES[key].answerPrefix}_${index}`] = {
        type: "noul",
        instructions: {
          target,
          question,
          inspect,
          constraint:
            "Classify the communication pattern, not the topic alone. Do not infer from the author or unseen media."
        },
        criteria: policy.signalDefinitions[key]
      };
    };
    const addPreserveQuestion = (key, question) => {
      if (!policy.enabledPreserveSignals[key]) return;
      questions[`${PRESERVE_SIGNAL_RULES[key].answerPrefix}_${index}`] = {
        type: "noul",
        instructions: {
          target,
          question,
          inspect: preserveInspect,
          constraint:
            "Judge whether the supplied text identifies this kind of sharing. Do not require tutorial-style information, and do not infer unseen image or video details."
        },
        criteria: policy.preserveSignalDefinitions[key]
      };
    };

    questions[`content_value_${index}`] = {
      type: "score",
      instructions: {
        target,
        question:
          "How much concrete information value does this post provide to a reader trying to learn, understand a situation, solve a problem, or make a decision?",
        desiredValue: "Use `policy.highValueContent` as the user's definition of valuable information.",
        inspect,
        constraint:
          "Judge information utility, not whether the subject or emotion is positive or negative. Use only supplied text; do not infer value from the author, unseen media, or implied details."
      },
      criteria: policy.contentValueCriteria
    };

    addSignalQuestion(
      "commercial",
      "Is the post's primary communication purpose commercial promotion or conversion?"
    );
    addSignalQuestion(
      "conflictBait",
      "Does the post deliberately provoke hostile argument or outrage as a primary engagement strategy?"
    );
    addSignalQuestion(
      "polarization",
      "Does the post promote hostile us-versus-them framing or sweeping antagonistic claims about identity or social groups?"
    );
    addSignalQuestion(
      "emotionalVenting",
      "Is the post mainly emotional venting or grievance without enough concrete context, reflection, or reusable insight?"
    );
    addSignalQuestion(
      "negativeNoise",
      "Is the post mainly negative emotional amplification without enough factual context, analysis, verification, or useful guidance?"
    );
    addSignalQuestion(
      "engagementBait",
      "Is the post mainly a sensational or low-information tactic to obtain clicks, comments, likes, follows, or guesses?"
    );
    addPreserveQuestion(
      "experienceSharing",
      "Does the post share a genuine first-hand experience, process, outcome, review, lesson, observation, or personal account?"
    );
    addPreserveQuestion(
      "lifestyleSharing",
      "Is the post a genuine personal lifestyle or everyday-life sharing?"
    );
    addPreserveQuestion(
      "photographySharing",
      "Is photography or visual creation itself the central subject or creative output of the post?"
    );

    if (policy.blockedTopics.length) {
      questions[`blocked_${index}`] = {
        type: "noul",
        instructions: {
          target,
          question: "Is this post clearly about one or more topics in `policy.blockedTopics`?",
          inspect
        },
        criteria: {
          true: "The post clearly belongs to a blocked topic",
          false: "It does not, or the supplied title and content are too ambiguous to establish that"
        }
      };
    }
  });

  return questions;
}

function readNoul(answers, key) {
  const answer = answers?.[key];
  if (answer?.type !== "noul" || !Number.isFinite(answer.noul)) {
    throw new Error(`TypeSafe response is missing a valid Noul answer for ${key}`);
  }
  return clamp(answer.noul);
}

function readScore(answers, key) {
  const answer = answers?.[key];
  if (
    answer?.type !== "score" ||
    !Number.isFinite(answer.score) ||
    !Number.isFinite(answer.confidence)
  ) {
    throw new Error(`TypeSafe response is missing a valid Score answer for ${key}`);
  }
  return {
    value: clamp(answer.score / 3),
    confidence: clamp(answer.confidence)
  };
}

function retryDelayMs(response, retryIndex) {
  const retryAfter = Number(response.headers.get("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter >= 0) {
    return Math.min(1000, retryAfter * 1000);
  }
  return 200 * 2 ** retryIndex;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function makeModelDecision(item, index, answers, policy) {
  const contentValue = readScore(answers, `content_value_${index}`);
  const signals = Object.fromEntries(
    SIGNAL_KEYS.map((key) => [
      key,
      policy.enabledSignals[key]
        ? readNoul(answers, `${SIGNAL_RULES[key].answerPrefix}_${index}`)
        : 0
    ])
  );
  const blocked = policy.blockedTopics.length
    ? readNoul(answers, `blocked_${index}`)
    : 0;
  const preserveSignals = Object.fromEntries(
    PRESERVE_SIGNAL_KEYS.map((key) => [
      key,
      policy.enabledPreserveSignals[key]
        ? readNoul(answers, `${PRESERVE_SIGNAL_RULES[key].answerPrefix}_${index}`)
        : 0
    ])
  );
  const keepReasonCodes = PRESERVE_SIGNAL_KEYS.filter(
    (key) => preserveSignals[key] >= policy.thresholds[key]
  ).map((key) => PRESERVE_SIGNAL_RULES[key].reasonCode);
  const isProtectedSharing = keepReasonCodes.length > 0;
  const hasReliableLowInformationValue =
    contentValue.value <= policy.thresholds.maxContentValueForDrop &&
    contentValue.confidence >= policy.thresholds.minContentValueConfidence;

  const reasonCodes = [];
  if (blocked >= policy.thresholds.blockedTopic) {
    reasonCodes.push("BLOCKED_TOPIC");
  }
  SIGNAL_KEYS.forEach((key) => {
    const rule = SIGNAL_RULES[key];
    if (signals[key] < policy.thresholds[key]) return;
    if (
      rule.requiresLowInformationValue &&
      (!hasReliableLowInformationValue || isProtectedSharing)
    ) {
      return;
    }
    reasonCodes.push(rule.reasonCode);
  });
  if (hasReliableLowInformationValue && !isProtectedSharing) {
    reasonCodes.push("LOW_INFORMATION_VALUE");
  }

  const strongestRisk = Math.max(blocked, ...Object.values(signals));

  const keepScore = clamp(
    contentValue.value * 0.7 + (1 - strongestRisk) * 0.3
  );

  return {
    key: item.key,
    action: reasonCodes.length ? "drop" : "keep",
    evaluation: "jev",
    keepScore: Number(keepScore.toFixed(4)),
    contentValue: Number(contentValue.value.toFixed(4)),
    contentValueConfidence: Number(contentValue.confidence.toFixed(4)),
    signals: Object.fromEntries(
      SIGNAL_KEYS.map((key) => [key, Number(signals[key].toFixed(4))])
    ),
    preserveSignals: Object.fromEntries(
      PRESERVE_SIGNAL_KEYS.map((key) => [
        key,
        Number(preserveSignals[key].toFixed(4))
      ])
    ),
    blocked: Number(blocked.toFixed(4)),
    reasonCodes,
    keepReasonCodes
  };
}

function makeRuleDecision(item, reasonCode, overrides = {}) {
  return {
    key: item.key,
    action: "drop",
    evaluation: "rule",
    keepScore: 0,
    contentValue: overrides.contentValue ?? 0,
    contentValueConfidence: overrides.contentValueConfidence ?? 1,
    signals: Object.fromEntries(
      SIGNAL_KEYS.map((key) => [key, overrides.signals?.[key] ?? 0])
    ),
    preserveSignals: Object.fromEntries(
      PRESERVE_SIGNAL_KEYS.map((key) => [key, 0])
    ),
    blocked: 0,
    reasonCodes: [reasonCode],
    keepReasonCodes: []
  };
}

async function callTypeSafe(posts, policy, env) {
  if (!env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY is not configured");

  const timeoutMs = Math.max(500, Number(env.TYPESAFE_TIMEOUT_MS) || 4500);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const requestBody = JSON.stringify({
    state: buildState(posts, policy),
    model: env.TYPESAFE_MODEL || "jev-1.13.0",
    questions: buildQuestions(posts, policy)
  });

  try {
    let response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(TYPESAFE_URL, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.TYPESAFE_API_KEY}`,
          "content-type": "application/json"
        },
        body: requestBody,
        signal: controller.signal
      });

      if (![429, 529].includes(response.status) || attempt === 2) break;
      await response.body?.cancel();
      await wait(retryDelayMs(response, attempt));
    }

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
      decisions[inputIndex] = makeRuleDecision(item, "AD_FLAG", {
        signals: { commercial: 1 }
      });
      return;
    }

    if (item.contentType === "live") {
      decisions[inputIndex] = makeRuleDecision(item, "LIVE_CARD");
      return;
    }

    if (!item.title && !item.content) {
      decisions[inputIndex] = makeRuleDecision(item, "NO_CONTENT");
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
