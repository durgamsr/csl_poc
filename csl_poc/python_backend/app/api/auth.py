from fastapi import APIRouter, Depends, HTTPException, status, Request, Response
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, EmailStr
from app.services.cognito_service import CognitoService
from app.middleware.auth_middleware import AuthMiddleware
from typing import Optional, Dict
import secrets
import logging
import json
import base64

router = APIRouter()
cognito_service = CognitoService()
logger = logging.getLogger(__name__)

class UserRegister(BaseModel):
    username: str
    password: str
    email: EmailStr

class UserLogin(BaseModel):
    username: str
    password: str

class ConfirmSignup(BaseModel):
    username: str
    code: str

class ForgotPassword(BaseModel):
    username: str

class ConfirmForgotPassword(BaseModel):
    username: str
    code: str
    new_password: str

class ChangePassword(BaseModel):
    old_password: str
    new_password: str

@router.get("/")
async def home(request: Request):
    """Home route - redirects to frontend."""
    return RedirectResponse(url="http://localhost:3000")

@router.get("/login")
async def login(request: Request):
    """Login route - redirects to Cognito login page."""
    nonce = secrets.token_urlsafe(32)
    state = secrets.token_urlsafe(32)
    
    # Store nonce and state in session
    request.session["nonce"] = nonce
    request.session["state"] = state
    
    auth_url = cognito_service.get_authorization_url(nonce, state)
    logger.info(f"Redirecting to Cognito. Authorization URL: {auth_url}")
    return RedirectResponse(url=auth_url)

@router.get("/callback")
async def callback(request: Request, code: str, state: str):
    """Callback route - handles Cognito authentication callback."""
    try:
        # Verify state matches what we stored
        if state != request.session.get("state"):
            logger.error("State mismatch")
            return RedirectResponse(url="/")
        
        # Process the callback
        user_info, token_set = await cognito_service.process_callback(
            code=code,
            state=state,
            nonce=request.session.get("nonce")
        )
        
        # Store user info and token set in session
        request.session["user_info"] = user_info
        request.session["token_set"] = token_set
        request.session["is_authenticated"] = True
        
        # Log token information
        cognito_service.log_token_info(token_set)
        
        # Redirect to frontend
        return RedirectResponse(url="http://localhost:3000/")
    except Exception as e:
        logger.error(f"Callback error: {str(e)}")
        # Clear session on error
        request.session.clear()
        return RedirectResponse(url="/")

@router.get("/check-auth")
async def check_auth(request: Request):
    """Check authentication status."""
    if request.session.get("is_authenticated"):
        # Log token information
        if request.session.get("token_set"):
            cognito_service.log_token_info(request.session["token_set"])
        
        return {
            "is_authenticated": True,
            "user": request.session.get("user_info")
        }
    return {"is_authenticated": False}

@router.get("/logout")
async def logout(request: Request):
    """Logout route."""
    # Get the logout URL
    logout_url = cognito_service.get_logout_url()
    
    # Clear the session
    request.session.clear()
    
    logger.info(f"Redirecting to logout URL: {logout_url}")
    return RedirectResponse(url=logout_url)

@router.get("/debug-token")
async def debug_token(request: Request):
    """Debug endpoint to inspect token claims."""
    try:
        if not request.session.get("token_set"):
            return {"error": "No token available"}
        
        token_set = request.session["token_set"]
        claims = None
        
        # Extract claims from ID token
        if token_set.get("id_token"):
            try:
                id_token_parts = token_set["id_token"].split(".")
                if len(id_token_parts) == 3:
                    claims = json.loads(base64.b64decode(id_token_parts[1] + "=" * (-len(id_token_parts[1]) % 4)))
            except Exception as e:
                return {"error": "Error decoding JWT payload", "details": str(e)}
        
        if not claims:
            return {
                "error": "No claims found",
                "token_properties": list(token_set.keys()),
                "token_type": type(token_set).__name__
            }
        
        return {
            "claims": claims,
            "has_username": bool(claims.get("cognito:username")),
            "has_email": bool(claims.get("email")),
            "has_sub": bool(claims.get("sub")),
            "token_properties": list(token_set.keys())
        }
    except Exception as e:
        return {"error": "Error inspecting token", "details": str(e)}

@router.post("/register")
async def register(username: str, password: str, email: str):
    """Register a new user."""
    try:
        result = await cognito_service.register_user(username, password, email)
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(f"Registration error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

@router.post("/confirm")
async def confirm_signup(username: str, confirmation_code: str):
    """Confirm user registration."""
    try:
        result = await cognito_service.confirm_signup(username, confirmation_code)
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(f"Confirmation error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

@router.post("/login")
async def login(username: str, password: str, response: Response):
    """Login user."""
    try:
        tokens = await cognito_service.authenticate_user(username, password)
        
        # Set tokens in session
        response.set_cookie(
            key="id_token",
            value=tokens['id_token'],
            httponly=True,
            secure=False,  # Set to True in production
            samesite="lax",
            max_age=3600  # 1 hour
        )
        
        return JSONResponse(content={
            "message": "Login successful",
            "tokens": tokens
        })
    except Exception as e:
        logger.error(f"Login error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials"
        )

@router.post("/logout")
async def logout(request: Request, response: Response):
    """Logout user."""
    try:
        # Get access token from request
        access_token = request.cookies.get("id_token")
        if not access_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated"
            )
        
        # Call Cognito logout
        await cognito_service.logout(access_token)
        
        # Clear session
        response.delete_cookie("id_token")
        
        return JSONResponse(content={"message": "Logged out successfully"})
    except Exception as e:
        logger.error(f"Logout error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

@router.post("/forgot-password")
async def forgot_password(username: str):
    """Initiate forgot password flow."""
    try:
        result = await cognito_service.forgot_password(username)
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(f"Forgot password error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

@router.post("/confirm-forgot-password")
async def confirm_forgot_password(username: str, confirmation_code: str, new_password: str):
    """Confirm forgot password."""
    try:
        result = await cognito_service.confirm_forgot_password(username, confirmation_code, new_password)
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(f"Confirm forgot password error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

@router.post("/change-password")
async def change_password(request: Request, old_password: str, new_password: str):
    """Change user's password."""
    try:
        # Get access token from request
        access_token = request.cookies.get("id_token")
        if not access_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated"
            )
        
        result = await cognito_service.change_password(access_token, old_password, new_password)
        return JSONResponse(content=result)
    except Exception as e:
        logger.error(f"Change password error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )

@router.get("/user")
async def get_user_info(request: Request):
    """Get user information."""
    try:
        # Get access token from request
        access_token = request.cookies.get("id_token")
        if not access_token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated"
            )
        
        user_info = await cognito_service.get_user_info(access_token)
        return JSONResponse(content=user_info)
    except Exception as e:
        logger.error(f"Get user info error: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token"
        ) 