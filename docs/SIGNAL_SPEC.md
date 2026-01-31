# 시그널 시스템 스펙 문서

> 최종 업데이트: 2026-01-31
> 상태: 설계 완료, 구현 대기

## 개요

기존 추세선 돌파 기반 시그널 시스템을 **이동평균(MA) 기반**으로 전면 재설계

---

## 새로운 시그널 전략

### 1. 골든크로스 / 데드크로스

| 항목 | 내용 |
|------|------|
| strategy_name | `golden_cross`, `death_cross` |
| signal_type | buy (골든), sell (데드) |
| 조건 | 50일 MA가 200일 MA를 상향/하향 돌파 |
| 의미 | 중장기 추세 전환 신호 |

**감지 로직:**
```python
# 골든크로스: 50일선이 200일선 위로 교차
golden_cross = (ma50[i-1] < ma200[i-1]) and (ma50[i] > ma200[i])

# 데드크로스: 50일선이 200일선 아래로 교차
death_cross = (ma50[i-1] > ma200[i-1]) and (ma50[i] < ma200[i])
```

---

### 2. 이평선 지지/저항

| 항목 | 내용 |
|------|------|
| strategy_name | `ma_support`, `ma_resistance` |
| signal_type | buy (지지), sell (저항) |
| 대상 MA | 20일, 50일, 200일 |
| 허용 오차 | MA 값의 1~2% |

**감지 로직:**
```python
# 지지: 가격이 MA 근처까지 하락 후 반등
# - 저가가 MA의 2% 이내
# - 종가가 MA 위에서 마감
# - 양봉 (종가 > 시가)
support = (abs(low - ma) / ma < 0.02) and (close > ma) and (close > open)

# 저항: 가격이 MA 근처까지 상승 후 하락
# - 고가가 MA의 2% 이내
# - 종가가 MA 아래에서 마감
# - 음봉 (종가 < 시가)
resistance = (abs(high - ma) / ma < 0.02) and (close < ma) and (close < open)
```

---

### 3. 이평선 돌파

| 항목 | 내용 |
|------|------|
| strategy_name | `ma_breakout_up`, `ma_breakout_down` |
| signal_type | buy (상향), sell (하향) |
| 대상 MA | 20일, 50일, 200일 |

**감지 로직:**
```python
# 상향 돌파: 종가가 MA 위로 돌파
breakout_up = (close[i-1] < ma[i-1]) and (close[i] > ma[i])

# 하향 돌파: 종가가 MA 아래로 돌파
breakout_down = (close[i-1] > ma[i-1]) and (close[i] < ma[i])
```

---

### 4. 이평선 배열 (정배열/역배열)

| 항목 | 내용 |
|------|------|
| strategy_name | `ma_bullish_alignment`, `ma_bearish_alignment` |
| signal_type | buy (정배열), sell (역배열) |
| 조건 | 단기/중기/장기 MA 순서 정렬 |

**감지 로직:**
```python
# 정배열 (강세): 20일 > 50일 > 200일
bullish = (ma20 > ma50) and (ma50 > ma200)

# 역배열 (약세): 200일 > 50일 > 20일
bearish = (ma200 > ma50) and (ma50 > ma20)
```

**배열 전환 시그널:**
- 역배열 → 정배열 전환 시 매수 시그널
- 정배열 → 역배열 전환 시 매도 시그널

---

## 데이터베이스 스키마

### StockSignal (기존 테이블 재사용)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| stock_id | Integer | 종목 ID (FK) |
| signal_type | String(20) | "buy", "sell", "hold" |
| signal_date | Date | 시그널 발생일 |
| signal_price | Float | 시그널 발생 시 가격 |
| strategy_name | String(50) | 새 전략명 (위 참조) |
| current_price | Float | 현재 가격 |
| return_percent | Float | 수익률 (%) |
| details | Text (JSON) | MA 값, 배열 상태 등 |

**details JSON 예시:**
```json
{
  "ma_20": 150.5,
  "ma_50": 148.0,
  "ma_200": 145.0,
  "alignment": "bullish",
  "trigger_ma": 50,
  "distance_pct": 1.2
}
```

---

## API 엔드포인트

### POST `/api/signals/ma/refresh`

MA 시그널 분석 시작 (백그라운드 워커)

**Request:**
```json
{
  "mode": "tagged",  // "tagged" | "all" | "top"
  "limit": 500,      // top 모드일 때
  "days": 250,       // 분석 기간 (MA 200일 계산용)
  "force_full": false
}
```

**Response:**
```json
{
  "task_id": "uuid-string",
  "message": "분석 작업이 시작되었습니다"
}
```

