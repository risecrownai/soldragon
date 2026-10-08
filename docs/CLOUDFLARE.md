# Cloudflare Pages + D1 배포 가이드 (웹 대시보드만 사용)

PC에 아무것도 설치하지 않고 **브라우저만으로** 배포합니다. 구성: 정적 파일(`public/`) + Pages Functions(`functions/api/[[path]].js` → `src/api.js`) + D1(SQLite) 데이터베이스. 로그인은 **지갑 서명**이라 구글 등 외부 서비스 설정이 필요 없습니다.

> 저장소 루트에 `wrangler.toml` 파일을 만들지 마세요. 있으면 대시보드가 설정을 그 파일에서만 읽어 아래 바인딩·변수 화면이 잠깁니다. (터미널로 쓰려면 `wrangler.example.toml` 참고)

## 0. 준비
- Cloudflare 계정(무료): https://dash.cloudflare.com/sign-up
- GitHub의 이 저장소(`risecrownai/soldragon`). 배포할 브랜치를 정합니다. 보통 `main`이며, 아직 PR을 머지하지 않았다면 먼저 머지하거나 작업 브랜치(`claude/buddhist-scripture-website-9xgi9n`)를 쓰세요.

## 1. D1 데이터베이스 만들기
1. 대시보드 왼쪽 *Storage & Databases → D1 SQL Database → Create database*
2. 이름 `soldragon` → Create
3. 만든 DB의 **Console** 탭을 열고, 저장소의 [`migrations/0001_init.sql`](../migrations/0001_init.sql) 내용을 **전부 복사해 붙여 넣고 실행**합니다. (한 번에 안 되면 `CREATE TABLE …;` / `CREATE INDEX …;` 문장을 하나씩 나눠 실행)
4. *Tables* 탭에 `users, nonces, sutras, reactions, comments` 5개가 보이면 성공입니다.

## 2. Pages 프로젝트 만들기 (Git 연결)
1. *Workers & Pages → Create application* 에서 **Pages** 탭의 *Import an existing Git repository → Connect to Git* (화면에 Pages가 안 보이면 "Looking to deploy Pages? Get started" 링크를 누르세요)
2. GitHub 계정을 연결하고 저장소 `soldragon`을 선택합니다(조직 저장소면 Cloudflare 앱에 해당 저장소 접근을 허용해야 합니다).
3. 설정
   - Project name: `soldragon` (주소는 `https://soldragon.pages.dev`)
   - Production branch: `main`
   - Framework preset: **None**
   - Build command: **비움**
   - Build output directory: **`public`**
4. *Save and Deploy* → 첫 배포가 끝날 때까지 기다립니다. (이 배포는 아직 DB가 연결되기 전이라 클라우드 기능은 꺼진 상태입니다.)

## 3. D1 연결 · 비밀키 · 호환 날짜 설정
프로젝트 → **Settings** 에서:

1. **Bindings → Add → D1 database**
   - Variable name: **`DB`** (대문자 그대로)
   - D1 database: `soldragon`
   - *Production*과 *Preview* 둘 다 설정
2. **Variables and Secrets → Add**
   - 이름 `SESSION_SECRET`, 타입 **Secret**, 값은 **32자 이상 무작위 문자열**(로그인 쿠키 서명용. 비밀번호 생성기로 만든 긴 문자열을 쓰면 됩니다. 남에게 알려주거나 저장소에 올리지 마세요. 바꾸면 모두 로그아웃됩니다.)
   - (선택) 이름 `ADMIN_WALLETS`, 값 관리자 지갑 주소(여러 개면 쉼표로 구분). 이 지갑은 모든 댓글을 삭제할 수 있습니다.
3. **Runtime → Compatibility date** 를 `2025-09-01` 이상으로 설정 (Production, Preview 모두)

## 4. 다시 배포
설정은 **새 배포부터** 적용됩니다. *Deployments* 탭 → 가장 최근 배포의 `⋯` → **Retry deployment** (또는 GitHub에 커밋을 하나 푸시).

## 5. 확인
1. `https://<프로젝트>.pages.dev/api/config` 를 열어 `{"ready":true}` 가 나오는지 확인합니다. `false`면 `DB` 바인딩 이름, `SESSION_SECRET`(32자 이상)을 다시 확인하세요(변경 후 재배포했는지도).
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
cp wrangler.example.toml wrangler.toml     # git에는 올라가지 않음(.gitignore)
npx wrangler d1 create soldragon           # 나온 database_id 를 wrangler.toml 에 기입
npx wrangler d1 migrations apply soldragon --remote
echo 'SESSION_SECRET=아무_무작위_32자_이상' > .dev.vars
npx wrangler d1 migrations apply soldragon --local
npx wrangler pages dev public              # http://localhost:8788
```
