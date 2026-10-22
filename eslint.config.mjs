/** Blocking documentation checks for the shared release boundary. @file */
import jsdoc from "eslint-plugin-jsdoc";

export default [
  { ignores: ["node_modules/**", ".consumer-fixtures/**"] },
  {
    files: ["**/*.mjs"],
    plugins: { jsdoc },
    rules: {
      "jsdoc/require-jsdoc": [
        "error",
        { require: { FunctionDeclaration: true } },
      ],
      "jsdoc/require-description": "error",
      "jsdoc/check-param-names": "error",
      "jsdoc/check-tag-names": "error",
    },
  },
];
