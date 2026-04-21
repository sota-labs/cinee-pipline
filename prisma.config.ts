import { defineConfig } from 'prisma/config';

export default defineConfig({
  datasource: {
    url: process.env.MONGO_URI ?? 'mongodb://localhost:27017/cinee_pipeline',
  },
});
