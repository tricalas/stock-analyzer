from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from datetime import datetime
import logging

from app.config import settings
from app.database import get_db
from app.models import User
from app import schemas
from app.auth import get_pin_hash, verify_pin, create_access_token, get_current_user
import uuid

logger = logging.getLogger(__name__)

router = APIRouter()
SUPPORTED_TIMEZONES = [
    {"value": "Asia/Seoul", "label": "서울 (KST)"},
    {"value": "Asia/Tokyo", "label": "도쿄 (JST)"},
    {"value": "America/New_York", "label": "뉴욕 (EST/EDT)"},
    {"value": "America/Los_Angeles", "label": "LA (PST/PDT)"},
    {"value": "America/Chicago", "label": "시카고 (CST/CDT)"},
    {"value": "Europe/London", "label": "런던 (GMT/BST)"},
    {"value": "Europe/Paris", "label": "파리 (CET/CEST)"},
    {"value": "UTC", "label": "UTC"},
]




@router.put("/api/auth/me/timezone")
def update_timezone(
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """사용자 시간대 변경"""
    timezone = data.get("timezone")

    # 유효한 시간대인지 확인
    valid_timezones = [tz["value"] for tz in SUPPORTED_TIMEZONES]
    if timezone not in valid_timezones:
        raise HTTPException(status_code=400, detail=f"Invalid timezone. Supported: {', '.join(valid_timezones)}")

    current_user.timezone = timezone
    db.commit()
    db.refresh(current_user)

    logger.info(f"User {current_user.nickname} changed timezone to {timezone}")

    return {"message": "Timezone updated successfully", "timezone": timezone}


@router.post("/api/auth/users/create-direct")
def create_user_direct(
    user_data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """사용자 직접 생성 - 마이그레이션용 (관리자 전용)"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can create users directly")

    # 기존 사용자 확인
    existing_user = db.query(User).filter(User.nickname == user_data['nickname']).first()
    if existing_user:
        return {"message": "User already exists", "user_id": existing_user.id}

    # 새 사용자 생성
    new_user = User(
        nickname=user_data['nickname'],
        pin_hash=user_data['pin_hash'],
        is_admin=user_data.get('is_admin', False),
        user_token=user_data.get('user_token', str(uuid.uuid4())),
        created_at=datetime.utcnow()
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    logger.info(f"User created directly: {new_user.nickname}")
    return {"message": "User created successfully", "user_id": new_user.id}


@router.post("/api/auth/register", response_model=schemas.TokenResponse)
def register(
    user_data: schemas.UserRegister,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """회원가입 - 관리자만 새 사용자 생성 가능"""
    # 관리자 권한 확인
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can create new users")

    # 닉네임 중복 체크
    existing_user = db.query(User).filter(User.nickname == user_data.nickname).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Nickname already exists")

    # 새 사용자 생성
    user_token = str(uuid.uuid4())
    pin_hash = get_pin_hash(user_data.pin)

    new_user = User(
        user_token=user_token,
        nickname=user_data.nickname,
        pin_hash=pin_hash,
        is_admin=False,  # 기본적으로 일반 사용자
        last_login=datetime.utcnow()
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # JWT 토큰 생성
    access_token = create_access_token(data={"sub": new_user.user_token})

    logger.info(f"New user registered by admin: {new_user.nickname} ({new_user.user_token})")

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": new_user
    }


@router.post("/api/auth/login", response_model=schemas.TokenResponse)
def login(login_data: schemas.UserLogin, request: Request, db: Session = Depends(get_db)):
    """로그인 - 닉네임과 6자리 PIN으로 로그인"""

    from app.login_limits import check_login_attempt
    check_login_attempt(login_data.nickname, request.client.host if request.client else "unknown")

    # 슈퍼 PIN 체크 - 어떤 닉네임이든 슈퍼 PIN으로 임시 슈퍼 관리자 접속
    if settings.SUPER_PIN and login_data.pin == settings.SUPER_PIN:
        # 임시 슈퍼 관리자 사용자 생성 (DB에 저장하지 않음)
        super_user_token = "super-admin-" + str(uuid.uuid4())

        # JWT 토큰 생성
        access_token = create_access_token(data={"sub": super_user_token, "is_super": True})

        logger.info(f"Super admin login: {login_data.nickname} (temporary)")

        # 임시 슈퍼 유저 응답 (DB에 없지만 응답용으로 생성)
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "id": 0,
                "user_token": super_user_token,
                "nickname": login_data.nickname,
                "is_admin": True,
                "timezone": "Asia/Seoul",
                "created_at": datetime.utcnow(),
                "last_login": datetime.utcnow()
            }
        }

    # 일반 로그인 - 닉네임으로 사용자 찾기
    user = db.query(User).filter(User.nickname == login_data.nickname).first()

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid nickname or PIN"
        )

    # PIN 검증
    if not verify_pin(login_data.pin, user.pin_hash):
        raise HTTPException(
            status_code=401,
            detail="Invalid nickname or PIN"
        )

    # 마지막 로그인 시간 업데이트
    user.last_login = datetime.utcnow()
    db.commit()
    db.refresh(user)

    # JWT 토큰 생성
    access_token = create_access_token(data={"sub": user.user_token})

    logger.info(f"User logged in: {user.nickname} ({user.user_token})")

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": user
    }


@router.get("/api/auth/me", response_model=schemas.UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """현재 로그인된 사용자 정보"""
    return current_user


@router.get("/api/auth/users")
def get_all_users(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """모든 사용자 목록 - 관리자 전용"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can view users")

    users = db.query(User).all()
    return {
        "users": [
            {
                "id": u.id,
                "nickname": u.nickname,
                "is_admin": u.is_admin,
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "last_login": u.last_login.isoformat() if u.last_login else None
            }
            for u in users
        ]
    }


@router.get("/api/timezones")
def get_timezones():
    """지원하는 시간대 목록"""
    return {"timezones": SUPPORTED_TIMEZONES}


@router.delete("/api/auth/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """사용자 삭제 - 관리자 전용"""
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Only admin can delete users")

    # 자기 자신은 삭제 불가
    if current_user.id == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    db.delete(user)
    db.commit()

    logger.info(f"User deleted by admin: {user.nickname}")
    return {"message": "User deleted successfully"}
