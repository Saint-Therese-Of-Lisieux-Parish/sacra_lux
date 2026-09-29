"use strict";

/**
 * Guard against several screen windows reporting the end of the same movie.
 *
 * Each configured display opens its own `/screen` window and each window can
 * emit `slide:video-ended`. The first report for a given slide is the one that
 * advances the liturgy; every later report for that same slide and index is
 * ignored. Reaching a different slide, or the same slide again at a different
 * position, is a fresh event.
 */
function createMovieEndGuard() {
  let handled = null;

  return {
    alreadyHandled(index, slideId) {
      return Boolean(handled) && handled.index === index && handled.slideId === String(slideId || "");
    },
    markHandled(index, slideId) {
      handled = { index, slideId: String(slideId || "") };
    },
    reset() {
      handled = null;
    }
  };
}

module.exports = { createMovieEndGuard };
