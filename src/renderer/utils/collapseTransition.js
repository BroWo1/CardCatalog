export function createCollapseTransition(options = {}) {
  const {
    duration = 280,
    opacityDuration = 200,
    easing = 'cubic-bezier(0.33, 1, 0.68, 1)',
    axis = 'height',
    lockFlex = false,
  } = options;

  const dimension = axis === 'width' ? 'width' : 'height';
  const scrollDimension = axis === 'width' ? 'scrollWidth' : 'scrollHeight';
  const rectDimension = axis === 'width' ? 'width' : 'height';
  const targetSizeKey = Symbol('collapseTargetSize');
  const flexCacheKey = Symbol('collapseOriginalFlex');

  const raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (cb) => setTimeout(cb, 16);

  const ensureDisplay = (el) => {
    if (typeof window === 'undefined') {
      return;
    }
    const display = window.getComputedStyle(el).display;
    if (display === 'none') {
      el.style.display = '';
    }
  };

  const measureSize = (el) => {
    ensureDisplay(el);
    const scrollSize = el[scrollDimension];
    if (scrollSize && Number.isFinite(scrollSize)) {
      return scrollSize;
    }
    const rect = el.getBoundingClientRect();
    return rect[rectDimension] || 0;
  };

  const setTransition = (el) => {
    el.style.transition = `${dimension} ${duration}ms ${easing}, opacity ${opacityDuration}ms ease`;
    el.style.willChange = `${dimension}, opacity`;
  };

  const clearTransition = (el) => {
    el.style.transition = '';
    el.style.overflow = '';
    el.style.willChange = '';
    el.style[dimension] = '';
    el.style.opacity = '';
  };

  const setFixedFlex = (el) => {
    if (!lockFlex) {
      return;
    }
    if (el[flexCacheKey] === undefined) {
      el[flexCacheKey] = el.style.flex || '';
    }
    el.style.flex = '0 0 auto';
  };

  const restoreFlex = (el) => {
    if (!lockFlex) {
      return;
    }
    const original = el[flexCacheKey];
    if (original !== undefined) {
      el.style.flex = original;
      delete el[flexCacheKey];
    } else {
      el.style.flex = '';
    }
  };

  const storeTargetSize = (el, size) => {
    el[targetSizeKey] = size;
  };

  const consumeTargetSize = (el) => {
    const size = el[targetSizeKey];
    delete el[targetSizeKey];
    return size;
  };

  return {
    beforeEnter(el) {
      const targetSize = measureSize(el);
      storeTargetSize(el, targetSize);
      setFixedFlex(el);
      el.style[dimension] = '0px';
      el.style.opacity = '0';
      el.style.overflow = 'hidden';
    },
    enter(el) {
      const targetSize = consumeTargetSize(el) ?? measureSize(el);
      setTransition(el);
      raf(() => {
        el.style[dimension] = `${targetSize}px`;
        el.style.opacity = '1';
      });
    },
    afterEnter(el) {
      restoreFlex(el);
      clearTransition(el);
    },
    beforeLeave(el) {
      const currentSize = measureSize(el);
      storeTargetSize(el, currentSize);
      setFixedFlex(el);
      el.style[dimension] = `${currentSize}px`;
      el.style.opacity = '1';
      el.style.overflow = 'hidden';
    },
    leave(el) {
      setTransition(el);
      raf(() => {
        el.style[dimension] = '0px';
        el.style.opacity = '0';
      });
    },
    afterLeave(el) {
      consumeTargetSize(el);
      restoreFlex(el);
      clearTransition(el);
    },
  };
}
