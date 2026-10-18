import tseslint from 'typescript-eslint';
export default tseslint.config(...tseslint.configs.recommended, {
  files: ['src/**/*.ts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    'no-restricted-globals': ['error', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
    'no-restricted-imports': ['error', { patterns: ['*okf-pamat/src/index*', '*okf-pamat/src/write*', '*okf-pamat/src/store*'] }]
  }
});
