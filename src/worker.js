// Cloudflare Workers 진입점. /api/* 요청만 이 코드가 처리하고, 나머지(화면 파일)는 정적 자산으로 바로 제공된다(wrangler.jsonc의 run_worker_first).
import { handleRequest } from "./api.js";

export default {
  fetch: (request, env) => handleRequest(request, env),
};
