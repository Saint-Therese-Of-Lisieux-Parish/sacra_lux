const globals = require('globals');
const html = require('eslint-plugin-html');
const security = require('eslint-plugin-security');

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
    files: ['public/**/*.js', 'public/*.html'],
    ignores: ['public/vendor/**'],
    plugins: { html },
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
  },
  {
    files: ['src/**/*.js', 'scripts/**/*.js', 'public/**/*.js', 'public/*.html'],
    ignores: ['public/vendor/**'],
    plugins: { security },
    rules: {
      ...Object.fromEntries(
        Object.keys(security.configs.recommended.rules).map((name) => [name, 'error'])
      ),
      // These two rules flag nearly every indexed read and every fs call (about 315 findings).
      // The app builds file paths from user-chosen folders by design, and CodeQL covers path injection.
      'security/detect-object-injection': 'off',
      'security/detect-non-literal-fs-filename': 'off'
    }
  }
];
