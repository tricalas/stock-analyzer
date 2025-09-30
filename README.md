# Stock Analyzer 📈

한국과 미국 주식 시장의 종목 정보를 실시간으로 추적하고 분석하는 웹 애플리케이션입니다.

## 주요 기능 ✨

- **주식 정보 크롤링**: 네이버 금융에서 한국 주식 정보를 자동으로 수집
- **가격 히스토리 추적**: 종목별 과거 가격 데이터 저장 및 조회
- **90일 이동평균선**: 기술적 분석을 위한 90일 이동평균 자동 계산
- **즐겨찾기 & 싫어요**: 관심 종목 관리 및 필터링
- **실시간 업데이트**: 자동 스케줄러를 통한 정기적인 데이터 업데이트
- **다중 시장 지원**: 한국(KOSPI, KOSDAQ) 및 미국 시장 지원
- **ETF 필터링**: ETF 및 인덱스 종목 자동 제외

## 기술 스택 🛠

### Backend
- **FastAPI**: 고성능 Python 웹 프레임워크
- **SQLAlchemy**: ORM 및 데이터베이스 관리
- **APScheduler**: 자동 크롤링 스케줄러
- **BeautifulSoup4**: 웹 크롤링
- **PostgreSQL/SQLite**: 데이터베이스

### Frontend
- **Next.js 15**: React 기반 풀스택 프레임워크
- **TypeScript**: 타입 안정성
- **TailwindCSS**: 스타일링
- **React Query**: 서버 상태 관리
- **shadcn/ui**: UI 컴포넌트 라이브러리
- **Recharts**: 차트 라이브러리

## 설치 및 실행 🚀

### Prerequisites
- Python 3.8+
- Node.js 18+

### Backend 설치 및 실행

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend 설치 및 실행

```bash
cd frontend
npm install
npm run dev
```

브라우저에서 `http://localhost:3000` 접속

## 라이선스 📄

MIT License
