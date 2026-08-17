/**
 * Small gaps in older browsers, filled before anything else runs.
 *
 * The one that matters is Promise.withResolvers, which arrived in Safari 17.4.
 * pdf.js calls it, so on an older iPhone the PDF reader died with "undefined is
 * not a function" the moment someone chose a file. The vendored pdf.js is now
 * the legacy build, which carries its own polyfill — this is the belt to that
 * pair of braces, and it also covers our own code.
 *
 * Each of these is a no-op on a browser that already has the feature.
 */

if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function withResolvers() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

if (typeof Object.hasOwn !== 'function') {
  Object.hasOwn = (target, property) =>
    Object.prototype.hasOwnProperty.call(Object(target), property);
}

if (!Array.prototype.at) {
  // eslint-disable-next-line no-extend-native
  Array.prototype.at = function at(index) {
    const i = Math.trunc(index) || 0;
    return this[i < 0 ? this.length + i : i];
  };
}

if (!String.prototype.at) {
  // eslint-disable-next-line no-extend-native
  String.prototype.at = function at(index) {
    const i = Math.trunc(index) || 0;
    return this[i < 0 ? this.length + i : i];
  };
}

if (!Array.prototype.findLast) {
  // eslint-disable-next-line no-extend-native
  Array.prototype.findLast = function findLast(predicate, thisArg) {
    for (let i = this.length - 1; i >= 0; i -= 1) {
      if (predicate.call(thisArg, this[i], i, this)) return this[i];
    }
    return undefined;
  };
}

/**
 * Reports whether this browser can compress a share link. Where it cannot,
 * sharing falls back to the downloadable challenge file instead of failing.
 */
export const canCompress = typeof CompressionStream !== 'undefined';
