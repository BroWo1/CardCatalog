const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

const SHOULD_SIGN_MAC = process.platform === 'darwin' && process.env.MAC_SIGN === '1';
const SHOULD_NOTARIZE_MAC = SHOULD_SIGN_MAC && process.env.MAC_NOTARIZE === '1';

module.exports = {
  packagerConfig: {
    asar: {
      unpack: '**/node_modules/{onnxruntime-node,sharp}/**'
    },
    icon: process.platform === 'win32'
      ? 'src/assets/CardCatalog.ico'
      : 'src/assets/CardCatalog.icns',
    extraResource: [
      'models'
    ],
    ...(SHOULD_SIGN_MAC
      ? {
          osxSign: {
            optionsForFile: () => {
              return {
                entitlements: 'entitlements.plist'
              };
            }
          }
        }
      : {}),
    ...(SHOULD_NOTARIZE_MAC
      ? {
          osxNotarize: {
            appleId: process.env.APPLE_ID,
            appleIdPassword: process.env.APPLE_ID_PASSWORD,
            teamId: process.env.APPLE_TEAM_ID
          }
        }
      : {})
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'win32'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
