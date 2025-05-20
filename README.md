# RAG Application with AWS Cognito and S3 Integration

This application integrates AWS Cognito for authentication and AWS S3 for user file storage.

## Features

- User authentication with AWS Cognito
- Automatic S3 folder creation for new users
- File upload to user-specific S3 folders
- File management (list, delete) for user files
- Pre-signed URLs for direct S3 uploads from the frontend
- Centralized configuration system for easy management of API keys and credentials

## Setup

### Prerequisites

- Node.js and npm installed
- AWS account with Cognito User Pool and S3 bucket
- Proper IAM permissions for S3 operations

### Backend Configuration

1. See [Configuration System](backend/CONFIG_SETUP.md) for detailed instructions on setting up environment variables

2. Install dependencies and start the backend server:

```
cd backend
npm install
npm run dev
```

### Frontend Configuration

1. Make sure the frontend is configured to use the backend APIs
2. Start the frontend server:

```
cd frontend
npm install
npm start
```

## API Endpoints

### Authentication

- **GET /login**: Redirects to AWS Cognito login page
- **GET /callback**: Handles OAuth callback from Cognito
- **GET /check-auth**: Checks if user is authenticated
- **GET /logout**: Logs out the user

### S3 File Operations

- **GET /user-folder**: Lists files in the user's S3 folder
- **POST /upload**: Uploads a file to the user's S3 folder
- **POST /generate-upload-url**: Generates a pre-signed URL for direct S3 uploads
- **DELETE /delete-file**: Deletes a file from the user's S3 folder

## S3 Folder Structure

Each user gets a dedicated folder in the S3 bucket based on their email:
```
bucket-name/
├── user1@example.com/
│   ├── file1.pdf
│   └── file2.jpg
├── user2@example.com/
│   └── document.docx
└── ...
```

## Security Considerations

- The application ensures users can only access their own S3 folders
- Authentication is required for all S3 operations
- Pre-signed URLs are short-lived (5 minutes) 