/**
 * Mock for jsdom to avoid ESM dependency issues in Jest tests.
 * The @exodus/bytes package inside jsdom's dependency tree is ESM-only,
 * causing "Unexpected token 'export'" errors in ts-jest.
 */

function createMockDocument(html) {
  // Parse basic HTML structure
  const titleMatch = html
    ? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
    : null;
  const h1Match = html ? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) : null;
  const bodyMatch = html ? html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) : null;

  function _makeElement(tagName, content) {
    return {
      tagName: tagName.toUpperCase(),
      textContent: content || "",
      innerHTML: content || "",
      getAttribute: jest.fn().mockReturnValue(null),
      remove: jest.fn(),
      querySelector: jest.fn().mockReturnValue(null),
      querySelectorAll: jest.fn().mockReturnValue([]),
      cloneNode: function () {
        return _makeElement(tagName, content);
      },
    };
  }

  const bodyContent = bodyMatch ? bodyMatch[1] : html || "";

  // Extract text from body removing tags
  const bodyText = bodyContent
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Script elements from HTML
  const scriptMatches = html
    ? [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
    : [];
  const scriptElements = scriptMatches.map((m) => ({
    textContent: m[1] || "",
  }));

  // LD+JSON script elements - use a simpler match to avoid greedy backtracking issues
  const ldJsonMatches = html
    ? [
        ...html.matchAll(
          /<script\s[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
        ),
      ]
    : [];
  // Also match scripts where type comes at the beginning
  if (html && ldJsonMatches.length === 0) {
    const altMatches = [
      ...html.matchAll(
        /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi,
      ),
    ];
    ldJsonMatches.push(...altMatches);
  }
  const ldJsonElements = ldJsonMatches.map((m) => ({
    textContent: m[1] || "",
  }));

  // Meta elements
  const metaElements = {};
  if (html) {
    const metaMatches = [...html.matchAll(/<meta[^>]+>/gi)];
    metaMatches.forEach((m) => {
      const propertyMatch = m[0].match(/property="([^"]+)"/i);
      const nameMatch = m[0].match(/name="([^"]+)"/i);
      const contentMatch = m[0].match(/content="([^"]+)"/i);
      const key = propertyMatch
        ? propertyMatch[1]
        : nameMatch
          ? nameMatch[1]
          : null;
      if (key && contentMatch) {
        metaElements[key] = contentMatch[1];
      }
    });
  }

  const body = {
    tagName: "BODY",
    textContent: bodyText,
    innerHTML: bodyContent,
    nodeName: "BODY",
    querySelector: jest.fn((sel) => {
      if (sel === "article") {
        const articleMatch = bodyContent.match(
          /<article[^>]*>([\s\S]*?)<\/article>/i,
        );
        if (articleMatch) {
          const text = articleMatch[1].replace(/<[^>]+>/g, " ").trim();
          return {
            tagName: "ARTICLE",
            textContent: text,
            innerHTML: articleMatch[1],
            nodeName: "ARTICLE",
            querySelector: jest.fn().mockReturnValue(null),
            querySelectorAll: jest.fn().mockReturnValue([]),
            remove: jest.fn(),
          };
        }
      }
      if (sel === "main") {
        const mainMatch = bodyContent.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
        if (mainMatch) {
          const text = mainMatch[1].replace(/<[^>]+>/g, " ").trim();
          return {
            tagName: "MAIN",
            textContent: text,
            innerHTML: mainMatch[1],
            nodeName: "MAIN",
            querySelector: jest.fn().mockReturnValue(null),
            querySelectorAll: jest.fn().mockReturnValue([]),
            remove: jest.fn(),
          };
        }
      }
      if (sel === "h1") {
        if (h1Match) {
          const text = h1Match[1].replace(/<[^>]+>/g, "").trim();
          return { textContent: text };
        }
      }
      return null;
    }),
    querySelectorAll: jest.fn().mockReturnValue([]),
    remove: jest.fn(),
    cloneNode: function () {
      return this;
    },
  };

  const doc = {
    querySelector: jest.fn((sel) => {
      // Meta tags
      if (sel.includes("meta[property=")) {
        const propMatch = sel.match(/property="([^"]+)"/);
        if (propMatch && metaElements[propMatch[1]]) {
          return {
            getAttribute: jest.fn().mockReturnValue(metaElements[propMatch[1]]),
          };
        }
      }
      if (sel.includes("meta[name=")) {
        const nameMatch = sel.match(/name="([^"]+)"/);
        if (nameMatch && metaElements[nameMatch[1]]) {
          return {
            getAttribute: jest.fn().mockReturnValue(metaElements[nameMatch[1]]),
          };
        }
      }
      if (sel.includes("meta[http-equiv=")) {
        const refreshMatch = html
          ? html.match(/<meta[^>]+http-equiv="refresh"[^>]+content="([^"]+)"/i)
          : null;
        if (refreshMatch) {
          return {
            getAttribute: jest.fn().mockReturnValue(refreshMatch[1]),
          };
        }
      }
      if (sel === "h1") {
        if (h1Match) {
          const text = h1Match[1].replace(/<[^>]+>/g, "").trim();
          return { textContent: text };
        }
      }
      if (sel === "title") {
        if (titleMatch) {
          return { textContent: titleMatch[1].trim() };
        }
      }
      if (sel === "article" || sel === "main" || sel === "[role='main']") {
        return body.querySelector(sel);
      }
      return null;
    }),
    querySelectorAll: jest.fn((sel) => {
      if (sel === 'script[type="application/ld+json"]') {
        return ldJsonElements;
      }
      if (sel === "script") {
        return scriptElements;
      }
      // Return empty NodeList for cleanup selectors
      return {
        forEach: jest.fn(),
        [Symbol.iterator]: function* () {},
        length: 0,
      };
    }),
    body,
    cloneNode: function () {
      return doc;
    },
  };

  return doc;
}

const JSDOM = jest.fn().mockImplementation(function (html, options) {
  const doc = createMockDocument(html || "");
  this.window = {
    document: doc,
    location: { href: options?.url ? options.url : "about:blank" },
  };
});

module.exports = { JSDOM };
module.exports.default = { JSDOM };
