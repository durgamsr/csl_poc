from pycognito import Cognito
from app.core.config import get_settings
from fastapi import HTTPException, status
from typing import Dict, Optional, Tuple
import jwt
import base64
import json
import logging
import requests

settings = get_settings()
logger = logging.getLogger(__name__)

class CognitoService:
    def __init__(self):
        self.user_pool_id = settings.COGNITO_USER_POOL_ID
        self.client_id = settings.COGNITO_CLIENT_ID
        self.client_secret = settings.COGNITO_CLIENT_SECRET
        self.region = settings.AWS_REGION
        self.redirect_uri = settings.COGNITO_REDIRECT_URI
        self.authority = settings.COGNITO_AUTHORITY
        self.scope = settings.COGNITO_SCOPE
        self.metadata_url = settings.COGNITO_METADATA_URL
        self._metadata = None

    @property
    def metadata(self):
        """Get OpenID Connect metadata."""
        if not self._metadata:
            try:
                response = requests.get(self.metadata_url)
                response.raise_for_status()
                self._metadata = response.json()
            except Exception as e:
                logger.error(f"Error fetching OIDC metadata: {str(e)}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to fetch OpenID Connect metadata"
                )
        return self._metadata

    def get_authorization_url(self, nonce: str, state: str) -> str:
        """Get the authorization URL for login."""
        auth_endpoint = self.metadata.get('authorization_endpoint')
        if not auth_endpoint:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Authorization endpoint not found in metadata"
            )

        params = {
            'client_id': self.client_id,
            'response_type': 'code',
            'scope': ' '.join(self.scope),
            'redirect_uri': self.redirect_uri,
            'state': state,
            'nonce': nonce
        }

        query_string = '&'.join(f"{k}={v}" for k, v in params.items())
        return f"{auth_endpoint}?{query_string}"

    async def process_callback(self, code: str, state: str, nonce: str) -> Tuple[Dict, Dict]:
        """Process the authentication callback."""
        try:
            token_endpoint = self.metadata.get('token_endpoint')
            if not token_endpoint:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Token endpoint not found in metadata"
                )

            # Exchange code for tokens
            token_data = {
                'grant_type': 'authorization_code',
                'client_id': self.client_id,
                'code': code,
                'redirect_uri': self.redirect_uri
            }

            if self.client_secret:
                token_data['client_secret'] = self.client_secret

            response = requests.post(token_endpoint, data=token_data)
            response.raise_for_status()
            tokens = response.json()

            # Get user info
            user_info = await self.get_user_info(tokens['access_token'])
            
            # Extract username from ID token
            try:
                id_token_parts = tokens['id_token'].split('.')
                if len(id_token_parts) == 3:
                    payload = json.loads(base64.b64decode(id_token_parts[1] + '=' * (-len(id_token_parts[1]) % 4)))
                    if 'cognito:username' in payload:
                        user_info['username'] = payload['cognito:username']
                        logger.info(f"Set username from JWT payload: {user_info['username']}")
            except Exception as e:
                logger.error(f"Error extracting username from token: {str(e)}")
            
            return user_info, tokens
        except Exception as e:
            logger.error(f"Error processing callback: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )

    async def get_user_info(self, access_token: str) -> Dict:
        """Get user information using the userinfo endpoint."""
        try:
            userinfo_endpoint = self.metadata.get('userinfo_endpoint')
            if not userinfo_endpoint:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Userinfo endpoint not found in metadata"
                )

            response = requests.get(
                userinfo_endpoint,
                headers={'Authorization': f'Bearer {access_token}'}
            )
            response.raise_for_status()
            user_data = response.json()
            
            return {
                'username': user_data.get('username', user_data.get('sub')),
                'attributes': user_data
            }
        except Exception as e:
            logger.error(f"Get user info error: {str(e)}")
            raise

    def get_logout_url(self, redirect_uri: str = 'http://localhost:3000') -> str:
        """Build logout URL."""
        end_session_endpoint = self.metadata.get('end_session_endpoint')
        if not end_session_endpoint:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="End session endpoint not found in metadata"
            )

        params = {
            'client_id': self.client_id,
            'logout_uri': redirect_uri
        }

        query_string = '&'.join(f"{k}={v}" for k, v in params.items())
        return f"{end_session_endpoint}?{query_string}"

    def log_token_info(self, token_set: Dict) -> None:
        """Log token information for debugging."""
        logger.info("Token Information:")
        logger.info(f"Access Token: {token_set.get('access_token', 'Not available')[:20]}...")
        logger.info(f"ID Token: {token_set.get('id_token', 'Not available')[:20]}...")
        logger.info(f"Refresh Token: {token_set.get('refresh_token', 'Not available')[:20]}...")
        logger.info(f"Token Type: {token_set.get('token_type', 'Not available')}")
        logger.info(f"Expires In: {token_set.get('expires_in', 'Not available')}")

    async def register_user(self, username: str, password: str, email: str) -> Dict:
        """Register a new user with Cognito."""
        try:
            cognito = self.get_cognito_instance()
            cognito.set_base_attributes(email=email)
            cognito.register(username, password)
            
            return {
                'username': username,
                'message': 'User registered successfully. Please check your email for verification code.'
            }
        except Exception as e:
            logger.error(f"Registration error: {str(e)}")
            raise

    async def authenticate_user(self, username: str, password: str) -> Dict:
        """Authenticate a user with Cognito."""
        try:
            token_endpoint = self.metadata.get('token_endpoint')
            if not token_endpoint:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Token endpoint not found in metadata"
                )

            # Use password grant type
            token_data = {
                'grant_type': 'password',
                'client_id': self.client_id,
                'username': username,
                'password': password,
                'scope': ' '.join(self.scope)
            }

            if self.client_secret:
                token_data['client_secret'] = self.client_secret

            response = requests.post(token_endpoint, data=token_data)
            response.raise_for_status()
            tokens = response.json()

            return {
                'id_token': tokens['id_token'],
                'access_token': tokens['access_token'],
                'refresh_token': tokens.get('refresh_token'),
                'token_type': tokens['token_type'],
                'expires_in': tokens['expires_in']
            }
        except Exception as e:
            logger.error(f"Authentication error: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid credentials"
            )

    async def confirm_signup(self, username: str, confirmation_code: str) -> Dict:
        """Confirm user signup with the verification code."""
        try:
            cognito = self.get_cognito_instance()
            cognito.confirm_sign_up(confirmation_code, username=username)
            
            return {
                'message': 'User confirmed successfully'
            }
        except Exception as e:
            logger.error(f"Confirmation error: {str(e)}")
            raise

    async def forgot_password(self, username: str) -> Dict:
        """Initiate forgot password flow."""
        try:
            cognito = self.get_cognito_instance(username=username)
            cognito.initiate_forgot_password()
            
            return {
                'message': 'Verification code sent to your email'
            }
        except Exception as e:
            logger.error(f"Forgot password error: {str(e)}")
            raise

    async def confirm_forgot_password(self, username: str, confirmation_code: str, new_password: str) -> Dict:
        """Confirm forgot password with the verification code."""
        try:
            cognito = self.get_cognito_instance(username=username)
            cognito.confirm_forgot_password(confirmation_code, new_password)
            
            return {
                'message': 'Password changed successfully'
            }
        except Exception as e:
            logger.error(f"Confirm forgot password error: {str(e)}")
            raise

    async def change_password(self, access_token: str, old_password: str, new_password: str) -> Dict:
        """Change user's password."""
        try:
            cognito = self.get_cognito_instance(tokens={'access_token': access_token})
            cognito.change_password(old_password, new_password)
            
            return {
                'message': 'Password changed successfully'
            }
        except Exception as e:
            logger.error(f"Change password error: {str(e)}")
            raise

    async def logout(self, access_token: str) -> Dict:
        """Logout user."""
        try:
            cognito = self.get_cognito_instance(tokens={'access_token': access_token})
            cognito.logout()
            
            return {
                'message': 'Logged out successfully'
            }
        except Exception as e:
            logger.error(f"Logout error: {str(e)}")
            raise 