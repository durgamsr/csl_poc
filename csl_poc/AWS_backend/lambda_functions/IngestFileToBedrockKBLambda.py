import json
import boto3
import os
import urllib.parse
import time
from datetime import datetime, timezone
import re # For clientToken sanitization

s3_client = boto3.client('s3')
bedrock_agent_client = boto3.client('bedrock-agent')
dynamodb_resource = boto3.resource('dynamodb')

TABLE_NAME = os.environ['DYNAMODB_TABLE_NAME']
KB_ID = os.environ['KB_ID']
KB_DATASOURCE_ID = os.environ['KB_DATASOURCE_ID']
KB_S3_SOURCE_BUCKET = os.environ['KB_S3_SOURCE_BUCKET']
KB_S3_SOURCE_PREFIX = os.environ.get('KB_S3_SOURCE_PREFIX', 'kb-source').strip('/')
S3_BUCKET_NAME = os.environ['S3_BUCKET_NAME'] 

file_metadata_table = dynamodb_resource.Table(TABLE_NAME)

def update_status(user_id_for_dynamo_pk, original_s3_key_parts_for_sk, new_status, error_message=None):
    if len(original_s3_key_parts_for_sk) < 4:
        full_key_for_log = '/'.join(original_s3_key_parts_for_sk) if isinstance(original_s3_key_parts_for_sk, list) else str(original_s3_key_parts_for_sk)
        print(f"Error in update_status: S3 key parts insufficient for DynamoDB SK construction for '{full_key_for_log}'")
        return

    session_id_part = original_s3_key_parts_for_sk[1]
    user_folder_part = original_s3_key_parts_for_sk[2]
    file_name_part = original_s3_key_parts_for_sk[3]
    
    dynamodb_sort_key_value = f"{session_id_part}#{user_folder_part}#{file_name_part}"

    update_expression_list = ["SET #st = :statusVal", "#lsuTs = :lastStatusUpdateVal"]
    expression_attribute_names = {
        "#st": "status",
        "#lsuTs": "lastStatusUpdateTimestamp",
        "#sk": "sessionId#fileName" 
    }
    expression_attribute_values = {
        ":statusVal": new_status,
        ":lastStatusUpdateVal": datetime.now(timezone.utc).isoformat()
    }

    if error_message:
        update_expression_list.append("processingError = :errorVal")
        expression_attribute_values[":errorVal"] = str(error_message)[:1024] # Truncate error
    else: 
        update_expression_list.append("REMOVE processingError")

    final_update_expression = ", ".join(update_expression_list)
    if "REMOVE processingError" in final_update_expression and not error_message:
         final_update_expression = final_update_expression.replace(", REMOVE processingError", " REMOVE processingError")

    try:
        full_key_for_log = '/'.join(original_s3_key_parts_for_sk)
        print(f"Updating DynamoDB for PK: {user_id_for_dynamo_pk}, SK-Value: {dynamodb_sort_key_value} to status: {new_status}")
        file_metadata_table.update_item(
            Key={
                'userId': user_id_for_dynamo_pk, 
                'sessionId#fileName': dynamodb_sort_key_value
            },
            UpdateExpression=final_update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values,
            ConditionExpression="attribute_exists(userId) AND attribute_exists(#sk)"
        )
        print(f"Successfully updated status for S3 key '{full_key_for_log}' to {new_status}")
    except Exception as e:
        full_key_for_log = '/'.join(original_s3_key_parts_for_sk)
        print(f"Error updating DynamoDB status for S3 key '{full_key_for_log}': {str(e)}")
        raise # Re-raise to allow Step Functions to catch and handle retries/failure

