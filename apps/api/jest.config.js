/** @type {import('jest').Config} */
const swc = ['@swc/jest', {
  jsc: { parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true }, target: 'es2022' },
  module: { type: 'commonjs' },
}];
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': swc,
    // ESM-only dependencies of sanitize-html must be compiled to CommonJS for Jest.
    '^.+/(htmlparser2|domhandler|domutils|dom-serializer|entities|domelementtype)/.+\\.js$': ['@swc/jest', { module: { type: 'commonjs' } }],
  },
  transformIgnorePatterns: ['/node_modules/(?!(\\.pnpm/[^/]+/node_modules/)?(htmlparser2|domhandler|domutils|dom-serializer|entities|domelementtype)/)'],
  setupFiles: ['<rootDir>/test/support/env.js'],
  testTimeout: 120000,
};
