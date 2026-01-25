# PostgreSQL 마이그레이션 가이드

SQLite에서 Railway PostgreSQL로 데이터를 마이그레이션하는 방법입니다.

## 1단계: Railway에 PostgreSQL 추가

1. **Railway 대시보드 접속**
   - https://railway.app/ 로 이동
   - stock-analyzer 프로젝트 선택

2. **PostgreSQL 데이터베이스 추가**
   - `+ New` 버튼 클릭
   - `Database` → `Add PostgreSQL` 선택
   - PostgreSQL 서비스가 자동으로 생성됩니다

3. **DATABASE_URL 복사**
   - PostgreSQL 서비스 클릭
   - `Variables` 탭으로 이동
   - `DATABASE_URL` 값을 복사 (예: `postgresql://postgres:...@...railway.app:5432/railway`)

## 2단계: Railway 백엔드 환경 변수 업데이트

Railway 백엔드 서비스의 환경 변수를 업데이트합니다:

1. Railway 대시보드에서 **백엔드 서비스** 선택
2. `Variables` 탭으로 이동
3. 다음 환경 변수들을 **추가/업데이트**:

```bash
# PostgreSQL 연결 (위에서 복사한 URL)
DATABASE_URL=postgresql://postgres:password@containers-us-west-xxx.railway.app:5432/railway

# 기존 환경 변수들 (그대로 유지)
SECRET_KEY=your-secret-key
SUPER_PIN=999999
CORS_ORIGINS=http://localhost:3000,https://tricalas.com,https://www.tricalas.com
PORT=8080
```

4. 저장 후 백엔드가 자동으로 재시작됩니다

## 3단계: 로컬에서 데이터 마이그레이션

로컬 컴퓨터에서 SQLite 데이터를 PostgreSQL로 마이그레이션합니다:

1. **로컬 .env 파일 업데이트**

   백엔드 디렉토리의 `.env` 파일에 Railway PostgreSQL URL 추가:

   ```bash
   # .env 파일
   DATABASE_URL=postgresql://postgres:password@containers-us-west-xxx.railway.app:5432/railway
   ```

2. **마이그레이션 스크립트 실행**

   ```bash
   cd backend
   python migrate_to_postgres.py
   ```

3. **결과 확인**

   스크립트가 완료되면 다음과 같은 정보를 출력합니다:

   ```
   ✅ 마이그레이션 완료!

   📊 PostgreSQL 데이터 확인:
      users: 2개
      stock_tags: 8개
      stock_favorites: 39개
      stock_dislikes: 0개
      stock_tag_assignments: 81개
   ```

## 4단계: Railway 백엔드 재시작 및 테스트

1. **Railway 대시보드에서 백엔드 재배포**
   - 백엔드 서비스 선택
   - `Settings` → `Redeploy` 클릭
   - 또는 환경 변수 변경 후 자동으로 재시작됨

2. **API 테스트**

   ```bash
   # 태그 목록 확인
   curl https://victorious-determination-production-dafc.up.railway.app/api/tags

   # 로그인 테스트
   curl -X POST https://victorious-determination-production-dafc.up.railway.app/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"nickname":"admin","pin":"999999"}'
   ```

## 5단계: 프론트엔드에서 확인

1. https://tricalas.com 접속
2. SUPER_PIN(999999)으로 로그인
3. 태그, 즐겨찾기 등이 정상적으로 표시되는지 확인

## 주의사항

### SQLite vs PostgreSQL 차이점

1. **자동 증가 (Auto Increment)**
   - SQLite: `AUTOINCREMENT`
   - PostgreSQL: `SERIAL` 또는 `IDENTITY`
   - SQLAlchemy가 자동으로 처리하므로 코드 변경 불필요

2. **데이터 타입**
   - SQLite는 동적 타입, PostgreSQL은 강타입
   - 현재 코드는 이미 SQLAlchemy로 정의되어 있어 호환됨

3. **대소문자 구분**
   - PostgreSQL은 테이블/컬럼명에 대소문자를 구분하지 않음 (소문자로 변환)
   - 현재 코드는 모두 소문자를 사용하므로 문제없음

### 롤백 방법

PostgreSQL로 전환 후 문제가 생기면 SQLite로 롤백할 수 있습니다:

1. Railway 환경 변수에서 `DATABASE_URL` 제거 또는 주석 처리
2. 백엔드가 기본값인 `sqlite:///./stock_analyzer.db` 사용
3. Railway에서 백엔드 재시작

### 데이터 백업

마이그레이션 전에 SQLite 데이터베이스를 백업하세요:

```bash
cp backend/stock_analyzer.db backend/stock_analyzer.db.backup
```

## 문제 해결

### 마이그레이션 스크립트 오류

**오류: `DATABASE_URL 환경 변수가 설정되지 않았습니다`**
- `.env` 파일에 `DATABASE_URL` 추가

**오류: `connection refused`**
- Railway PostgreSQL이 실행 중인지 확인
- DATABASE_URL이 올바른지 확인
- 네트워크 연결 확인

**오류: `table does not exist`**
- Railway 백엔드가 한 번 이상 실행되어 테이블이 생성되었는지 확인
- 백엔드 로그에서 SQLAlchemy 테이블 생성 확인

### 중복 데이터

마이그레이션을 여러 번 실행해도 안전합니다:
- 스크립트는 `ON CONFLICT DO NOTHING`을 사용하여 중복을 방지합니다
- 기존 데이터는 건너뛰고 새 데이터만 추가됩니다

## 완료!

PostgreSQL 마이그레이션이 완료되었습니다. 이제 Railway의 영구 데이터베이스를 사용하여 데이터가 안전하게 보관됩니다.
