import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      // The classic hook rules. The plugin's React Compiler rules are not used: this app is not
      // compiled with the React Compiler, and they flag ordinary fetch-in-effect code.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
      // Providers export their hooks from the same file by design; fast refresh reloads those files whole.
      "react-refresh/only-export-components": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Untrusted chain and subgraph text must never become markup.
      "no-restricted-syntax": ["error", { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: "Render chain and subgraph text as text." }],
    },
  },
);
