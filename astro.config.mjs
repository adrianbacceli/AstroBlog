// @ts-check

import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // ← set your real URL or GH Pages URL
  site: 'https://blog.example.com',

  output: 'static',
  integrations: [mdx(), sitemap()],
  markdown: { shikiConfig: { theme: 'one-dark-pro' } },

  vite: {
    plugins: [tailwindcss()]
  }
});