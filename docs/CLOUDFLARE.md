# Cloudflare Workers + D1 배포 가이드 (웹 대시보드만 사용)

PC에 아무것도 설치하지 않고 **브라우저만으로** 배포합니다. 구성: 화면 파일(`public/`, 정적 자산) + Worker(`src/worker.js` → `src/api.js`, `/api/*` 처리) + D1(SQLite) 데이터베이스. 설정은 저장소의 `wrangler.jsonc`에 있습니다. 로그인은 **지갑 서명**이라 구글 등 외부 서비스 설정이 필요 없습니다.

> 최근 Cloudflare 대시보드는 Git 저장소를 연결하면 Pages가 아니라 **Workers**로 프로젝트를 만듭니다. 이 저장소는 그 방식에 맞춰져 있습니다. ("Bindings cannot be added to a Worker that only has static assets" 오류는 Worker 코드(`main`)가 없는 프로젝트라서 나는 것이며, 이 저장소의 `wrangler.jsonc`로 배포하면 사라집니다.)

## 1. D1 데이터베이스 만들기
1. 대시보드 왼쪽 *Storage & Databases → D1 SQL Database → Create database*
2. 이름 `soldragon` → Create
3. 만든 DB의 **Console** 탭에 저장소의 [`migrations/0001_init.sql`](../migrations/0001_init.sql) 내용을 **전부 붙여 넣고 실행**합니다. (이 파일에는 주석이 없습니다. D1 콘솔은 줄바꿈을 없애고 실행하므로 `--` 주석이 있으면 뒤 내용이 모두 주석 처리되어 `incomplete input` 오류가 납니다. 한 번에 안 되면 `CREATE …;` 문장을 하나씩 나눠 실행하세요.)
4. *Tables*에 `users, nonces, sutras, reactions, comments` 5개가 보이면 성공입니다.
5. DB 화면(Overview)에서 **Database ID**(`xxxxxxxx-xxxx-…` 형식)를 복사합니다.

## 2. wrangler.jsonc에 Database ID 넣기
GitHub 저장소 웹 화면에서 `wrangler.jsonc`를 열고 연필(✎) 아이콘으로 편집합니다. `"database_id": "REPLACE_WITH_YOUR_D1_DATABASE_ID"` 의 값을 1단계에서 복사한 ID로 바꾸고 커밋합니다(배포할 브랜치에 바로 커밋). Database ID는 비밀 값이 아닙니다. 관리자 지갑을 쓰려면 `"ADMIN_WALLETS"` 에 지갑 주소(여러 개면 쉼표로 구분)도 적습니다.

## 3. Worker 프로젝트 만들기 (Git 연결)
1. *Workers & Pages → Create application → Import a repository(Connect to Git)* 에서 GitHub 저장소 `soldragon`을 선택합니다(조직 저장소면 Cloudflare 앱에 접근을 허용).
2. 설정: Project name `soldragon`, Production branch `main`, **Build command 비움**, **Deploy command `npx wrangler deploy`**(기본값), Root directory 비움.
3. *Save and Deploy*. 배포가 끝나면 `https://soldragon.<계정>.workers.dev` 주소가 생깁니다.
   - 이미 정적 자산만 있는 Worker를 만들어 두었다면, 새로 만들 필요 없이 그 프로젝트의 *Settings → Builds*에서 위 Deploy command를 확인한 뒤 *Deployments*에서 다시 배포하면 됩니다. (이름이 `wrangler.jsonc`의 `name`과 같아야 합니다. 다르면 `name` 값을 프로젝트 이름으로 고치세요.)

## 4. 비밀키 등록 (필수)
프로젝트 → **Settings → Variables and Secrets → Add**
- 이름 `SESSION_SECRET`, 타입 **Secret**, 값은 **32자 이상 무작위 문자열**(로그인 쿠키 서명용. 비밀번호 생성기로 만든 긴 문자열을 쓰세요. 남에게 알려주거나 저장소에 올리지 마세요. 바꾸면 모두 로그아웃됩니다.)
- 저장 후 *Deploy*(또는 *Deployments → 최신 배포 다시 배포*)를 눌러 적용합니다.

## 5. 확인
1. `https://<주소>/api/config` 가 `{"ready":true}` 인지 확인합니다. `false`면 `SESSION_SECRET`(32자 이상) 또는 D1 바인딩(`wrangler.jsonc`의 `database_id`)을 확인하세요. Settings → Bindings에 `DB`가 보이면 연결된 것입니다.
2. 사이트를 열면 상단에 **로그인** 버튼이 보입니다 → *지갑 연결* → 지갑 선택(Jupiter / MetaMask / Solflare) → *서명하고 로그인*. 로그인하면 `＋ 경전 추가`가 켜지고, 경전 아래에 좋아요·점수·댓글이 나타납니다.
3. 로그인 버튼이 없으면 클라우드 기능이 꺼진 것이며, 이 경우 사이트는 브라우저 저장 모드로 동작합니다.

## 동작 규칙 요약
| 기능 | 조건 |
| --- | --- |
| 기본 경전 읽기·낭독 | 누구나 (코드에 포함) |
| 공개 경전 읽기 | 누구나 |
| 비공개 경전 읽기 | 작성자만 (서버가 목록·조회에서 걸러냄) |
| 경전 추가·수정·삭제·가져오기 | 지갑 서명으로 로그인한 사용자, 내 경전만 (가져오기는 항상 비공개로 저장) |
| 좋아요/싫어요, 점수(1~5), 댓글(100자) | 로그인한 사용자, 기본·공개 경전에만. 1인 1표·1점, 댓글은 분당 5개·하루 100개 제한 |
| 댓글 삭제 | 작성자 또는 `ADMIN_WALLETS` 지갑 |
| 계정 삭제 | 본인 — 계정·경전·댓글·표 모두 삭제(같은 지갑으로 다시 로그인하면 빈 새 계정) |

보안: 모든 SQL은 바인딩 사용, 쿠키는 HttpOnly·SameSite=Lax(https에서 Secure), 상태 변경 요청은 같은 출처 + `x-requested-with` 헤더 + JSON 형식을 요구(CSRF 방어), 로그인은 서버가 준 1회용 문구(5분)에 대한 Ed25519 서명을 서버에서 검증, 다른 사용자에게는 지갑 주소의 앞뒤 4글자만 보임, 화면은 사용자 글을 `textContent`로만 표시.
주의: 지갑을 잃어버리면 그 계정(비공개 경전 포함)에 다시 접근할 수 없습니다. 비공개 경전은 `내보내기`로 백업하세요.

## (선택) 터미널로 배포·로컬 시험
```bash
npx wrangler login
npx wrangler d1 create soldragon           # 나온 database_id 를 wrangler.jsonc 에 기입
npx wrangler d1 migrations apply soldragon --remote
npx wrangler secret put SESSION_SECRET
npx wrangler deploy

# 로컬 시험
echo 'SESSION_SECRET=아무_무작위_32자_이상' > .dev.vars
npx wrangler d1 migrations apply soldragon --local
npx wrangler dev                            # http://localhost:8787
```
