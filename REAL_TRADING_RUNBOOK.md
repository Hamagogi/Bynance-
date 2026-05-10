# Binance Futures Real-Trading Runbook

이 프로젝트의 원칙은 간단합니다. 브라우저 페이지는 신호와 상태만 보여주고, API 키가 필요한 주문 실행은 서버/터미널의 Node 실행기에서만 처리합니다.

## 단계

1. GitHub 자동 모의투자를 30~60일 이상 유지합니다.
2. 웹페이지의 `실운용 준비도`가 `TESTNET_READY`가 될 때까지 실제 자금은 금지합니다.
3. Binance Futures testnet API 키만 넣고 사전 점검을 실행합니다.
4. `/fapi/v1/order/test` 검증 주문을 반복해 수량, 필터, 서명, 권한을 확인합니다.
5. 테스트넷에서 보호 주문 포함 `execute-bracket`을 아주 작은 주문으로 검증합니다.
6. `reconcile`로 계정, 포지션, 미체결 주문이 계속 일치하는지 확인합니다.
7. live 전환은 별도 판단이며, 최소 주문 금액과 격리 마진, 낮은 레버리지에서만 시작합니다.

## 명령

```powershell
$env:BINANCE_EXECUTION_ENV='testnet'
$env:BINANCE_API_KEY='...'
$env:BINANCE_API_SECRET='...'
npm run trade:preflight
npm run trade:test-order -- --symbol BTCUSDT --side BUY --notional 25
npm run trade:reconcile
node scripts/live_executor.mjs execute-bracket --symbol BTCUSDT --side BUY --notional 25 --leverage 1 --tp 1.2 --sl 0.45
```

## Live 잠금 해제

Live 주문은 기본적으로 막혀 있습니다. 실제 주문을 내리려면 다음 조건이 모두 필요합니다.

- `paper_status.json`의 준비도: `TESTNET_READY`
- 운영 오류 0건
- 시장 품질 통과 종목 존재
- One-way position mode
- 격리 마진
- `MAX_LIVE_ORDER_USDT` 이하의 주문
- 환경 변수:

```powershell
$env:BINANCE_EXECUTION_ENV='live'
$env:ALLOW_LIVE_TRADING='true'
$env:LIVE_CONFIRM_PHRASE='ENABLE_REAL_BINANCE_FUTURES_ORDERS'
$env:MAX_LIVE_ORDER_USDT='25'
```

## 비상 정지

```powershell
$env:KILL_SWITCH_CONFIRM='CLOSE_ALL_POSITIONS'
npm run trade:kill-switch
```

비상 정지는 미체결 주문을 취소하고 열린 포지션을 `reduceOnly` 시장가로 닫습니다. live에서는 확인 문구가 없으면 실행되지 않습니다.

## 금지

- API 키를 브라우저나 GitHub Pages에 넣지 않습니다.
- 출금 권한이 있는 API 키를 쓰지 않습니다.
- 준비도 `NOT_READY` 상태에서 live 주문을 열지 않습니다.
- 보호 주문 없는 단독 진입 주문을 쓰지 않습니다.
- 크로스 마진이나 고레버리지로 시작하지 않습니다.
