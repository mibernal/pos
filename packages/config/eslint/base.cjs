module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  env: {
    es2022: true,
    node: true
  },
  ignorePatterns: ['dist', 'build', 'node_modules'],
  rules: {
    // `any` es deuda técnica medible, no un defecto de corrección: se reporta en cada
    // ejecución de lint para poder bajarlo progresivamente, pero no bloquea el build.
    // `no-unused-vars` sí es error: casi siempre señala código muerto o cableado incompleto.
    '@typescript-eslint/no-explicit-any': 'warn',
    // Allow underscore-prefixed identifiers as intentionally unused (standard TS idiom)
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_'
      }
    ]
  }
};
