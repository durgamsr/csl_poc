import json
import boto3
import os
from datetime import datetime, timezone

dynamodb_resource = boto3.resource('dynamodb')
DYNAMODB_TABLE_NAME = os.environ.get('DYNAMODB_TABLE_NAME', 'FileMetadata')
metadata_table = dynamodb_resource.Table(DYNAMODB_TABLE_NAME)

FOLDER_ITEM_SESSION_MARKER = "__FOLDER_INFO__" 
FOLDER_ITEM_FILENAME_MARKER = "__METADATA__"  

def lambda_handler(event, context):
    print("UpdateFolderMetadataLambda received event:", json.dumps(event))

    user_id = event.get('userId')
    user_defined_folder_name = event.get('folderId') 
    overall_status_from_sfn = event.get('status') 
    summary_s3_key = event.get('summaryS3Key') 
    error_details_from_sfn = event.get('errorDetails') 

    if not all([user_id, user_defined_folder_name, overall_status_from_sfn]):
        error_msg = "Error: Missing required fields userId, folderId, or status in the input event."
        print(error_msg)
        raise ValueError(error_msg)

    print(f"Request to update folder-level metadata for User: '{user_id}', Folder: '{user_defined_folder_name}' to Status: '{overall_status_from_sfn}'.")

    folder_item_sort_key_value = f"{FOLDER_ITEM_SESSION_MARKER}#{user_defined_folder_name}#{FOLDER_ITEM_FILENAME_MARKER}"

    set_actions = [
        "#fos = :folderOverallStatusVal",
        "#lu = :lastUpdatedVal"
    ]
    remove_actions = []
    expression_attribute_names = {
        "#fos": "folderOverallStatus",
        "#lu": "lastFolderUpdateTimestamp"
    }
    expression_attribute_values = {
        ":folderOverallStatusVal": overall_status_from_sfn,
        ":lastUpdatedVal": datetime.now(timezone.utc).isoformat()
    }

    if summary_s3_key and "summarized" in overall_status_from_sfn: 
        set_actions.append("#fssk = :summaryS3KeyVal")
        expression_attribute_names["#fssk"] = "folderSummaryS3Key"
        expression_attribute_values[":summaryS3KeyVal"] = summary_s3_key
        remove_actions.append("folderProcessingErrorDetails") 

    # If errorDetails is an object, convert to string. If already string, use as is.
    if error_details_from_sfn: # Check if errorDetails is not None and not empty
        if isinstance(error_details_from_sfn, dict) or isinstance(error_details_from_sfn, list):
            error_str = json.dumps(error_details_from_sfn)
        else:
            error_str = str(error_details_from_sfn)
        
        if "failed" in overall_status_from_sfn.lower() or "error" in overall_status_from_sfn.lower(): # Check if status indicates failure
            set_actions.append("#fped = :errorDetailsVal")
            expression_attribute_names["#fped"] = "folderProcessingErrorDetails"
            expression_attribute_values[":errorDetailsVal"] = error_str[:390 * 1024] 
            remove_actions.append("folderSummaryS3Key") 

    update_expression_clauses = []
    if set_actions:
        update_expression_clauses.append("SET " + ", ".join(set_actions))
    if remove_actions:
        unique_remove_actions = list(set(remove_actions)) 
        if unique_remove_actions:
             update_expression_clauses.append("REMOVE " + ", ".join(unique_remove_actions))
    
    final_update_expression = " ".join(update_expression_clauses)

    update_params = {
        'Key': {
            'userId': user_id,
            'sessionId#fileName': folder_item_sort_key_value
        },
        'UpdateExpression': final_update_expression,
        'ExpressionAttributeNames': expression_attribute_names,
        'ExpressionAttributeValues': expression_attribute_values
    }
    
    # Ensure EAV is not empty if there are placeholders in the expression
    if not expression_attribute_values and ":" in final_update_expression: # Basic check
        print("Warning: ExpressionAttributeValues is empty but placeholders exist in expression.")
        # This case should ideally not happen with current logic as :folderOverallStatusVal and :lastUpdatedVal are always set.
    elif not expression_attribute_names and "#" in final_update_expression:
        print("Warning: ExpressionAttributeNames is empty but placeholders exist in expression.")


    try:
        print(f"Attempting to update DynamoDB item with Key: userId='{user_id}', SK-Value='{folder_item_sort_key_value}'")
        print(f"UpdateExpression: {final_update_expression}")
        print(f"ExpressionAttributeNames: {json.dumps(expression_attribute_names)}")
        print(f"ExpressionAttributeValues: {json.dumps(expression_attribute_values)}")

        metadata_table.update_item(**update_params)
        print(f"Successfully updated/created folder metadata item. Status set to: {overall_status_from_sfn}")
        
    except Exception as e:
        print(f"Error updating/creating folder metadata item in DynamoDB: {str(e)}")
        raise

    return {
        "statusCode": 200,
        "body": json.dumps({
            "message": f"Folder '{user_defined_folder_name}' status update processed: '{overall_status_from_sfn}'.",
        })
    }
