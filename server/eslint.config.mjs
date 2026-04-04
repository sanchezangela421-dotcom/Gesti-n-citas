import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Degradado a advertencia para corregir gradualmente
      "@typescript-eslint/no-explicit-any": "warn",
      // Ignorar variables con prefijo _ (convención para descartar intencionalmente)
      "@typescript-eslint/no-unused-vars": ["error", {
        "varsIgnorePattern": "^_",
        "argsIgnorePattern": "^_",
        "caughtErrorsIgnorePattern": "^_"
      }]
    }
  },
  {
    ignores: ["dist/", "node_modules/"]
  }
);
