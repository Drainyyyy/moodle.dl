/* eslint-env node */
module.exports = {
  root: true,

  env: {
    es2022: true,
    browser: true,
  },

  // Default parser – für TS Overrides wird er ergänzt
  parser: '@typescript-eslint/parser',

  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },

  plugins: ['@typescript-eslint'],

  // ❗️WICHTIG: KEINE "requiring-type-checking" Regeln hier oben!
  extends: [
    'airbnb-base',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],

  overrides: [
    // ✅ Type-aware Linting NUR für TS/TSX
    {
      files: ['**/*.ts', '**/*.tsx'],
      extends: [
        'airbnb-typescript/base',
        'plugin:@typescript-eslint/recommended-requiring-type-checking',
      ],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        project: ['./tsconfig.json'],
        tsconfigRootDir: __dirname,
      },
    },

    // ✅ Node-Skripte (mjs/js) ohne TS-Type-Regeln
    {
      files: ['scripts/**/*.mjs', 'scripts/**/*.js', '**/*.mjs', '**/*.js'],
      env: { node: true, browser: false },
      parser: 'espree',
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      rules: {
        // alles TypeScript-spezifische aus
        '@typescript-eslint/await-thenable': 'off',
        '@typescript-eslint/no-floating-promises': 'off',
        '@typescript-eslint/no-misused-promises': 'off',
        '@typescript-eslint/restrict-template-expressions': 'off',
        '@typescript-eslint/require-await': 'off',
        '@typescript-eslint/dot-notation': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        '@typescript-eslint/no-unsafe-call': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-argument': 'off',
        '@typescript-eslint/no-unsafe-return': 'off',
      },
    },
  ],
};
