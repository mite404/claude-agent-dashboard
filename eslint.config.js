import js from '@eslint/js';
import typescript from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default [
  {
    ignores: ['node_modules', 'dist', '.venv', 'build'],
  },
  js.configs.recommended,
  ...typescript.configs.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      // TypeScript
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-types': 'off',
      // Warn when using `value!` — the `!` tells TypeScript to trust you that a value
      // isn't null/undefined. If you're wrong, it crashes at runtime. Handle null
      // explicitly with `if (value)` or `value ?? fallback` instead.
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // React
      'react/react-in-jsx-scope': 'off', // React 17+ JSX transform
      'react/prop-types': 'off', // Using TypeScript for type checking
      'react/jsx-no-target-blank': 'warn',
      'react/jsx-uses-react': 'off',
      'react/jsx-uses-vars': 'warn',

      // React Hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // General
      'no-console': 'off', // Console logs are fine in dev
      'no-unused-vars': 'off', // Handled by TypeScript rule above
      'prefer-const': 'warn',
      'no-var': 'error',
      // Require `===` instead of `==`. JavaScript's `==` silently coerces types
      // before comparing — `"1" == 1` is true. `===` checks value AND type, always.
      eqeqeq: ['error', 'always'],
      // Prefer `\`Hello ${name}\`` over `"Hello " + name`. Template literals are
      // more readable and less error-prone when mixing strings and values.
      'prefer-template': 'warn',
      // Flag `+val`, `!!val`, `~val` type conversions. Use `Number(val)` and
      // `Boolean(val)` instead — they state intent clearly and are easier to read.
      'no-implicit-coercion': 'error',
      // Warn when reassigning function parameters or their properties. Treat
      // function arguments as read-only inputs — mutating them creates hidden side
      // effects that are difficult to trace. Set to warn (not error) to allow
      // React's `ref.current = node` pattern.
      'no-param-reassign': ['warn', { props: true }],
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
  eslintConfigPrettier,
];
