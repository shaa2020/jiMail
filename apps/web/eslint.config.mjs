import next from 'eslint-config-next';

const config = [
  ...next,
  { ignores: ['.next/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts'] },
  {
    rules: {
      // Advisory React Compiler rule: we deliberately seed editable form state from fetched query data
      // in effects. Kept visible as a warning rather than an error.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];
export default config;
