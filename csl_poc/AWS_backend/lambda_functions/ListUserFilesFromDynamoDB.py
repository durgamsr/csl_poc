import json
import boto3
import os
from boto3.dynamodb.conditions import Key, Attr
from decimal import Decimal

class DecimalEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, Decimal):
            if o % 1 == 0: return int(o)
            else: return float(o)
        return super(DecimalEncoder, self).default(o)

dynamodb = boto3.resource('dynamodb')
TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'FileMetadata')
table = dynamodb.Table(TABLE_NAME)

FOLDER_ITEM_SESSION_MARKER = "__FOLDER_INFO__"
FOLDER_ITEM_FILENAME_MARKER = "__METADATA__"

def lambda_handler(event, context):
    print("Received API Gateway event for ListUserFiles:", json.dumps(event, indent=2))

    try:
        claims = event.get('requestContext', {}).get('authorizer', {}).get('jwt', {}).get('claims', {})
        print("JWT claims:", claims)

        user_id = claims.get('cognito:username') 
        if not user_id: user_id = claims.get('username')
        if not user_id: user_id = claims.get('sub')

        if not user_id:
            print("Error: User identifier not found in JWT claims.")
            return {
                'statusCode': 401,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Unauthorized: User identifier not found.'})
            }
        
        print(f"Querying files and folder summaries for userId = {user_id}")

        response = table.query(KeyConditionExpression=Key('userId').eq(user_id))
        items = response.get('Items', [])
        
        while 'LastEvaluatedKey' in response:
            print(f"Paginating for more items for userId = {user_id}")
            response = table.query(
                KeyConditionExpression=Key('userId').eq(user_id),
                ExclusiveStartKey=response['LastEvaluatedKey']
            )
            items.extend(response.get('Items', []))
        
        files_output = []
        folder_metadata_map = {} 

        for item in items:
            sort_key_value = item.get('sessionId#fileName', '')
            
            if sort_key_value.startswith(FOLDER_ITEM_SESSION_MARKER) and \
               sort_key_value.endswith(FOLDER_ITEM_FILENAME_MARKER):
                parts = sort_key_value.split('#')
                if len(parts) == 3:
                    folder_name = parts[1]
                    folder_metadata_map[folder_name] = {
                        "folderName": folder_name,
                        "overallStatus": item.get("folderOverallStatus"),
                        "summaryS3Key": item.get("folderSummaryS3Key"),
                        "lastUpdatedAt": item.get("lastFolderUpdateTimestamp"),
                        "errorDetails": item.get("folderProcessingErrorDetails")
                    }
            else:
                # Individual file item
                file_item = {
                    "userId": item.get("userId"),
                    "originalS3Key": item.get("originalS3Key"),
                    "s3Bucket": item.get("s3Bucket"),
                    "sessionId": item.get("sessionId"),
                    "userFolder": item.get("userFolder"),
                    "fileName": item.get("fileName"),
                    "fileSize": item.get("fileSize"),
                    "uploadTimestamp": item.get("uploadTimestamp"),
                    "status": item.get("status"),
                    "lastStatusUpdateTimestamp": item.get("lastStatusUpdateTimestamp"),
                    "processingError": item.get("processingError")
                }
                files_output.append({k: v for k, v in file_item.items() if v is not None})


        print(f"Found {len(files_output)} file items and {len(folder_metadata_map)} folder metadata entries for userId = {user_id}")
        
        final_response_body = {
            "files": files_output,
            "folderMetadata": list(folder_metadata_map.values())
        }

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*' 
            },
            'body': json.dumps(final_response_body, cls=DecimalEncoder, indent=2) # Added indent for readability
        }

    except Exception as e:
        print(f"Error listing files for user: {str(e)}")
        import traceback
        traceback.print_exc()
        print("Full event causing error in ListUserFiles:", json.dumps(event, indent=2)) 
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': f'Internal server error: {str(e)}'})
        }