def lambda_handler(event, context):
    original_s3_key_str = event['s3Key']        # Full S3 key of the original upload
    user_id_for_metadata = event['userId']      # Cognito username (for metadata content)
    folder_id_for_metadata = event['folderId']  # User-defined folder (for metadata content)
    
    original_s3_key_parts = original_s3_key_str.split('/')
    user_id_from_s3_path = original_s3_key_parts[0] # This is the PK for the DynamoDB item

    print(f"IngestFileToBedrockKBLambda: Processing file: {original_s3_key_str}")
    update_status(user_id_from_s3_path, original_s3_key_parts, "kb_ingestion_started")

    ingestion_job_id = None 
    kb_target_s3_key = None

    try:
        file_name_only = original_s3_key_parts[-1]
        # Target key in KB S3 source: KB_S3_SOURCE_PREFIX / COGNITO_USER_FROM_S3_PATH / USER_DEFINED_FOLDER_FROM_EVENT / FILENAME.EXT
        kb_target_s3_key = f"{KB_S3_SOURCE_PREFIX}/{user_id_from_s3_path}/{folder_id_for_metadata}/{file_name_only}"

        print(f"Copying from s3://{S3_BUCKET_NAME}/{original_s3_key_str} to s3://{KB_S3_SOURCE_BUCKET}/{kb_target_s3_key}")
        s3_client.copy_object(
            Bucket=KB_S3_SOURCE_BUCKET,
            CopySource={'Bucket': S3_BUCKET_NAME, 'Key': original_s3_key_str},
            Key=kb_target_s3_key,
            Metadata={ # Only other S3 metadata, user-id and folder-id go to .metadata.json
                'original-upload-s3-key': original_s3_key_str 
            },
            MetadataDirective='REPLACE' 
        )
        print(f"File copied to KB source location: {kb_target_s3_key}")

        metadata_content = {
            "metadataAttributes": {
                "user_id": user_id_for_metadata,       
                "folder_id": folder_id_for_metadata,   
                "original_s3_key": original_s3_key_str 
            }
        }
        metadata_file_key = f"{kb_target_s3_key}.metadata.json"
        s3_client.put_object(
            Bucket=KB_S3_SOURCE_BUCKET,
            Key=metadata_file_key,
            Body=json.dumps(metadata_content),
            ContentType='application/json'
        )
        print(f"Metadata file created at s3://{KB_S3_SOURCE_BUCKET}/{metadata_file_key}")

        print(f"Starting Bedrock KB ingestion job for KB_ID: {KB_ID}, DataSource_ID: {KB_DATASOURCE_ID}")
        
        sanitized_s3_key_part = re.sub(r'[^a-zA-Z0-9]+', '-', original_s3_key_str)
        sanitized_s3_key_part = re.sub(r'-+', '-', sanitized_s3_key_part).strip('-')
        max_s3_part_len = 256 - len(context.aws_request_id) - 1 - 10 
        client_token_s3_part = sanitized_s3_key_part[:max_s3_part_len]
        clientToken = f"{context.aws_request_id}-{client_token_s3_part}"
        clientToken = re.sub(r'[^a-zA-Z0-9-]+', '', clientToken) 
        clientToken = re.sub(r'-+', '-', clientToken).strip('-')[:256] 
        print(f"Generated clientToken: {clientToken}")

        ingestion_response = bedrock_agent_client.start_ingestion_job(
            knowledgeBaseId=KB_ID,
            dataSourceId=KB_DATASOURCE_ID,
            clientToken=clientToken 
        )
        ingestion_job_id = ingestion_response['ingestionJob']['ingestionJobId']
        print(f"Bedrock KB ingestion job started: {ingestion_job_id}. Polling for completion...")

        while True:
            job_status_response = bedrock_agent_client.get_ingestion_job(
                knowledgeBaseId=KB_ID,
                dataSourceId=KB_DATASOURCE_ID,
                ingestionJobId=ingestion_job_id
            )
            status = job_status_response['ingestionJob']['status']
            print(f"Ingestion job {ingestion_job_id} status: {status}")

            if status == 'COMPLETE':
                update_status(user_id_from_s3_path, original_s3_key_parts, "processed_kb_ingested")
                return {
                    "s3Key": original_s3_key_str, 
                    "kbTargetS3Key": kb_target_s3_key,
                    "userId": user_id_for_metadata, # Pass through for potential next steps
                    "folderId": folder_id_for_metadata, # Pass through
                    "sessionId": original_s3_key_parts[1], # Pass through
                    "status": "KB_INGESTION_SUCCEEDED", 
                    "jobId": ingestion_job_id
                }
            elif status == 'FAILED':
                failure_reasons = job_status_response['ingestionJob'].get('failureReasons', [])
                print(f"Ingestion job FAILED. Reasons: {failure_reasons}")
                update_status(user_id_from_s3_path, original_s3_key_parts, "kb_ingestion_failed", str(failure_reasons))
                raise Exception(f"Bedrock KB ingestion failed for {original_s3_key_str}: {failure_reasons}")
            elif status in ['IN_PROGRESS', 'STARTING']:
                time.sleep(30) 
            else: 
                print(f"Ingestion job in unexpected state: {status}")
                update_status(user_id_from_s3_path, original_s3_key_parts, "kb_ingestion_failed", f"Unexpected job status: {status}")
                raise Exception(f"Bedrock KB ingestion in unexpected state for {original_s3_key_str}: {status}")

            if context.get_remaining_time_in_millis() < 45000: 
                print("Approaching Lambda timeout, ingestion job still pending.")
                update_status(user_id_from_s3_path, original_s3_key_parts, "kb_ingestion_failed", "Lambda timeout while polling Bedrock ingestion job.")
                raise Exception("Lambda timeout waiting for Bedrock ingestion job")

    except Exception as e:
        error_str = str(e)
        print(f"Error during ingestion for {original_s3_key_str}: {error_str}")
        # If the error happened before job_id was set, or if kb_target_s3_key was set (meaning copy happened)
        # ensure a failed status is logged if not already done by the polling loop.
        if ingestion_job_id is None and kb_target_s3_key is not None: 
             update_status(user_id_from_s3_path, original_s3_key_parts, "kb_ingestion_failed", error_str)
        elif ingestion_job_id is None and kb_target_s3_key is None: # Failed even before S3 copy
             update_status(user_id_from_s3_path, original_s3_key_parts, "kb_ingestion_failed", f"Pre-copy error: {error_str}")


        raise 
