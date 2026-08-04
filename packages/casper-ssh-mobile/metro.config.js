const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const forkRoot = path.resolve(projectRoot, '../react-native-ssh-sftp-bsc');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), forkRoot];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  'react-native': path.join(projectRoot, 'node_modules/react-native'),
};

module.exports = config;
