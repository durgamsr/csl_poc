import os
import dotenv
from typing import List

# Load environment variables from .env file
dotenv.load_dotenv()

class Settings:
    """Configuration settings for the application."""
    
    def __init__(self):
        # AWS Settings
        self.AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
        self.AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID", "AKIAXNUAX4BL5SQV32NO")
        self.AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY", "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")
        self.S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "ragbucket0")
        
        # Cognito Settings
        self.COGNITO_USER_POOL_ID = os.getenv("COGNITO_USER_POOL_ID", "us-east-1_ttFGwbWYh")
        self.COGNITO_CLIENT_ID = os.getenv("COGNITO_CLIENT_ID", "45s6p83dc2hijfaqarm8mtbtfm")
        self.COGNITO_CLIENT_SECRET = os.getenv("COGNITO_CLIENT_SECRET", "1kphgh4ogo6trppdgieljv0ae20dkd81bbmokep1ak1j3jkupouj")
        self.COGNITO_REDIRECT_URI = "http://localhost:3001/api/auth/callback"
        self.COGNITO_AUTHORITY = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_ttFGwbWYh"
        self.COGNITO_SCOPE = ["email", "openid", "phone"]
        self.COGNITO_METADATA_URL = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_ttFGwbWYh/.well-known/openid-configuration"
        
        # OpenAI Settings
        
        # JWT Settings
        self.JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-secret-key")
        self.JWT_ALGORITHM = "HS256"
        self.ACCESS_TOKEN_EXPIRE_MINUTES = 30
        
        # File Upload Settings
        self.MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB
        self.ALLOWED_EXTENSIONS = ["pdf", "txt", "doc", "docx"]
        
        # Server Settings
        self.CORS_ORIGINS = ["http://localhost:3000"]
        self.SESSION_SECRET_KEY = os.getenv("SESSION_SECRET_KEY", "your-session-secret-key")

# Create a singleton instance
_settings = None

def get_settings() -> Settings:
    """Return the settings instance."""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings 