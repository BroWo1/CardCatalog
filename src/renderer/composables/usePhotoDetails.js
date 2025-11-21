export function usePhotoDetails() {
  const nuxtApp = useNuxtApp();
  const photoAlbum = computed(() => nuxtApp.$photoAlbum || null);

  const detailsForm = reactive({
    description: '',
    tags: [],
    newTag: '',
    rating: null,
  });

  const detailsSnapshot = ref({ description: '', tagsKey: '', rating: null });
  const isSaving = ref(false);

  const canSaveDetails = computed(() => {
    if (isSaving.value) {
      return false;
    }
    const normalizedDescription = detailsForm.description.trim();
    const tagsKey = canonicalizeTagsKey(detailsForm.tags);
    const ratingChanged = normalizeRatingValue(detailsForm.rating) !== detailsSnapshot.value.rating;
    return (
      normalizedDescription !== detailsSnapshot.value.description ||
      tagsKey !== detailsSnapshot.value.tagsKey ||
      ratingChanged
    );
  });

  function normalizeRatingValue(value) {
    if (value == null || value === '') {
      return null;
    }
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return null;
    }
    return Math.max(0, Math.min(5, Math.round(num)));
  }

  function coerceTagsArray(value) {
    if (!value) {
      return [];
    }
    if (Array.isArray(value)) {
      return value.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean);
    }
    if (typeof value === 'string' && value.length) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean);
        }
      } catch (_error) {
        // Fall through
      }
      return value
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    }
    return [];
  }

  function canonicalizeTagsKey(tags = []) {
    return coerceTagsArray(tags).join('||');
  }

  function syncDetailsForm(photo) {
    if (!photo) {
      detailsForm.description = '';
      detailsForm.tags = [];
      detailsForm.newTag = '';
      detailsForm.rating = null;
      detailsSnapshot.value = { description: '', tagsKey: '', rating: null };
      return;
    }
    const description = typeof photo.description === 'string' ? photo.description : '';
    const tagsArray = coerceTagsArray(photo.tags);
    detailsForm.description = description;
    detailsForm.tags = [...tagsArray];
    detailsForm.newTag = '';
    detailsForm.rating = normalizeRatingValue(photo.rating);
    detailsSnapshot.value = {
      description: description.trim(),
      tagsKey: canonicalizeTagsKey(tagsArray),
      rating: normalizeRatingValue(photo.rating),
    };
  }

  function normalizeTagValue(tag) {
    if (typeof tag !== 'string') {
      return null;
    }
    const normalized = tag.trim().replace(/\s+/g, ' ');
    return normalized || null;
  }

  function addTag(tag) {
    const normalized = normalizeTagValue(tag);
    if (!normalized) {
      return false;
    }
    const lower = normalized.toLowerCase();
    const exists = detailsForm.tags.some((existing) => existing.toLowerCase() === lower);
    if (!exists) {
      detailsForm.tags.push(normalized);
      return true;
    }
    return false;
  }

  function removeTagAt(index) {
    if (index == null || index < 0 || index >= detailsForm.tags.length) {
      return;
    }
    detailsForm.tags.splice(index, 1);
  }

  function commitTagInput() {
    if (!detailsForm.newTag) {
      return;
    }
    detailsForm.newTag
      .split(',')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .forEach((segment) => addTag(segment));
    detailsForm.newTag = '';
  }

  function handleTagInputKeydown(event) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      commitTagInput();
      return;
    }
    if (event.key === 'Backspace' && !detailsForm.newTag && detailsForm.tags.length) {
      event.preventDefault();
      removeTagAt(detailsForm.tags.length - 1);
    }
  }

  async function saveDetails(photo) {
    if (!photoAlbum.value || !photo) {
      return;
    }
    isSaving.value = true;
    const description = detailsForm.description.trim();
    const tags = [...detailsForm.tags];
    try {
      await photoAlbum.value.updatePhotoDetails(photo.id, {
        description,
        tags,
        rating: normalizeRatingValue(detailsForm.rating),
      });
      detailsSnapshot.value = {
        description,
        tagsKey: canonicalizeTagsKey(tags),
        rating: normalizeRatingValue(detailsForm.rating),
      };
    } catch (error) {
      console.error('[savePhotoDetails] Error:', error);
      throw error;
    } finally {
      isSaving.value = false;
    }
  }

  return {
    detailsForm,
    isSaving,
    canSaveDetails,
    syncDetailsForm,
    saveDetails,
    removeTagAt,
    commitTagInput,
    handleTagInputKeydown,
  };
}
