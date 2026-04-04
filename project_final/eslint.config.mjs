import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      // Innecesario con TypeScript — los tipos ya validan los props
      "react/prop-types": "off",
      // Degradado a advertencia para corregir gradualmente
      "@typescript-eslint/no-explicit-any": "warn",
    },
    settings: {
      react: { version: "detect" }
    }
  },
  {
    ignores: ["dist/", "node_modules/", "src/imports/"]
  }
);
