# 자동 히스토리 수집 스케줄러 설정 가이드

## 개요

이 프로젝트는 **APScheduler**를 사용하여 관심 종목의 히스토리 데이터를 자동으로 수집합니다.
한국투자증권 (KIS) Open API를 통해 데이터를 받아오며, 장 마감 후 자동으로 실행됩니다.

## 스케줄 설정

### 1. 한국 주식 히스토리 수집
- **실행 시간**: 평일 (월~금) 오후 **4시 10분** (KST)
- **이유**: 한국 증시 마감 시간 (오후 3시 30분) 이후 데이터 수집
- **대상**: 관심 태그가 있는 한국 주식 종목

### 2. 미국 주식 히스토리 수집
- **실행 시간**: 평일 (화~토) 오전 **6시 10분** (KST)
- **이유**: 미국 증시 마감 시간 (EST 오후 4시 = KST 다음날 오전 6시) 이후 데이터 수집
- **대상**: 관심 태그가 있는 미국 주식 종목

## 프로덕션 설정 방법

### 1. 환경변수 설정 (.env 파일)

Railway 프로덕션 환경에서 다음 환경변수를 추가하세요:

```bash
# 자동 히스토리 수집 활성화
ENABLE_AUTO_HISTORY_COLLECTION=true

# 수집할 히스토리 데이터 일수 (기본: 100일)
HISTORY_COLLECTION_DAYS=100

# 수집 모드 (tagged: 태그 종목만, all: 모든 활성 종목, top: 시총 상위)
HISTORY_COLLECTION_MODE=all

# top 모드일 때 상위 몇 개 종목 (시총 기준, 기본: 500)
HISTORY_COLLECTION_LIMIT=500
```

**수집 모드 설명:**
- `tagged`: 태그가 있는 종목만 수집 (API 호출 최소화)
- `all`: 모든 활성 종목 수집 (종목 추천 기능 활성화, API 호출 많음)
- `top`: 시총 상위 N개 종목만 수집 (균형잡힌 옵션)

### 2. Railway 환경변수 설정

Railway 대시보드에서:
1. 프로젝트 선택
2. **Variables** 탭 클릭
3. 다음 환경변수 추가:
   - `ENABLE_AUTO_HISTORY_COLLECTION` = `true`
   - `HISTORY_COLLECTION_DAYS` = `100`
   - `HISTORY_COLLECTION_MODE` = `all` (또는 `top`, `tagged`)
   - `HISTORY_COLLECTION_LIMIT` = `500` (top 모드일 때만 사용)
4. **Deploy** 버튼 클릭하여 재배포

**권장 설정 (프로덕션):**
- 전체 종목 추천 기능 활성화: `HISTORY_COLLECTION_MODE=all`
- API 호출 제한 고려: `HISTORY_COLLECTION_MODE=top`, `HISTORY_COLLECTION_LIMIT=500`

### 3. 스케줄러 상태 확인

서버 시작 후 API로 스케줄러 상태 확인:

```bash
curl https://your-backend-url.railway.app/api/scheduler/status | jq
```

**응답 예시**:
```json
{
  "running": true,
  "jobs": [
    {
      "id": "kr_market_history_collection",
      "name": "Korean Market History Collection (After Close)",
      "next_run_time": "2026-01-27T16:10:00+09:00",
      "trigger": "cron[day_of_week='mon-fri', hour='16', minute='10']"
    },
    {
      "id": "us_market_history_collection",
      "name": "US Market History Collection (After Close)",
      "next_run_time": "2026-01-27T06:10:00+09:00",
      "trigger": "cron[day_of_week='tue-sat', hour='6', minute='10']"
    }
  ],
  "message": "Scheduler is running"
}
```

## 로그 확인

### Railway 로그 확인

프로덕션 환경에서 스케줄러 실행 로그 확인:

1. Railway 대시보드 → **Deployments** 탭
2. 최신 deployment 클릭
3. **View Logs** 클릭

### 스케줄러 시작 로그

서버 시작 시 다음 로그가 표시됩니다:

```
✅ Auto history collection ENABLED
📅 Scheduled: Korean market history collection (Mon-Fri 16:10 KST)
📅 Scheduled: US market history collection (Tue-Sat 06:10 KST)
INFO:apscheduler.scheduler:Added job "Korean Market History Collection (After Close)" to job store "default"
INFO:apscheduler.scheduler:Added job "US Market History Collection (After Close)" to job store "default"
INFO:apscheduler.scheduler:Scheduler started
```

### 히스토리 수집 실행 로그

실제 수집 시 다음 로그가 표시됩니다:

```
🚀 Starting scheduled tagged stocks history collection...
✅ History collection completed: 3/3 stocks, 277 records saved
```

## 수동 수집 (백업 방법)

자동 스케줄러가 작동하지 않을 경우, 수동으로 히스토리를 수집할 수 있습니다:

### API를 통한 수동 수집

```bash
curl -X POST https://your-backend-url.railway.app/api/stocks/tagged/collect-history?days=100 \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 스크립트를 통한 수동 수집

서버에 SSH 접속 후:

```bash
cd /app
python3 collect_interest_history.py
```

## 비활성화 방법

자동 수집을 중단하려면:

1. Railway 환경변수에서 `ENABLE_AUTO_HISTORY_COLLECTION=false` 로 변경
2. 재배포

또는 `.env` 파일 수정 후 재시작:

```bash
ENABLE_AUTO_HISTORY_COLLECTION=false
```

## 주의사항

### KIS API 제한

- **일일 호출 제한**: 한국투자증권 API는 일일 호출 횟수 제한이 있을 수 있습니다
- **최대 레코드 수**: 한 번에 최대 100개 레코드만 조회 가능
- **토큰 만료**: 24시간마다 토큰이 자동 갱신됩니다

### 데이터 수집 범위

- **현재 설정**: 관심 태그가 있는 종목만 수집
- **수집 일수**: 기본 100일 (설정 변경 가능)
- **중복 방지**: 이미 존재하는 데이터는 건너뜁니다

### 서버 타임존

- Railway 서버는 기본적으로 **UTC** 타임존을 사용합니다
- 스케줄러는 **KST (Asia/Seoul)** 타임존으로 설정되어 있습니다
- pytz 라이브러리를 사용하여 정확한 시간대를 보장합니다

## 트러블슈팅

### 스케줄러가 작동하지 않을 때

1. **환경변수 확인**:
   ```bash
   curl https://your-backend-url.railway.app/api/scheduler/status
   ```

2. **로그 확인**:
   - Railway 대시보드에서 로그 확인
   - "Auto history collection DISABLED" 메시지가 보이면 환경변수를 true로 변경

3. **서버 재시작**:
   - Railway 대시보드에서 **Restart** 버튼 클릭

### 데이터 수집 실패 시

1. **KIS API 연결 확인**:
   ```bash
   python3 test_kis_api.py
   ```

2. **관심 종목 확인**:
   - 최소 1개 이상의 종목에 관심 태그가 있는지 확인

3. **수동 실행 테스트**:
   ```bash
   python3 collect_interest_history.py
   ```

## 관련 파일

- `app/scheduler.py` - 스케줄러 설정 및 작업 정의
- `app/config.py` - 환경변수 설정
- `app/crawlers/kis_history_crawler.py` - KIS API 히스토리 수집 로직
- `collect_interest_history.py` - 수동 수집 스크립트
- `.env` - 로컬 환경변수 설정

## 문의

스케줄러 관련 문제가 발생하면 다음을 확인하세요:

1. Railway 로그
2. `/api/scheduler/status` 엔드포인트 응답
3. KIS API 연결 상태 (`test_kis_api.py`)
