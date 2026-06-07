// Flat ESLint config (ESLint v9). Lints src + test with typescript-eslint's
// recommended rules. Kept pragmatic: this is a gate that should pass on a clean
// tree, not a style crusade.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/**', 'examples/**', 'bin/**', '*.config.js'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
);
