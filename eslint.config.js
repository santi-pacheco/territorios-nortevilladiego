import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/dist-mobile/**', '**/node_modules/**', 'apps/mobile/android/**', 'apps/mobile/ios/**'] },
  js.configs.recommended,
  { files: ['scripts/**/*.mjs', '*.config.{js,ts}'], languageOptions: { globals: globals.node } },
  { files: ['apps/web/src/**'], languageOptions: { globals: globals.browser } },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.property.name='setHTML']", message: 'XSS: use setDOMContent with textContent.' },
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: 'XSS: no raw HTML.' },
      ],
    },
  },
);
