/**
 * Mock implementation of p-limit for Jest tests
 *
 * p-limit is an ESM module that causes issues with Jest.
 * This mock provides a simple implementation that works in tests.
 */

module.exports = function pLimit(concurrency) {
  return async function (fn) {
    return fn();
  };
};

// Support both default and named exports
module.exports.default = module.exports;
