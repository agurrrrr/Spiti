import { defineConfig } from 'vite';

export default defineConfig({
  // 상대 경로: 정적 번들이 하위 경로(예: preview)에서도 열립니다.
  base: './',
  // 프로덕션 서빙은 Dockerfile의 nginx 이미지가 합니다. 아래 dev 서버 설정은 로컬 개발용입니다.
  server: { host: true, port: 5173 },
  build: { chunkSizeWarningLimit: 1200 },
});
