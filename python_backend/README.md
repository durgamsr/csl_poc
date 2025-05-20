# RAG Application Backend

This is the Python FastAPI backend for the RAG Application with AWS Cognito authentication.

## Setup Instructions

1. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Create a `.env` file in the root directory with the following variables:
```env
# AWS Cognito Settings
AWS_REGION=us-east-1
COGNITO_USER_POOL_ID=your-user-pool-id
COGNITO_CLIENT_ID=your-client-id
COGNITO_CLIENT_SECRET=your-client-secret

# MongoDB Settings
MONGODB_URL=mongodb://localhost:27017
MONGODB_DB_NAME=rag_app

# OpenAI Settings
OPENAI_API_KEY=your-openai-api-key

# JWT Settings
JWT_SECRET_KEY=your-jwt-secret-key
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# File Upload Settings
UPLOAD_FOLDER=uploads
MAX_CONTENT_LENGTH=16777216  # 16MB in bytes
```

4. Run the application:
```bash
uvicorn app.main:app --reload
```

## API Endpoints

### Authentication

- POST `/api/auth/register` - Register a new user
- POST `/api/auth/login` - Login user
- POST `/api/auth/confirm` - Confirm user registration
- POST `/api/auth/forgot-password` - Initiate password reset
- POST `/api/auth/confirm-forgot-password` - Confirm password reset
- POST `/api/auth/change-password` - Change password

### Health Check

- GET `/health` - Check API health status

## Project Structure

```
python_backend/
├── app/
│   ├── api/
│   │   └── auth.py
│   ├── core/
│   │   └── config.py
│   ├── middleware/
│   │   └── auth_middleware.py
│   ├── models/
│   ├── schemas/
│   ├── services/
│   │   └── cognito_service.py
│   ├── utils/
│   └── main.py
├── requirements.txt
└── README.md
```

## Dependencies

- FastAPI
- Uvicorn
- PyCognito
- Python-multipart
- Python-jose
- Passlib
- Pydantic
- Python-dotenv
- Boto3
- PyMongo
- Motor
- LangChain
- PyPDF
- Python-docx 