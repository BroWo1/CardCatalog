export function usePhotoFormatter() {
  function formatBytes(bytes) {
    if (!bytes && bytes !== 0) {
      return 'Unknown size';
    }
    if (bytes === 0) {
      return '0 B';
    }
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** exponent;
    return `${value.toFixed(1)} ${units[exponent]}`;
  }

  function formatDateOnly(value) {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return '—';
    }
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function formatTimeOnly(value) {
    if (!value) {
      return '—';
    }
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return '—';
    }
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  function formatFileSize(photo) {
    const parts = [];
    if (photo.fileSizeBytes) {
      parts.push(formatBytes(photo.fileSizeBytes));
    }
    if (photo.width && photo.height) {
      parts.push(`${photo.width} x ${photo.height}`);
    }
    if (photo.format) {
      parts.push(photo.format.toUpperCase());
    }
    return parts.length ? parts.join('  ') : '—';
  }

  function formatCamera(photo) {
    if (photo.cameraMake && photo.cameraModel) {
      return `${photo.cameraMake} ${photo.cameraModel}`;
    }
    return photo.cameraModel || 'Unknown camera';
  }

  function formatExposureSettings(photo) {
    const parts = [];
    if (photo.aperture) {
      parts.push(`f/${Number(photo.aperture).toFixed(1)}`);
    }
    if (photo.shutterSpeedSeconds) {
      const shutter = photo.shutterSpeedSeconds >= 1
        ? `${photo.shutterSpeedSeconds}s`
        : `1/${Math.round(1 / photo.shutterSpeedSeconds)}s`;
      parts.push(shutter);
    }
    return parts.length ? parts.join('  ') : '—';
  }

  function formatIsoFocal(photo) {
    const isoPart = photo.iso ? `ISO ${photo.iso}` : null;
    const focalPart = photo.focalLengthMm ? `${photo.focalLengthMm.toFixed(1)}mm` : null;
    const pieces = [isoPart, focalPart].filter(Boolean);
    return pieces.length ? pieces.join(' · ') : '—';
  }

  function getThumbnailUrl(photo) {
    if (!photo || !photo.thumbnailPath) {
      return null;
    }
    return toFileUrl(photo.thumbnailPath);
  }

  function getFullImageUrl(photo) {
    if (!photo) {
      return null;
    }
    if (photo.filePath) {
      return toFileUrl(photo.filePath);
    }
    if (photo.rawFilePath) {
      return toFileUrl(photo.rawFilePath);
    }
    return null;
  }

  function toFileUrl(absPath) {
    if (!absPath) {
      return null;
    }
    if (absPath.startsWith('file://')) {
      return absPath;
    }
    const normalized = absPath.replace(/\\/g, '/');
    const encoded = normalized
      .split('/')
      .map((part) => encodeURIComponent(part))
      .join('/');
    return `file://${encoded}`;
  }

  return {
    formatBytes,
    formatDateOnly,
    formatTimeOnly,
    formatFileSize,
    formatCamera,
    formatExposureSettings,
    formatIsoFocal,
    getThumbnailUrl,
    getFullImageUrl,
    toFileUrl,
  };
}
