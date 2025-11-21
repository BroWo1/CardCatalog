export function usePhotoZoom() {
  const imageZoom = ref(1);
  const imagePan = reactive({ x: 0, y: 0 });
  const isPanning = ref(false);
  const panStart = reactive({ x: 0, y: 0 });
  const pointerOrigin = reactive({ x: 0, y: 0 });
  const photoZoomContainerRef = ref(null);
  const photoZoomImageRef = ref(null);

  const MIN_ZOOM = 0.75;
  const MAX_ZOOM = 5;
  const BUTTON_ZOOM_STEP = 0.25;
  const SCROLL_SENSITIVITY = 0.001;
  const MIN_SCROLL_FACTOR = 0.85;
  const MAX_SCROLL_FACTOR = 1.15;

  const imageTransformStyles = computed(() => ({
    transform: `translate(${imagePan.x}px, ${imagePan.y}px) scale(${imageZoom.value})`,
    cursor: imageZoom.value > 1 ? (isPanning.value ? 'grabbing' : 'grab') : 'default',
    transition: isPanning.value ? 'none' : 'transform 0.15s ease-out',
  }));

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizeWheelDelta(event) {
    if (event.deltaMode === 1) {
      return event.deltaY * 32;
    }
    if (event.deltaMode === 2) {
      return event.deltaY * 320;
    }
    return event.deltaY;
  }

  function getImageMetrics() {
    const container = photoZoomContainerRef.value;
    const img = photoZoomImageRef.value;
    if (!container || !img?.naturalWidth || !img?.naturalHeight) {
      return null;
    }
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    if (!containerWidth || !containerHeight) {
      return null;
    }
    const imageRatio = img.naturalWidth / img.naturalHeight;
    const containerRatio = containerWidth / containerHeight;
    let baseWidth;
    let baseHeight;
    if (imageRatio > containerRatio) {
      baseWidth = containerWidth;
      baseHeight = containerWidth / imageRatio;
    } else {
      baseHeight = containerHeight;
      baseWidth = containerHeight * imageRatio;
    }
    return {
      containerWidth,
      containerHeight,
      baseWidth,
      baseHeight,
    };
  }

  function clampPan() {
    const metrics = getImageMetrics();
    if (!metrics) {
      imagePan.x = 0;
      imagePan.y = 0;
      return;
    }
    const scaledWidth = metrics.baseWidth * imageZoom.value;
    const scaledHeight = metrics.baseHeight * imageZoom.value;
    const maxX = Math.max(0, (scaledWidth - metrics.containerWidth) / 2);
    const maxY = Math.max(0, (scaledHeight - metrics.containerHeight) / 2);
    imagePan.x = clamp(imagePan.x, -maxX, maxX);
    imagePan.y = clamp(imagePan.y, -maxY, maxY);
  }

  function adjustPanForZoom(targetZoom, origin) {
    const container = photoZoomContainerRef.value;
    if (!container || !origin || !imageZoom.value) {
      return;
    }
    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const offsetX = origin.x - centerX;
    const offsetY = origin.y - centerY;
    const zoomRatio = targetZoom / imageZoom.value;
    if (!Number.isFinite(zoomRatio) || zoomRatio === 1) {
      return;
    }
    imagePan.x = (1 - zoomRatio) * offsetX + zoomRatio * imagePan.x;
    imagePan.y = (1 - zoomRatio) * offsetY + zoomRatio * imagePan.y;
  }

  function setZoom(nextZoom, options = {}) {
    const clamped = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (options?.origin && clamped !== imageZoom.value) {
      adjustPanForZoom(clamped, options.origin);
    }
    imageZoom.value = clamped;
    clampPan();
  }

  function zoomIn() {
    setZoom(imageZoom.value + BUTTON_ZOOM_STEP);
  }

  function zoomOut() {
    setZoom(imageZoom.value - BUTTON_ZOOM_STEP);
  }

  function resetZoom() {
    imageZoom.value = 1;
    imagePan.x = 0;
    imagePan.y = 0;
    isPanning.value = false;
  }

  function handleWheelZoom(event) {
    const deltaY = normalizeWheelDelta(event);
    if (!Number.isFinite(deltaY) || deltaY === 0) {
      return;
    }
    const direction = -deltaY;
    const scaleFactor = clamp(
      Math.exp(direction * SCROLL_SENSITIVITY),
      MIN_SCROLL_FACTOR,
      MAX_SCROLL_FACTOR,
    );
    setZoom(imageZoom.value * scaleFactor, {
      origin: { x: event.clientX, y: event.clientY },
    });
  }

  function startImagePan(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    if (imageZoom.value <= 1) {
      return;
    }
    isPanning.value = true;
    panStart.x = imagePan.x;
    panStart.y = imagePan.y;
    pointerOrigin.x = event.clientX;
    pointerOrigin.y = event.clientY;
    event.currentTarget?.setPointerCapture?.(event.pointerId);
  }

  function handleImagePan(event) {
    if (!isPanning.value) {
      return;
    }
    const deltaX = event.clientX - pointerOrigin.x;
    const deltaY = event.clientY - pointerOrigin.y;
    imagePan.x = panStart.x + deltaX;
    imagePan.y = panStart.y + deltaY;
    clampPan();
  }

  function endImagePan(event) {
    if (!isPanning.value) {
      return;
    }
    isPanning.value = false;
    if (event.currentTarget?.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    clampPan();
  }

  return {
    imageZoom,
    imagePan,
    imageTransformStyles,
    photoZoomContainerRef,
    photoZoomImageRef,
    zoomIn,
    zoomOut,
    resetZoom,
    handleWheelZoom,
    startImagePan,
    handleImagePan,
    endImagePan,
  };
}
