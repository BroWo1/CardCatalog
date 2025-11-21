export default defineNuxtPlugin(() => {
  const photoAlbum = typeof window !== 'undefined' ? window.photoAlbum : null;

  return {
    provide: {
      photoAlbum,
    },
  };
});
