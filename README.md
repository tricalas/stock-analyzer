# Stock Analyzer - 오스카투자 📈

미국 주식 시장의 종목 정보를 실시간으로 추적하고 분석하는 웹 애플리케이션입니다.

## 주요 기능 ✨

- 🇺🇸 **미국 주식 정보**: 네이버 금융 API를 통해 NASDAQ, NYSE 주식 정보를 실시간 수집
- ⭐ **즐겨찾기**: 관심 종목을 즐겨찾기에 추가하여 쉽게 관리
- 👎 **싫어요**: 관심 없는 종목을 필터링
- 📊 **다양한 지표**: 시가총액, 거래량, 등락률 등 핵심 정보 제공
- 📈 **90일 이동평균선**: 기술적 분석을 위한 90일 이동평균 대비 현재가 비율 표시
- 🔄 **수동 업데이트**: 필요할 때 언제든지 최신 데이터로 업데이트
- 📱 **반응형 디자인**: 모바일, 태블릿, 데스크톱 모든 기기에서 사용 가능

## 기술 스택 🛠

### Backend
- **FastAPI 0.128.0**: 고성능 Python 웹 프레임워크
- **SQLAlchemy**: ORM 및 데이터베이스 관리
- **APScheduler**: 크롤링 스케줄러
- **BeautifulSoup4 & Requests**: 웹 크롤링
- **SQLite**: 데이터베이스
- **Python 3.11+**

### Frontend
- **Next.js 16.1.1**: React 기반 풀스택 프레임워크
- **React 19.2.3**: UI 라이브러리
- **TypeScript**: 타입 안정성
- **TailwindCSS**: 스타일링
- **React Query**: 서버 상태 관리
- **shadcn/ui**: UI 컴포넌트 라이브러리
- **Lucide React**: 아이콘
- **Axios**: HTTP 클라이언트

## 설치 및 실행 🚀

### Prerequisites
- Python 3.11+
- Node.js 18+
- npm or yarn

### 1. 저장소 클론

```bash
git clone https://github.com/YOUR_USERNAME/stock-analyzer.git
cd stock-analyzer
```

### 2. Backend 설치 및 실행

```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt

# 환경 변수 설정
cp .env.example .env
# .env 파일을 편집하여 필요한 설정을 입력하세요

# 서버 실행
python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 3. Frontend 설치 및 실행

새 터미널을 열고:

```bash
cd frontend
npm install
# or
yarn install

# 환경 변수 설정
cp .env.example .env.local
# .env.local 파일에서 API URL을 설정하세요

# 개발 서버 실행
npm run dev
# or
yarn dev
```

브라우저에서 `http://localhost:3000` 접속

## Vercel 배포 🚀

### 프론트엔드 배포

1. GitHub에 코드 푸시
2. [Vercel](https://vercel.com)에 로그인
3. "New Project" 클릭
4. GitHub 저장소 선택
5. Framework Preset: **Next.js** 선택
6. Root Directory: **`frontend`** 로 설정
7. 환경 변수 추가:
   - `NEXT_PUBLIC_API_URL`: 백엔드 API URL (예: `https://your-backend.railway.app`)
8. "Deploy" 클릭

### 백엔드 배포 옵션

백엔드는 다음 플랫폼 중 하나에 배포할 수 있습니다:

#### Railway (추천)
1. [Railway](https://railway.app) 가입
2. "New Project" > "Deploy from GitHub repo"
3. 저장소 선택
4. Root Directory: `backend`
5. 환경 변수 설정
6. Deploy

#### Render
1. [Render](https://render.com) 가입
2. "New Web Service"
3. GitHub 저장소 연결
4. Root Directory: `backend`
5. Build Command: `pip install -r requirements.txt`
6. Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

#### 기타 옵션
- Heroku
- AWS EC2
- Google Cloud Platform
- DigitalOcean

배포 완료 후 Vercel 프로젝트의 환경 변수에서 `NEXT_PUBLIC_API_URL`을 백엔드 URL로 업데이트하세요.

## 환경 변수 ⚙️

### Frontend (.env.local)
```env
NEXT_PUBLIC_API_URL=http://localhost:8000  # 로컬 개발
# NEXT_PUBLIC_API_URL=https://your-backend-url.com  # 프로덕션
```

### Backend (.env)
```env
DATABASE_URL=postgresql://user:password@localhost/stock_analyzer
REDIS_URL=redis://localhost:6379
SECRET_KEY=your-secret-key-here
CORS_ORIGINS=http://localhost:3000,https://your-frontend.vercel.app
```

## 프로젝트 구조 📁

```
stock-analyzer/
├── frontend/              # Next.js 프론트엔드
│   ├── src/
│   │   ├── app/          # Next.js App Router
│   │   ├── components/   # React 컴포넌트
│   │   └── lib/          # 유틸리티 및 API
│   ├── public/           # 정적 파일
│   └── package.json
├── backend/               # FastAPI 백엔드
│   ├── app/
│   │   ├── crawlers/     # 웹 크롤러
│   │   ├── models.py     # DB 모델
│   │   ├── schemas.py    # Pydantic 스키마
│   │   └── main.py       # FastAPI 앱
│   └── requirements.txt
├── vercel.json           # Vercel 설정
└── README.md
```

## 기여 🤝

Pull Request는 언제나 환영합니다!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 라이선스 📄

MIT License

## 문의 📧

질문이나 제안사항이 있으시면 GitHub Issues를 이용해주세요.

