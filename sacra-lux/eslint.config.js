const globals = require('globals');

const commonRules = {
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-redeclare': 'error',
  'no-unreachable': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  'no-var': 'error',
  'prefer-const': 'error'
};

module.exports = [
  {
    ignores: ['node_modules/**', 'public/vendor/**', 'build/**', 'test-results/**']
  },
  {
    files: ['src/**/*.js', 'tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    linterOptions: {
      reportUnusedDisableDirectives: false
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node
      }
    },
    rules: commonRules
  },
  {
    files: ['tests/**/*.js'],
    linterOptions: {
      reportUnusedDisableDirectives: false
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.jest
      }
    },
    rules: commonRules
  },
  {
    files: ['public/**/*.js'],
    ignores: ['public/vendor/**'],
    linterOptions: {
      reportUnusedDisableDirectives: false
    },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser
      }
    },
    rules: commonRules
  }
];
