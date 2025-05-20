import boto3
from botocore.exceptions import ClientError
from app.core.config import get_settings
import logging
from typing import List, Dict, Optional
from datetime import datetime

settings = get_settings()
logger = logging.getLogger(__name__)

class S3Service:
    def __init__(self):
        self.s3 = boto3.client('s3', region_name=settings.AWS_REGION)
        self.bucket_name = settings.S3_BUCKET_NAME

    async def create_user_folder(self, username: str) -> Dict:
        """Create a folder for a new user in S3."""
        try:
            folder_name = username
            params = {
                'Bucket': self.bucket_name,
                'Key': f"{folder_name}/",
                'Body': ''  # Empty body as it's just a folder
            }
            
            result = await self.s3.put_object(**params)
            logger.info(f"Created folder for user {folder_name} in S3 bucket")
            return result
        except Exception as e:
            logger.error(f"Error creating folder for user {username}: {str(e)}")
            raise

    async def check_user_folder_exists(self, username: str) -> bool:
        """Check if a user folder already exists."""
        try:
            folder_name = username
            params = {
                'Bucket': self.bucket_name,
                'Prefix': f"{folder_name}/",
                'MaxKeys': 1
            }
            
            data = await self.s3.list_objects_v2(**params)
            return bool(data.get('Contents'))
        except Exception as e:
            logger.error(f"Error checking if folder exists for user {username}: {str(e)}")
            raise

    async def list_user_files(self, username: str) -> List[Dict]:
        """List files in a user's folder."""
        try:
            if not username or username == 'anonymous':
                logger.info('Anonymous or invalid username provided for S3 file listing')
                return []
            
            logger.info(f"Listing S3 files for user: {username}")
            
            params = {
                'Bucket': self.bucket_name,
                'Prefix': f"{username}/"
            }
            
            logger.info(f"S3 list_objects_v2 params: Bucket={self.bucket_name}, Prefix={username}/")
            
            s3_result = await self.s3.list_objects_v2(**params)
            
            logger.info(f"S3 list_objects_v2 found {len(s3_result.get('Contents', []))} objects")
            
            # Transform S3 objects to match desired format
            transformed_items = []
            for item in s3_result.get('Contents', []):
                if item['Size'] > 0:  # Filter out folder objects
                    # Extract fileName from the key (remove the prefix)
                    file_name = item['Key'].replace(f"{username}/", '')
                    session_id = file_name.split('/')[0] if '/' in file_name else 'default'
                    
                    transformed_items.append({
                        'userId': username,
                        'fileName': file_name,
                        'sessionId': session_id,
                        's3Bucket': self.bucket_name,
                        's3Key': item['Key'],
                        'uploadTimestamp': item['LastModified'].isoformat(),
                        'fileSize': item['Size'],
                        'status': 'unprocessed'
                    })
            
            logger.info(f"Returning {len(transformed_items)} transformed file items")
            return transformed_items
        except Exception as e:
            logger.error(f"Error listing files for user {username}: {str(e)}")
            return []

    async def list_session_files(self, username: str, session_id: str) -> List[Dict]:
        """List files in a specific session."""
        try:
            params = {
                'Bucket': self.bucket_name,
                'Prefix': f"{username}/{session_id}/"
            }
            
            s3_result = await self.s3.list_objects_v2(**params)
            
            # Transform S3 objects to the format expected by frontend
            files = []
            for item in s3_result.get('Contents', []):
                if item['Size'] > 0:  # Filter out folder objects
                    file_name = item['Key'].split('/')[-1]
                    files.append({
                        'fileName': file_name,
                        'fileSize': item['Size'],
                        'uploadedAt': item['LastModified'].isoformat(),
                        's3Key': item['Key'],
                        's3Url': f"https://{self.bucket_name}.s3.amazonaws.com/{item['Key']}",
                        'contentType': '',  # S3 doesn't return content type in list_objects_v2
                        'sessionId': session_id
                    })
            
            return files
        except Exception as e:
            logger.error(f"Error listing session files for user {username}, session {session_id}: {str(e)}")
            raise

    async def delete_file(self, key: str) -> bool:
        """Delete a file from S3."""
        try:
            params = {
                'Bucket': self.bucket_name,
                'Key': key
            }
            
            await self.s3.delete_object(**params)
            return True
        except Exception as e:
            logger.error(f"Error deleting file {key}: {str(e)}")
            raise

    async def upload_file(self, file_content: bytes, key: str, metadata: Dict) -> Dict:
        """Upload a file to S3."""
        try:
            params = {
                'Bucket': self.bucket_name,
                'Key': key,
                'Body': file_content,
                'Metadata': metadata
            }
            
            result = await self.s3.upload_fileobj(**params)
            return result
        except Exception as e:
            logger.error(f"Error uploading file {key}: {str(e)}")
            raise 