---

### GET `/api/signals/ma`

MA 시그널 목록 조회 (페이지네이션)

**Query Params:**
- `skip`: 오프셋 (default: 0)
- `limit`: 페이지 크기 (default: 30)
- `strategy`: 전략 필터 (optional)
- `signal_type`: buy/sell 필터 (optional)

**Response:**
```json
{
  "signals": [...],
  "total": 150,
  "stats": {
    "positive_count": 80,
    "negative_count": 70,
    "avg_return": 2.5
  }
}
```

---

### GET `/api/stocks/{stock_id}/ma-analysis`

개별 종목 MA 분석 (차트 데이터 포함)

**Query Params:**
- `days`: 조회 기간 (default: 180)

**Response:**
```json
{
  "stock_id": 123,
  "symbol": "AAPL",
  "name": "Apple Inc",
  "current_price": 185.5,
  "ma_values": {
    "20": 183.2,
    "50": 180.5,
    "200": 175.0
  },
  "alignment": "bullish",
  "chart_data": [
    {
      "date": "2024-01-15",
      "open": 180.0,
      "high": 186.0,
      "low": 179.5,
      "close": 185.5,
      "volume": 50000000,
      "ma_20": 183.2,
      "ma_50": 180.5,
      "ma_200": 175.0
    }
  ],
  "recent_signals": [...]
}
```

---

### GET `/api/signals/dashboard`

시그널 대시보드 통계

**Response:**
```json
{
  "total_signals": 500,
  "signals_by_strategy": {
    "golden_cross": 50,
    "death_cross": 30,
    "ma_support": 120,
    "ma_resistance": 80,
    "ma_breakout_up": 100,
    "ma_breakout_down": 70,
    "ma_bullish_alignment": 30,
    "ma_bearish_alignment": 20
  },
  "signals_by_type": {
    "buy": 300,
    "sell": 200
  },
  "avg_return": 3.2,
  "recent_signals": [...]
}
```

---

## 백엔드 워커 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│  프론트엔드                                                  │
│  POST /api/signals/ma/refresh 클릭                          │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  FastAPI                                                     │
│  1. TaskProgress 생성 (task_id 발급)                         │
│  2. Celery 태스크 큐에 등록                                  │
│  3. 즉시 task_id 반환 (비동기)                               │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Celery Worker (백그라운드)                                   │
│  - analyze_ma_signals_task 실행                              │
│  - TaskProgress 업데이트 (current_item, status)              │
│  - 브라우저 닫아도 계속 실행                                  │
│  - 최대 59분 타임아웃, 3회 자동 재시도                        │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  프론트엔드 (폴링)                                            │
│  GET /api/tasks/{task_id} (1초 간격)                         │
│  - 진행률 표시                                                │
│  - 완료/실패 시 알림                                          │
└─────────────────────────────────────────────────────────────┘
```

**Fallback:** Celery 불가 시 `threading.Thread`로 실행

---

## 프론트엔드 페이지

### 1. 시그널 목록 (`/signals`)
- 기존 페이지 업데이트
- 새 전략 필터 추가
- MA 값 표시

### 2. 대시보드 (`/signals/dashboard`) - 신규
- 전략별 시그널 분포 차트
- 수익률 통계
- 최근 시그널 요약

### 3. 종목 상세 (`/signals/[stockId]`) - 신규
- 가격 차트 + MA 라인 (20, 50, 200일)
- 시그널 마커 표시
- Recharts 사용

### 4. 설정 (`/settings/signals`)
- MA 시그널 분석 버튼 추가
- 기존 추세선 분석과 분리

---

## 파일 목록

### 신규 생성
1. `backend/app/ma_signal_analyzer.py`
2. `frontend/src/app/signals/dashboard/page.tsx`
3. `frontend/src/app/signals/[stockId]/page.tsx`
4. `frontend/src/components/MASignalChart.tsx`
5. `frontend/src/components/SignalDashboard.tsx`

### 수정
1. `backend/app/tasks.py` - Celery 태스크 추가
2. `backend/app/main.py` - API 엔드포인트
3. `backend/app/schemas.py` - 응답 스키마
4. `frontend/src/app/signals/page.tsx` - 필터 업데이트
5. `frontend/src/app/settings/signals/page.tsx` - 분석 버튼
6. `frontend/src/lib/api.ts` - API 메서드

---

## 기존 시스템 호환

기존 추세선 시그널은 유지:
- `descending_trendline_breakout`
- `approaching_breakout`
- `pullback_buy`

UI에서 MA 시그널과 구분하여 필터링 가능
