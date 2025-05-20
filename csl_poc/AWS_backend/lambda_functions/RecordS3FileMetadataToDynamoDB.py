import json
import boto3
import os
import urllib.parse
from datetime import datetime, timezone

dynamodb = boto3.resource('dynamodb')
TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'FileMetadata')
S3_UPLOAD_PREFIX = os.environ.get('S3_UPLOAD_PREFIX', '')

table = dynamodb.Table(TABLE_NAME)

def lambda_handler(event, context):
    print("Received S3 event: ", json.dumps(event, indent=2))
    try:
        for record in event['Records']:
            s3_record = record['s3']
            bucket_name = s3_record['bucket']['name']
            object_key = urllib.parse.unquote_plus(s3_record['object']['key'], encoding='utf-8')
            file_size = s3_record['object'].get('size', 0)

            # Prefix Check
            if S3_UPLOAD_PREFIX and not object_key.startswith(S3_UPLOAD_PREFIX):
                print(f"Skipping S3 key '{object_key}' as it does not match the expected upload prefix '{S3_UPLOAD_PREFIX}'.")
                continue

            # Remove Prefix for Relative Path
            path_after_prefix = object_key[len(S3_UPLOAD_PREFIX):] if S3_UPLOAD_PREFIX else object_key
            key_parts = path_after_prefix.split('/')

            # Validate Path Structure
            if len(key_parts) < 4 or path_after_prefix.endswith('/'):
                print(f"Skipping folder '{path_after_prefix}' - not a valid file.")
                continue 

            # Extract Path Components
            user_id_from_path = key_parts[0]      
            session_id_from_path = key_parts[1]   
            user_folder_from_path = key_parts[2]  
            file_name_from_path = "/".join(key_parts[3:])

            # Ignore folder keys (no filename)
            if not file_name_from_path:
                print(f"Skipping S3 key '{object_key}' as it has an empty file name.")
                continue

            # Build Sort Key
            dynamodb_sort_key_value = f"{session_id_from_path}#{user_folder_from_path}#{file_name_from_path}"
            upload_timestamp = datetime.now(timezone.utc).isoformat()

            # Prepare DynamoDB Item
            item_to_store = {
                'userId': user_id_from_path,
                'sessionId#fileName': dynamodb_sort_key_value,
                'originalS3Key': object_key,
                's3Bucket': bucket_name,
                'sessionId': session_id_from_path,
                'userFolder': user_folder_from_path,
                'fileName': file_name_from_path,
                'fileSize': int(file_size),
                'uploadTimestamp': upload_timestamp,
                'status': "unprocessed",
                'lastStatusUpdateTimestamp': upload_timestamp
            }

            # Debug
            print("Item to be stored in DynamoDB:", json.dumps(item_to_store, indent=2))

            # Store Item
            table.put_item(Item=item_to_store)
            print(f"Successfully stored metadata for S3 object '{object_key}' in DynamoDB table '{TABLE_NAME}'.")

    except Exception as e:
        print(f"Error processing S3 event. Error: {str(e)}")
        print("Full event causing error:", json.dumps(event, indent=2))
        raise e

    return {
        'statusCode': 200,
        'body': json.dumps('Successfully processed all S3 event records.')
    }
