module.exports = {
  root: true,
  env: {
    browser: true,
    node: true,
    es2022: true,
    webextensions: true,
  },
  // Keep the root config minimal; TS type-aware rules are enabled only for TS files via overrides.
  extends: ['prettier'],
  rules: {
    // Browser extensions often log for diagnostics; gate logs via feature flags in code.
    'no-console': 'off',
    // Vite/TS bundler resolves extensions.
    'import/extensions': 'off',
  },
  overrides: [
    {
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: __dirname,
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      extends: ['airbnb-typescript/base', 'prettier'],
      plugins: ['@typescript-eslint', 'import'],
      rules: {
        'import/no-extraneous-dependencies': [
          'error',
          {
            devDependencies: [
              '**/*.config.ts',
              'vite.config.ts',
              'vitest.config.ts',
              'tests/**',
              'scripts/**',
            ],
          },
        ],
      },
    },
    {
      files: ['scripts/**/*.mjs', '**/*.cjs', '**/*.js'],
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      extends: ['airbnb-base', 'prettier'],
      rules: {
        // Scripts are plain JS; do not require TS parser services.
        'import/no-extraneous-dependencies': 'off',
      },
    },
  ],
};
