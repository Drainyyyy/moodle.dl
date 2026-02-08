module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true,
    webextensions: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.json'],
    tsconfigRootDir: __dirname,
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  extends: ['airbnb-base', 'airbnb-typescript/base', 'prettier'],
  plugins: ['@typescript-eslint', 'import'],
  rules: {
    // Browser extensions often log for diagnostics; gate logs via feature flag in code.
    'no-console': 'off',
    // Vite/TS bundler handles extensions.
    'import/extensions': 'off',
    'import/no-extraneous-dependencies': [
      'error',
      {
        devDependencies: ['**/*.config.ts', 'vite.config.ts', 'vitest.config.ts', 'tests/**', 'scripts/**'],
      },
    ],
  },
  overrides: [
    {
      files: ['scripts/**/*.mjs'],
      parserOptions: {
        project: null,
      },
      rules: {
        'import/no-extraneous-dependencies': 'off',
      },
    },
  ],
};
