// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  devtools: { enabled: false },
  telemetry: false,
  runtimeConfig: {
    geminiApiKey: '',
  },
  ssr: false,
  vite: {
    server: {
      hmr: {
        port: 3000,
      },
    },
  },
})
