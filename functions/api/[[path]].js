// /api/* 요청을 모두 src/api.js의 라우터로 보낸다. (정적 파일은 Pages가 public/에서 직접 제공)
import { handleRequest } from "../../src/api.js";

export const onRequest = ({ request, env }) => handleRequest(request, env);
