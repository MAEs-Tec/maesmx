/* eslint-env node */
require('@rushstack/eslint-patch/modern-module-resolution');

module.exports = {
    root: true,
    extends: ['plugin:vue/vue3-essential', 'eslint:recommended', '@vue/eslint-config-prettier'],
    parserOptions: {
        ecmaVersion: 'latest'
    },
    env: { browser: true, es2022: true },
    overrides: [{ files: ['functions/**/*.js', 'functions/**/*.cjs', 'scripts/**/*.js', 'scripts/**/*.cjs', 'tests/**/*.mjs', 'tests/**/*.cjs', '*.config.js'], env: { node: true } }],
    rules: {
        'no-constant-condition': ['error', { checkLoops: false }],
        'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        'vue/multi-word-component-names': 'off',
        'vue/no-reserved-component-names': 'off',
        'vue/component-tags-order': [
            'error',
            {
                order: ['script', 'template', 'style']
            }
        
    ],
    'prettier/prettier': 'off',
    }
};
