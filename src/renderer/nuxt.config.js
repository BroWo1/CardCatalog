import { defineNuxtConfig } from 'nuxt/config';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const rendererDir = dirname(fileURLToPath(import.meta.url));
const manifestDir = resolve(rendererDir, '.nuxt/manifest');
const manifestMetaDir = resolve(manifestDir, 'meta');
const manifestRequestId = '#app-manifest';
const virtualManifestId = '\0virtual:app-manifest';
const fallbackManifest = {
  id: 'dev',
  timestamp: 0,
  matcher: { static: {}, wildcard: {}, dynamic: {} },
  prerendered: [],
};

const baseURL = process.env.NUXT_APP_BASE_URL || '/';
const assetsDir = process.env.NUXT_APP_BUILD_ASSETS_DIR || '_nuxt/';

const readManifestFile = (filePath) => {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
};

const resolveManifestData = () => {
  const latest = readManifestFile(resolve(manifestDir, 'latest.json'));
  if (latest?.id) {
    const candidate = readManifestFile(resolve(manifestMetaDir, `${latest.id}.json`));
    if (candidate) {
      return candidate;
    }
  }

  const devManifest = readManifestFile(resolve(manifestMetaDir, 'dev.json'));
  return devManifest || fallbackManifest;
};

const createManifestModuleSource = () => {
  const manifest = resolveManifestData();
  return [
    `const manifest = ${JSON.stringify(manifest)};`,
    'export const id = manifest.id;',
    'export const timestamp = manifest.timestamp;',
    'export const matcher = manifest.matcher || { static: {}, wildcard: {}, dynamic: {} };',
    'export const prerendered = manifest.prerendered || [];',
    'export default manifest;',
  ].join('\n');
};

const virtualManifestPlugin = () => ({
  name: 'cardcatalog:virtual-app-manifest',
  enforce: 'pre',
  resolveId(id) {
    if (id === manifestRequestId) {
      return virtualManifestId;
    }
  },
  load(id) {
    if (id === virtualManifestId) {
      return createManifestModuleSource();
    }
  },
});

export default defineNuxtConfig({
  ssr: false,
  modules: ['@nuxtjs/color-mode', '@nuxt/ui'],
  css: ['~/assets/css/main.css'],
  devtools: false,
  app: {
    baseURL,
    buildAssetsDir: assetsDir.endsWith('/') ? assetsDir : `${assetsDir}/`,
    head: {
      title: 'CardCatalog',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      ],
    },
  },
  colorMode: {
    preference: 'light',
    fallback: 'light',
    classSuffix: '',
    storageKey: 'cardcatalog-color-mode',
  },
  ui: {
    primary: 'violet',
    gray: 'slate',
  },
  router: {
    options: {
      hashMode: true,
    },
  },
  hooks: {
    'nitro:config'(nitroConfig) {
      if (nitroConfig.alias?.[manifestRequestId] || nitroConfig.virtual?.[manifestRequestId]) {
        return;
      }

      nitroConfig.virtual ||= {};
      nitroConfig.virtual[manifestRequestId] = createManifestModuleSource();
    },
  },
  vite: {
    plugins: [virtualManifestPlugin()],
  },
});
