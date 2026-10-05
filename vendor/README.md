# vendor/

## metamask-solana.js

MetaMask 솔라나 연결 SDK(`@metamask/connect-solana` 2.1.1)와 의존 패키지를 하나로 묶은 파일입니다(약 630KB, MIT 라이선스).
MetaMask는 사이트가 이 SDK의 `createSolanaClient()`를 호출해야 솔라나 지갑으로 등록되므로, 지갑 선택 창을 처음 열 때만 불러옵니다(`app.js`의 `loadMetaMask`).

### 다시 만드는 방법

```bash
mkdir bundle && cd bundle && npm init -y
npm install esbuild @metamask/connect-solana@2.1.1
echo "export { createSolanaClient } from '@metamask/connect-solana';" > entry.js
npx esbuild entry.js --bundle --format=esm --platform=browser --target=es2020 --minify --legal-comments=none \
  --define:process.env.NODE_ENV='"production"' --define:global=globalThis --outfile=metamask-solana.js
cp metamask-solana.js ../vendor/
```

버전을 올릴 때는 위 명령의 버전 번호를 바꾸고, MetaMask 연결을 실제 지갑으로 다시 확인하세요.
