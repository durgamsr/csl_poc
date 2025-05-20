import json
import boto3
import os
import urllib.parse

dynamodb = boto3.resource('dynamodb')
TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'FileMetadata')
table = dynamodb.Table(TABLE_NAME)

def lambda_handler(event, context):
    print("Received S3 delete event:", json.dumps(event, indent=2))

    try:
        for record in event['Records']:
            s3_record = record['s3']
            bucket_name = s3_record['bucket']['name']
            object_key = urllib.parse.unquote_plus(s3_record['object']['key'], encoding='utf-8')

            # IMPORTANT: Add a check for prefix if this trigger is on the whole bucket
            if not object_key.startswith(os.environ.get('S3_UPLOAD_PREFIX', 'uploads/')):
                print(f"Skipping S3 delete for key '{object_key}' as it does not match the expected upload prefix.")
                continue

            print(f"Processing DELETE for Bucket: '{bucket_name}', Key: '{object_key}'")
            
            path_after_prefix = object_key
            if 'S3_UPLOAD_PREFIX' in os.environ:
                upload_prefix = os.environ['S3_UPLOAD_PREFIX']
                if object_key.startswith(upload_prefix):
                    path_after_prefix = object_key[len(upload_prefix):]

            key_parts = path_after_prefix.split('/')
            if len(key_parts) < 4:
                print(f"Error: Object key part '{path_after_prefix}' after prefix incorrect structure for delete. Skipping.")
                continue

            user_id_from_path = key_parts[0]
            session_id_from_path = key_parts[1]
            user_folder_from_path = key_parts[2]
            file_name_from_path = key_parts[3]

            pk_to_delete = user_id_from_path
            sk_to_delete = f"{session_id_from_path}#{user_folder_from_path}#{file_name_from_path}"

            print(f"Attempting to delete from DynamoDB: PK='{pk_to_delete}', SK ('sessionId#fileName')='{sk_to_delete}'")
            
            response = table.delete_item(
                Key={
                    'userId': pk_to_delete,
                    'sessionId#fileName': sk_to_delete 
                }
                # Consider adding ConditionExpression to only delete if item exists and has certain attributes
            )
            print(f"DynamoDB delete_item response: {response}")
            print(f"Successfully processed S3 delete event for '{object_key}'. Metadata removed from DynamoDB.")

    except Exception as e:
        print(f"Error processing S3 delete event for object key '{object_key if 'object_key' in locals() else 'unknown'}'. Error: {str(e)}")
        print("Full event causing error:", json.dumps(event, indent=2))
        raise 

    return {
        'statusCode': 200,
        'body': json.dumps('Successfully processed S3 delete event records.')
    }
