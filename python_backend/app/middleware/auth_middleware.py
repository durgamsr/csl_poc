from fastapi import Request, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from app.services.cognito_service import CognitoService
from typing import Optional

security = HTTPBearer()

class AuthMiddleware:
    def __init__(self):
        self.cognito_service = CognitoService()

    async def __call__(self, request: Request, call_next):
        try:
            # Skip authentication for certain endpoints
            if request.url.path in ["/health", "/api/auth/login", "/api/auth/register", "/api/auth/confirm", "/api/auth/forgot-password"]:
                return await call_next(request)

            # Get the authorization header
            auth_header = request.headers.get("Authorization")
            if not auth_header:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Authorization header missing"
                )

            # Extract the token
            scheme, token = auth_header.split()
            if scheme.lower() != "bearer":
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication scheme"
                )

            # Verify the token and get user info
            user_info = await self.cognito_service.get_user_info(token)
            
            # Add user info to request state
            request.state.user = user_info
            
            return await call_next(request)

        except HTTPException as e:
            raise e
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials"
            ) 