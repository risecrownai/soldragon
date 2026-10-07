# Cloudflare Pages + D1 배포 가이드

구성: 정적 파일(`public/`) + Pages Functions(`functions/api/[[path]].js` → `src/api.js`) + D1(SQLite) 데이터베이스. 모두 Cloudflare 무료 플랜 범위에서 시작할 수 있습니다(한도는 Cloudflare 요금 문서 확인).

## 1. 구글 OAuth 클라이언트 ID 만들기 (로그인용)
1. https://console.cloud.google.com → 프로젝트 만들기 → *API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID*
2. 유형 **웹 애플리케이션**, *승인된 JavaScript 원본*에 사이트 주소를 추가합니다(예: `https://soldragon.pages.dev`, 사용자 지정 도메인이 있으면 그것도, 로컬 테스트는 `http://localhost:8788`).
3. 만들어진 **클라이언트 ID**(`…apps.googleusercontent.com`)를 복사합니다. 클라이언트 보안 비밀은 필요 없습니다(서버가 ID 토큰의 서명·발급자·대상(aud)·만료를 직접 검증).

## 2. D1 데이터베이스 만들기
```bash
npm i -D wrangler
npx wrangler login
npx wrangler d1 create soldragon          # 출력된 database_id 를 복사
```
`wrangler.toml`의 `database_id = "REPLACE_WITH_YOUR_D1_DATABASE_ID"` 를 복사한 값으로 바꾸고, 같은 파일 `[vars]`의 `GOOGLE_CLIENT_ID` 에 1단계의 클라이언트 ID를, (선택) `ADMIN_EMAILS` 에 댓글을 지울 수 있는 관리자 이메일(쉼표 구분)을 넣습니다. 그다음 테이블을 만듭니다.
```bash
npx wrangler d1 migrations apply soldragon --remote
```

## 3. Pages 프로젝트 만들기
방법 A (Git 연결, 권장): Cloudflare 대시보드 → *Workers & Pages → Create → Pages → Connect to Git* → 이 저장소 선택 → Framework preset **None**, Build command 비움, Build output directory **`public`**.
방법 B (직접 업로드): `npx wrangler pages deploy public --project-name soldragon`

그다음 프로젝트 *Settings → Bindings*에서 **D1 database** 바인딩을 추가합니다(변수 이름 `DB`, 데이터베이스 `soldragon`). `wrangler.toml`이 있으면 대시보드가 바인딩·변수를 그 파일에서 읽으므로 이미 설정되어 있을 수 있습니다(Production과 Preview 둘 다 확인).

## 4. 세션 비밀키 등록 (필수)
로그인 쿠키 서명용 32자 이상의 무작위 문자열입니다. 저장소에 올리지 마세요.
```bash
openssl rand -base64 48
npx wrangler pages secret put SESSION_SECRET --project-name soldragon
```
(대시보드의 *Settings → Variables and Secrets*에서 **Secret** 타입으로 추가해도 됩니다.) 비밀키를 바꾸면 모두 로그아웃됩니다. 환경 변수 `GOOGLE_JWKS_URL`은 테스트 전용이니 운영에서는 **설정하지 마세요**.

## 5. 확인
배포 주소를 열면 상단에 **로그인** 버튼이 보입니다. 보이지 않으면 `/api/config` 가 `{"ready":true,...}` 를 돌려주는지 확인하세요(`false`이면 `DB` 바인딩, `GOOGLE_CLIENT_ID`, `SESSION_SECRET` 중 빠진 것이 있는 것입니다). 이 경우 사이트는 브라우저 저장 모드로 동작합니다.

## 로컬에서 시험하기
```bash
cat > .dev.vars <<'EOV'
SESSION_SECRET=아무_무작위_32자_이상
GOOGLE_CLIENT_ID=내_클라이언트_ID
EOV
npx wrangler d1 migrations apply soldragon --local
npx wrangler pages dev public            # http://localhost:8788
```

## 동작 규칙 요약
| 기능 | 조건 |
| --- | --- |
| 기본 경전 읽기·낭독 | 누구나 (코드에 포함) |
| 공개 경전 읽기 | 누구나 |
| 비공개 경전 읽기 | 작성자만 (서버가 목록·조회에서 걸러냄) |
| 경전 추가·수정·삭제·가져오기 | 구글 로그인 + 서명으로 묶은 지갑, 내 경전만 |
| 좋아요/싫어요, 점수(1~5), 댓글(100자) | 로그인한 사용자, 기본·공개 경전에만. 1인 1표·1점, 댓글은 분당 5개·하루 100개 제한 |
| 댓글 삭제 | 작성자 또는 `ADMIN_EMAILS` |
| 계정 삭제 | 본인 — 계정·경전·댓글·표·지갑 연결 모두 삭제 |

보안: 모든 SQL은 바인딩 사용, 쿠키는 HttpOnly·SameSite=Lax(https에서 Secure), 상태 변경 요청은 같은 출처 + `x-requested-with` 헤더 + JSON 형식을 요구(CSRF 방어), 지갑 서명은 1회용 nonce(5분)로 서버에서 Ed25519 검증, 이메일은 다른 사용자에게 노출하지 않음, 화면은 사용자 글을 `textContent`로만 표시.
