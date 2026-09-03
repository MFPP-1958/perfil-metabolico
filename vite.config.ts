import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    sourcemap: true,
    rollupOptions: {
      onwarn(warning, warn) {
        const isReactRouterDirective = warning.code === 'MODULE_LEVEL_DIRECTIVE'
          && warning.id?.includes('/react-router/');
        const isReactRouterSourceMap = warning.code === 'SOURCEMAP_ERROR'
          && warning.id?.includes('/react-router/');
        const isZodAnnotation = warning.code === 'INVALID_ANNOTATION'
          && warning.id?.includes('/zod/');
        if (isReactRouterDirective || isReactRouterSourceMap || isZodAnnotation) return;
        warn(warning);
      },
    },
  },
});
