import js from "@eslint/js";
import typescript from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import eslintConfigPrettier from "eslint-config-prettier/flat";

export default [
  {
    ignores: ["node_modules", "dist", ".venv", "build"],
  },
  js.configs.recommended,
  ...typescript.configs.recommended,
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
      },
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    rules: {
      // TypeScript
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-types": "off",

      // React
      "react/react-in-jsx-scope": "off", // React 17+ JSX transform
      "react/prop-types": "off", // Using TypeScript for type checking
      "react/jsx-no-target-blank": "warn",
      "react/jsx-uses-react": "off",
      "react/jsx-uses-vars": "warn",

      // React Hooks
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // General
      "no-console": "off", // Console logs are fine in dev
      "no-unused-vars": "off", // Handled by TypeScript rule above
      "prefer-const": "warn",
      "no-var": "error",
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  eslintConfigPrettier,
];
