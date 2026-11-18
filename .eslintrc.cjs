/* eslint-env node */
require('@rushstack/eslint-patch/modern-module-resolution');

module.exports = {
    root: true,
    extends: ['plugin:vue/vue3-essential', 'eslint:recommended', '@vue/eslint-config-prettier'],
    parserOptions: {
        ecmaVersion: 'latest'
    },
    overrides: [
        {
            // Código que corre en Node (Cloud Functions, scripts y pruebas), no en el navegador.
            files: ['functions/**', 'scripts/**', 'tests/**'],
            env: { node: true }
        }
    ],
    rules: {
        'vue/multi-word-component-names': 'off',
        'vue/no-reserved-component-names': 'off',
        'vue/component-tags-order': [
            'error',
            {
                order: ['script', 'template', 'style']
            }
        
    ],
    'prettier/prettier': 'off',
    // Permite `const { quitar, ...resto } = obj` para omitir una propiedad.
    'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    }
};
