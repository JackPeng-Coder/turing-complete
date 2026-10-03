/// <reference types="vite/client" />

// `vite/client` supplies the ambient declarations this project needs and cannot
// get from a dependency: the `*.css` module that `src/main.ts` imports for its
// side effect, and the `*?raw` modules plus `import.meta.glob` that
// `test/conventions.test.ts` reads the sources with.
//
// It lives here rather than in `tsconfig.json`'s `types` array because that
// array is ["vitest/globals"]: listing a second entry there would add Vite's
// globals to every file in the program, while this reference is loaded once and
// is the documented way to pull in the client types.
