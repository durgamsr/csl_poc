import json
import boto3
import os
import re
from datetime import datetime, timezone

s3_client = boto3.client('s3')
stepfunctions_client = boto3.client('stepfunctions')

S3_BUCKET_NAME = os.environ['S3_BUCKET_NAME']
STATE_MACHINE_ARN = os.environ['STATE_MACHINE_ARN']
UPLOAD_PREFIX = os.environ.get('S3_UPLOAD_PREFIX', '')  # Allow empty prefix

def lambda_handler(event, context):
    try:
        # Extract user info from JWT claims
        claims = event.get('requestContext', {}).get('authorizer', {}).get('jwt', {}).get('claims', {})
        user_id = claims.get('cognito:username') or claims.get('username') or claims.get('sub')
        
        if not user_id:
            return error_response(401, "Unauthorized: User ID not found.")
        
        # Parse the request body to get the folder ID
        body_str = event.get('body', '{}')
        body = json.loads(body_str) if body_str else {}
        folder_id = body.get('folderId')
        
        if not folder_id:
            return error_response(400, "folderId must be provided.")

        # Construct the S3 prefix for the specific folder
        user_folder_prefix = f"{user_id}/{folder_id}/"
        full_s3_prefix = f"{UPLOAD_PREFIX}{user_folder_prefix}"
        
        print(f"Listing objects in S3 prefix: {full_s3_prefix}")

        # Gather all relevant files under this prefix
        s3_items_for_step_function = []
        paginator = s3_client.get_paginator('list_objects_v2')
        for page in paginator.paginate(Bucket=S3_BUCKET_NAME, Prefix=full_s3_prefix):
            for obj in page.get('Contents', []):
                s3_key = obj['Key']
                
                # Skip empty folders and directory markers
                if s3_key.endswith('/'):
                    continue
                
                # Extract the relative file name (everything after the prefix)
                file_name = s3_key[len(full_s3_prefix):]
                
                # Skip any empty file names
                if not file_name.strip():
                    print(f"Skipping empty file name for '{s3_key}'")
                    continue

                # Extract the session ID from the folder structure
                folder_parts = folder_id.split('/')
                session_id = folder_parts[0] if len(folder_parts) > 1 else "unknown_session"

                s3_items_for_step_function.append({
                    "s3Key": s3_key,
                    "userId": user_id,
                    "folderId": folder_id,
                    "sessionId": session_id,
                    "fileName": file_name
                })

        # Handle empty folder case
        if not s3_items_for_step_function:
            print(f"No eligible files found to process in folder '{folder_id}' for user '{user_id}'.")
            return success_response(200, f"No files found to process in folder '{folder_id}'.")

        # Prepare Step Functions input
        sfn_input = {
            "userId": user_id,
            "folderId": folder_id,
            "s3ItemsToProcess": s3_items_for_step_function
        }

        # Generate a safe, unique execution name
        timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        safe_user_id = re.sub(r'[^a-zA-Z0-9-]', '', user_id.replace('_', '-'))
        safe_folder_id = re.sub(r'[^a-zA-Z0-9-]', '', folder_id.replace('/', '-').replace('_', '-'))
        execution_name = f"folderproc-{safe_user_id}-{safe_folder_id}-{timestamp}"[:80]

        print(f"Starting Step Function execution: {execution_name} with {len(s3_items_for_step_function)} items.")
        sfn_response = stepfunctions_client.start_execution(
            stateMachineArn=STATE_MACHINE_ARN,
            input=json.dumps(sfn_input),
            name=execution_name
        )

        # Return success response
        return success_response(202, f"Folder processing initiated for {len(s3_items_for_step_function)} files.", {
            "executionArn": sfn_response["executionArn"]
        })

    except json.JSONDecodeError as e:
        print(f"JSON Decode Error: {e}")
        return error_response(400, f"Invalid JSON in request body: {e}")
    except Exception as e:
        print(f"Unhandled error in InitiateFolderProcessingLambda: {e}")
        return error_response(500, f"Internal server error: {e}")

def success_response(status_code, message, extra_data=None):
    body = {"message": message}
    if extra_data:
        body.update(extra_data)
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps(body)
    }

def error_response(status_code, message):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
        },
        'body': json.dumps({"error": message})
    }
