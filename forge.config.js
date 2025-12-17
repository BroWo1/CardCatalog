const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

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
    osxSign: {
      optionsForFile: (filePath) => {
        return {
          entitlements: 'entitlements.plist'
        };
      }
    },
    osxNotarize: {
      appleId: 'will.zhangyang.li@gmail.com',
      appleIdPassword: 'shtd-udhq-pfwk-akbt',
      teamId: '3TGZ85KSRW'
    }
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
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
