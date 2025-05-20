from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form, Request
from fastapi.responses import JSONResponse
from app.services.s3_service import S3Service
from app.middleware.auth_middleware import AuthMiddleware
from typing import Optional, Dict, List
import logging
import os
from datetime import datetime
import mimetypes

router = APIRouter()
s3_service = S3Service()
logger = logging.getLogger(__name__)

# Cache for file data
file_cache = {
    'user_caches': {},  # Cache per user
    'default_ttl': 3600000,  # 1 hour TTL for cache
    'is_fetching': {},
    's3_head_requests_cache': {}  # Cache for S3 headObject requests
}

def clear_all_caches():
    """Clear all file caches."""
    logger.info('Clearing all file caches')
    file_cache['user_caches'] = {}
    file_cache['is_fetching'] = {}
    file_cache['s3_head_requests_cache'] = {}

def get_user_cache(user_id: str) -> Dict:
    """Get or create a user cache."""
    if not user_id:
        user_id = 'anonymous'
    
    if user_id not in file_cache['user_caches']:
        file_cache['user_caches'][user_id] = {
            'data': None,
            'timestamp': None
        }
    
    return file_cache['user_caches'][user_id]

def clear_user_cache(user_id: str):
    """Clear cache for a specific user."""
    if not user_id:
        user_id = 'anonymous'
    
    if user_id in file_cache['user_caches']:
        logger.info(f"Clearing cache for user: {user_id}")
        file_cache['user_caches'][user_id] = {
            'data': None,
            'timestamp': None
        }

def determine_content_type(file_name: str) -> str:
    """Determine the content type of a file based on its extension."""
    content_type, _ = mimetypes.guess_type(file_name)
    return content_type or 'application/octet-stream'

@router.get("/user-folder")
async def get_user_folder(request: Request):
    """Get user's S3 folder information."""
    try:
        user_info = request.state.user
        user_username = user_info.get('username')
        folder_name = user_username
        
        files = await s3_service.list_user_files(user_username)
        
        return {
            'bucket': s3_service.bucket_name,
            'folderPath': f"{folder_name}/",
            'files': files
        }
    except Exception as e:
        logger.error(f"Error retrieving user folder information: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve folder information"
        )

@router.post("/upload")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    folder_path: Optional[str] = Form(None)
):
    """Upload file to user's S3 folder."""
    try:
        # Check if the user is authenticated via session
        user_path = None
        user_username = None
        
        if request.state.user and request.state.user.get('username'):
            # Use authenticated user's username
            user_username = request.state.user['username']
            user_path = user_username
        elif folder_path:
            # For non-authenticated users or direct API calls, use the provided folder path
            user_path = folder_path
            # Try to extract username from folderPath
            username_match = folder_path.split('/')[0] if '/' in folder_path else None
            user_username = username_match or 'anonymous'
        else:
            # Default fallback folder
            user_path = "anonymous"
            user_username = "anonymous"
        
        if not file:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No file uploaded"
            )
        
        # Get file metadata
        file_size = 0
        original_name = file.filename
        mime_type = file.content_type or determine_content_type(original_name)
        file_extension = original_name.split('.')[-1].lower() if '.' in original_name else ''
        
        # Extract session ID from folderPath if available
        session_id = ''
        if folder_path:
            session_match = folder_path.split('/')[1] if len(folder_path.split('/')) > 1 else None
            session_id = f"session-{session_match}" if session_match else ''
        
        # Construct the S3 key
        if folder_path:
            s3_key = f"{folder_path}{original_name}"
        else:
            s3_key = f"{user_path}/{original_name}"
        
        # Ensure the key is properly formatted
        s3_key = s3_key.replace('//', '/')
        
        # Read file content
        file_content = await file.read()
        file_size = len(file_content)
        
        # Add metadata to S3 object
        metadata = {
            'original-name': original_name,
            'upload-timestamp': datetime.utcnow().isoformat(),
            'file-size': str(file_size),
            'file-extension': file_extension,
            'uploaded-by': user_username,
            'session-id': session_id,
            'content-type': mime_type,
            'processed': 'true'
        }
        
        # Create folder structure first (if it doesn't exist)
        if folder_path:
            try:
                await s3_service.create_user_folder(folder_path)
                logger.info(f"Created folder: {folder_path}")
            except Exception as folder_error:
                logger.error(f"Error creating folder structure: {str(folder_error)}")
                # Continue with file upload even if folder creation fails
        
        # Upload file to S3
        upload_result = await s3_service.upload_file(file_content, s3_key, metadata)
        
        # Clear all caches when a new file is uploaded
        clear_all_caches()
        
        return {
            'success': True,
            'message': 'File uploaded successfully',
            'fileUrl': f"https://{s3_service.bucket_name}.s3.amazonaws.com/{s3_key}",
            'key': s3_key,
            'metadata': metadata,
            'contentType': mime_type,
            'size': file_size,
            'fileName': original_name,
            'fileType': file_extension or 'unknown'
        }
    except Exception as e:
        logger.error(f"Error uploading file to S3: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload file"
        )

@router.delete("/delete-file")
async def delete_file(request: Request, key: str):
    """Delete file from user's S3 folder."""
    try:
        logger.info(f"Delete file request received: {key}")
        if not key:
            logger.info("No file key provided in request body")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No file key provided"
            )
        
        user_info = request.state.user
        user_username = user_info.get('username')
        folder_name = user_username
        
        logger.info(f"Attempting to delete file with key: {key} for user: {user_username}")
        
        # Ensure user can only delete files from their own folder
        if not key.startswith(f"{folder_name}/"):
            logger.info(f"Access denied: File key {key} does not start with {folder_name}/")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
        
        await s3_service.delete_file(key)
        
        # Clear user's cache
        clear_user_cache(user_username)
        
        return {"success": True, "message": "File deleted successfully"}
    except Exception as e:
        logger.error(f"Error deleting file: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to delete file"
        ) 