# tricalas.com 배포 가이드

## 1. 백엔드 배포 (Railway)

### 1.1 Railway Volume 설정 (SQLite DB 저장용)
1. Railway 대시보드에서 백엔드 프로젝트 선택
2. **Settings** → **Volumes** 클릭
3. **New Volume** 버튼 클릭
4. Mount Path: `/app/data` 입력
5. Volume 생성 완료

### 1.2 로컬 DB를 Railway에 업로드하기

**방법 1: Railway CLI 사용 (권장)**
```bash
# Railway CLI 설치
npm install -g @railway/cli

# Railway 로그인
railway login

# 프로젝트 연결
cd /Users/wooleen/workspace/stock-analyzer/backend
railway link

# DB 파일 업로드
railway run bash
# 컨테이너 내부에서:
# 로컬 DB를 Volume으로 복사하는 방법은 직접 파일을 넣어야 함

# 대안: 로컬에서 Railway로 SSH 접속 후 파일 전송
```

**방법 2: SCP/SFTP로 직접 업로드**
Railway는 직접 파일 업로드를 지원하지 않으므로, 다음 방법을 사용:

1. **임시 방법**: 초기 배포 시 빈 DB로 시작하고, 프로덕션에서 직접 데이터 크롤링
2. **권장 방법**: PostgreSQL로 마이그레이션 (아래 섹션 참조)

**방법 3: 초기 데이터 마이그레이션 스크립트**
```bash
# backend 폴더에서 실행
cd /Users/wooleen/workspace/stock-analyzer/backend

# 로컬 DB에서 데이터 추출
python3 << 'PYTHON'
import sqlite3
import json

# 로컬 DB 연결
conn = sqlite3.connect('stock_analyzer.db')
cursor = conn.cursor()

# users 테이블 데이터 추출
cursor.execute("SELECT * FROM users")
users = cursor.fetchall()

# stocks 테이블 데이터 추출 (최근 100개만)
cursor.execute("SELECT * FROM stocks LIMIT 100")
stocks = cursor.fetchall()

# JSON으로 저장
data = {
    'users': users,
    'stocks': stocks
}

with open('migration_data.json', 'w') as f:
    json.dump(data, f)

conn.close()
print("데이터 추출 완료: migration_data.json")
PYTHON
```

### 1.3 환경 변수 설정

Railway 대시보드에서 다음 환경 변수 설정:

```env
# Database
DATABASE_URL=sqlite:////app/data/stock_analyzer.db

# Security
SECRET_KEY=lydFtzV_C68KzcQ7859mpierU_CEgANi_ns6MKLk8nQ
SUPER_PIN=999999

# CORS
CORS_ORIGINS=https://tricalas.com,https://www.tricalas.com

# Redis (선택사항)
REDIS_URL=redis://localhost:6379
```

### 1.4 Procfile 또는 Start Command 설정
Railway Settings → Deploy에서 Start Command 설정:
```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

---

## 2. 프론트엔드 배포 (Vercel)

### 2.1 Vercel 프로젝트 생성
1. https://vercel.com 접속 및 로그인
2. **New Project** 클릭
3. GitHub 저장소 연결
4. `frontend` 폴더 선택
5. Root Directory: `frontend` 입력

### 2.2 환경 변수 설정
Vercel 프로젝트 Settings → Environment Variables:
```env
NEXT_PUBLIC_API_URL=https://victorious-determination-production-9f97.up.railway.app
```

### 2.3 도메인 설정
1. Vercel Settings → Domains
2. `tricalas.com` 입력
3. DNS 설정 안내 확인:
   - A Record: `76.76.21.21`
   - CNAME Record: `cname.vercel-dns.com`

---

## 3. DNS 설정 (도메인 제공업체에서)

tricalas.com DNS 설정:
```
Type    Name    Value                   TTL
A       @       76.76.21.21            Auto
CNAME   www     cname.vercel-dns.com    Auto
```

---

## 4. 배포 후 확인 사항

### 4.1 백엔드 확인
```bash
# API health check
curl https://victorious-determination-production-9f97.up.railway.app/

# stocks 조회 테스트
curl https://victorious-determination-production-9f97.up.railway.app/api/stocks?limit=5
```

### 4.2 프론트엔드 확인
1. https://tricalas.com 접속
2. 로그인 테스트 (신신 / 080808)
3. 데이터 새로고침 버튼 테스트
4. 태그 기능 테스트

---

## 5. PostgreSQL로 마이그레이션 (권장)

SQLite는 파일 기반이라 Railway에서 영구 저장이 어렵습니다. 
프로덕션 환경에서는 PostgreSQL을 권장합니다.

### 5.1 Railway PostgreSQL 추가
1. Railway 프로젝트에서 **New** → **Database** → **PostgreSQL**
2. 자동으로 `DATABASE_URL` 환경 변수 생성됨

### 5.2 SQLAlchemy 설정 변경
`backend/app/config.py`에서 DATABASE_URL을 환경 변수에서 가져오도록 이미 설정됨

### 5.3 데이터 마이그레이션
```bash
# SQLite에서 PostgreSQL로 데이터 이동
# 1. pgloader 설치 (Mac)
brew install pgloader

# 2. 마이그레이션 실행
pgloader stock_analyzer.db postgresql://user:pass@host:port/dbname
```

---

## 6. 보안 체크리스트

- [x] SECRET_KEY 변경 완료
- [x] CORS 설정 프로덕션 도메인만 허용
- [x] HTTPS 강제 적용 (Vercel/Railway 자동)
- [x] Rate limiting (10분 쿨타임 적용됨)
- [ ] 환경 변수로 모든 민감 정보 관리
- [ ] .env 파일 .gitignore에 추가 확인

---

## 7. 문제 해결

### Railway에서 DB 데이터가 사라지는 경우
- Volume이 제대로 마운트되었는지 확인
- DATABASE_URL이 Volume 경로를 가리키는지 확인: `sqlite:////app/data/stock_analyzer.db`

### CORS 에러 발생 시
- Railway 환경 변수에서 CORS_ORIGINS 확인
- https://tricalas.com이 포함되어 있는지 확인

### Vercel 빌드 실패 시
- Node.js 버전 확인 (package.json의 engines 필드)
- 환경 변수 NEXT_PUBLIC_API_URL 설정 확인

---

## 8. 현재 작업이 필요한 것

1. **Railway CLI로 DB 업로드** 또는 **PostgreSQL로 마이그레이션**
2. **Railway 환경 변수 설정**
3. **Vercel 프로젝트 생성 및 배포**
4. **DNS 설정 확인**
