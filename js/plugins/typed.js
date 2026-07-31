/*
 author: @jiangwen5945 & EvanNotFound
*/

const instances = new Map();
const initTokens = new Map();

const normalizeSubtitleText = (subtitleText) => {
  if (Array.isArray(subtitleText)) {
    return subtitleText.filter((entry) => typeof entry === "string" && entry);
  }

  if (typeof subtitleText === "string" && subtitleText) {
    return [subtitleText];
  }

  return [];
};

const destroyInstance = (id) => {
  const instance = instances.get(id);
  if (instance && typeof instance.destroy === "function") {
    try {
      instance.destroy();
    } catch (error) {
      console.error("Failed to destroy Typed instance:", error);
    }
  }

  instances.delete(id);

  const element = document.getElementById(id);
  if (element) {
    element.innerHTML = "";
  }
};

const createTyped = (id, strings, options) => {
  if (typeof window.Typed === "undefined") {
    return;
  }

  if (!document.getElementById(id)) {
    return;
  }

  destroyInstance(id);

  const instance = new window.Typed(`#${id}`, {
    strings,
    typeSpeed: options.typeSpeed,
    smartBackspace: options.smartBackspace,
    backSpeed: options.backSpeed,
    backDelay: options.backDelay,
    loop: options.loop,
    startDelay: options.startDelay,
  });

  instances.set(id, instance);
};

const firstString = (...values) => {
  const value = values.find(
    (entry) => typeof entry === "string" && entry.trim(),
  );
  return value ? value.trim() : "";
};

const parseHitokotoResponse = (data) => {
  const payload = data?.item && typeof data.item === "object" ? data.item : data;

  return {
    quote: firstString(payload?.hitokoto, payload?.content),
    author: firstString(
      payload?.from_who,
      payload?.author,
      payload?.source,
      payload?.from,
    ),
  };
};

const getCacheKey = (api, showAuthor) =>
  `redefine:hitokoto:${api}:author=${Boolean(showAuthor)}`;

const readCachedHitokoto = (key) => {
  try {
    const cached = window.sessionStorage.getItem(key);
    return typeof cached === "string" ? cached : "";
  } catch {
    return "";
  }
};

const writeCachedHitokoto = (key, text) => {
  try {
    window.sessionStorage.setItem(key, text);
  } catch {
    // Storage can be disabled without affecting quote rendering.
  }
};

const subtitleConfig = theme?.home_banner?.subtitle || {};
const hitokotoConfig = subtitleConfig.hitokoto || {};

export const config = {
  usrTypeSpeed: subtitleConfig.typing_speed,
  usrBackSpeed: subtitleConfig.backing_speed,
  usrBackDelay: subtitleConfig.backing_delay,
  usrStartDelay: subtitleConfig.starting_delay,
  usrLoop: subtitleConfig.loop,
  usrSmartBackspace: subtitleConfig.smart_backspace,
  usrHitokotoAPI: hitokotoConfig.api,
};

export default function initTyped(id) {
  const currentToken = (initTokens.get(id) || 0) + 1;
  initTokens.set(id, currentToken);

  const {
    usrTypeSpeed,
    usrBackSpeed,
    usrBackDelay,
    usrStartDelay,
    usrLoop,
    usrSmartBackspace,
    usrHitokotoAPI,
  } = config;

  const options = {
    typeSpeed: usrTypeSpeed ?? 100,
    smartBackspace: usrSmartBackspace ?? false,
    backSpeed: usrBackSpeed ?? 80,
    backDelay: usrBackDelay ?? 1500,
    loop: usrLoop ?? false,
    startDelay: usrStartDelay ?? 500,
  };

  const subtitleEntries = normalizeSubtitleText(subtitleConfig.text);
  const renderFallback = () => {
    if (initTokens.get(id) !== currentToken || subtitleEntries.length === 0) {
      return;
    }

    createTyped(id, subtitleEntries, options);
  };

  if (!hitokotoConfig.enable) {
    renderFallback();
    return;
  }

  if (!usrHitokotoAPI) {
    renderFallback();
    return;
  }

  const cacheKey = getCacheKey(
    usrHitokotoAPI,
    hitokotoConfig.show_author,
  );
  const cachedText = readCachedHitokoto(cacheKey);
  if (cachedText) {
    createTyped(id, [cachedText], options);
    return;
  }

  const controller = new AbortController();
  const configuredTimeout = Number(hitokotoConfig.timeout);
  const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : 6000;
  const timeoutId = window.setTimeout(() => controller.abort(), timeout);

  fetch(usrHitokotoAPI, {
    headers: { Accept: "application/json" },
    signal: controller.signal,
  })
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Hitokoto request failed with ${response.status}`);
      }

      return response.json();
    })
    .then((data) => {
      if (initTokens.get(id) !== currentToken) {
        return;
      }

      const { quote, author } = parseHitokotoResponse(data);
      if (!quote) {
        throw new Error("Hitokoto response does not contain quote text");
      }

      const text = author && hitokotoConfig.show_author
        ? `${quote} —— ${author}`
        : quote;

      writeCachedHitokoto(cacheKey, text);
      createTyped(id, [text], options);
    })
    .catch((error) => {
      if (initTokens.get(id) !== currentToken) {
        return;
      }

      console.warn("Failed to fetch hitokoto; using local subtitle:", error);
      renderFallback();
    })
    .finally(() => {
      window.clearTimeout(timeoutId);
    });
}
