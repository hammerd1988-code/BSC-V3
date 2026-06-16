// Shim for import.meta.url in CJS bundles
// This is injected by esbuild to provide a valid value when ESM code uses import.meta.url
const { pathToFileURL } = require('url');
const import_meta_url = pathToFileURL(__filename).href;
