const { withGradleProperties } = require('@expo/config-plugins');

module.exports = function withGradleMemory(config) {
  return withGradleProperties(config, (configWithProperties) => {
    const properties = configWithProperties.modResults;
    const jvmArgs = '-Xmx3072m -XX:MaxMetaspaceSize=768m -Dfile.encoding=UTF-8';
    const existing = properties.find(
      (property) => property.type === 'property' && property.key === 'org.gradle.jvmargs',
    );
    if (existing) {
      existing.value = jvmArgs;
    } else {
      properties.push({ type: 'property', key: 'org.gradle.jvmargs', value: jvmArgs });
    }
    return configWithProperties;
  });
};
