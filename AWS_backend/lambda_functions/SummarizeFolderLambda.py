import json
import boto3
import os
import re
from datetime import datetime, timezone

dynamodb_resource = boto3.resource('dynamodb')
bedrock_agent_runtime_client = boto3.client('bedrock-agent-runtime')
s3_client = boto3.client('s3')

TABLE_NAME = os.environ['DYNAMODB_TABLE_NAME']
KB_ID = os.environ['KB_ID']
SUMMARY_MODEL_ID = os.environ['BEDROCK_SUMMARY_MODEL_ID']
S3_BUCKET_NAME = os.environ['S3_BUCKET_NAME']
S3_SUMMARY_PREFIX = os.environ.get('S3_SUMMARY_PREFIX', 'folder-summaries')

file_metadata_table = dynamodb_resource.Table(TABLE_NAME)

def clean_extracted_text(text):
    """Clean extracted text by removing nested JSON formatting and fixing truncated content."""
    if not text or text == "No data available":
        return text
        
    # Remove JSON field names and quotes (e.g., "efficacy": "The...)
    cleaned = re.sub(r'"[a-z_]+"\s*:\s*"', '', text)
    
    # Remove trailing quotes and commas that might be part of JSON formatting
    cleaned = re.sub(r'",?\s*$', '', cleaned)
    
    # Remove citation markers like (Source: 4)
    cleaned = re.sub(r'\(Sources?: \d+(?:, \d+)*\)', '', cleaned)
    
    # Remove JSON fragments that might have been included
    cleaned = re.sub(r'\\n\s*"[a-z_]+"\s*:\s*"[^"]*"', '', cleaned)
    
    # Remove any remaining JSON-like fragments
    cleaned = re.sub(r'\\n\s*"[^"]*"', '', cleaned)
    
    # Remove any remaining escaped quotes
    cleaned = cleaned.replace('\\"', '"')
    
    # Check if the text seems truncated (ends without punctuation)
    if cleaned and not re.search(r'[.!?]\s*$', cleaned):
        # If it looks like the content might continue in the full text, try to find the complete sentence
        if len(cleaned) > 10:  # Only try to extend if we have a reasonable string
            # Get the last 20 chars as a search pattern
            search_pattern = re.escape(cleaned[-20:])
            if 'full_summary' in globals():
                # Try to find the complete sentence in the full text
                match = re.search(f'{search_pattern}(.*?[.!?])', globals()['full_summary'], re.DOTALL)
                if match:
                    cleaned += match.group(1)
    
    return cleaned.strip()

def extract_sections_from_text(text):
    """Extract structured information from unstructured text."""
    # Store the full text in globals to help with fixing truncated content
    globals()['full_summary'] = text
    
    # Define the categories and various ways they might appear in the text
    categories = {
        "efficacy": ["efficacy", "effectiveness", "effective", "efficacious"],
        "safety": ["safety", "safe", "safety profile"],
        "tolerability": ["tolerability", "tolerable", "tolerated"],
        "dosage_administration": ["dosage", "administration", "dosing", "dose", "administered"],
        "quality_of_life": ["quality of life", "qol", "patient quality"],
        "pharmacokinetics_pharmacodynamics": ["pharmacokinetics", "pharmacodynamics", "pk", "pd", "pk/pd"],
        "study_design": ["study design", "trial design", "design of the study", "designed", "phase", "open-label", "single-arm"],
        "patient_population": ["patient population", "participants", "subjects", "demographics", "cohort", "enroll", "aged"],
        "endpoints": ["endpoints", "primary endpoint", "secondary endpoint", "outcome measures"],
        "adverse_events": ["adverse events", "adverse effects", "side effects", "aes", "toxicity"],
        "conclusions": ["conclusions", "conclusion", "summary", "overall"]
    }
    
    # Check if the text appears to be JSON but with text before/after
    json_section = None
    
    # Look for a JSON object in the text
    json_match = re.search(r'({[\s\S]*})', text)
    if json_match:
        try:
            # Try to parse the JSON object
            json_section = json.loads(json_match.group(1))
            print("Found embedded JSON object in text")
        except json.JSONDecodeError:
            # Not valid JSON, continue with text extraction
            pass
    
    # If we found valid JSON, use it as our starting point
    if json_section:
        result = {}
        for field in categories.keys():
            # Try to find the field in the JSON object
            if field in json_section:
                result[field] = clean_extracted_text(json_section[field])
            else:
                # Look for keys that might be relevant to this field
                for keyword in categories[field]:
                    matching_keys = [k for k in json_section.keys() if keyword.lower() in k.lower()]
                    if matching_keys:
                        result[field] = clean_extracted_text(json_section[matching_keys[0]])
                        break
                else:
                    result[field] = "No data available"
    else:
        # Process text-based extraction
        result = {}
        
        # Find all pattern-based sections
        all_sections = {}
        for field, keywords in categories.items():
            # Try to find sections that start with a keyword and continue until the next section
            for keyword in keywords:
                # Various patterns for different formatting styles
                patterns = [
                    # Look for JSON-like pattern: "keyword": "content"
                    rf'(?i)"(?:{keyword})"\s*:\s*"([^"]+)(?:"|\Z)',
                    
                    # Look for labeled sections with various formats
                    rf'(?i)\n\s*(?:•|-|\*|\d+\.)\s*{keyword}:?\s*(.*?)(?=\n\s*(?:•|-|\*|\d+\.)|$)',
                    rf'(?i)\n\s*{keyword}:?\s*(.*?)(?=\n\s*\w+:|\Z)',
                    
                    # Look for labeled sections in a structured document
                    rf'(?i){keyword}:\s*(.*?)(?=\n\s*\w+:|\Z)',
                    
                    # General pattern for any mention of the keyword with surrounding context
                    rf'(?i)(?:\.\s+|\n\s*|\A)([^.!?]*{keyword}[^.!?]*\.)'
                ]
                
                for pattern in patterns:
                    matches = re.finditer(pattern, text, re.DOTALL)
                    for match in matches:
                        content = match.group(1).strip()
                        if len(content.split()) > 3:  # Ensure it's substantial content
                            # For each field, store the longest/most detailed match
                            if field not in all_sections or len(content) > len(all_sections[field]):
                                all_sections[field] = content
                
        # Populate the result
        for field in categories.keys():
            if field in all_sections:
                result[field] = clean_extracted_text(all_sections[field])
            else:
                # Second attempt: Look for the keywords anywhere in the text
                for keyword in categories[field]:
                    # Extract complete sentences containing the keyword
                    pattern = rf'(?i)(?:[.!?]\s+|\n|\A)([^.!?]*{keyword}[^.!?]*[.!?])'
                    matches = re.finditer(pattern, text)
                    best_match = None
                    for match in matches:
                        sentence = match.group(1).strip()
                        if len(sentence.split()) > 3:
                            if not best_match or len(sentence) > len(best_match):
                                best_match = sentence
                    
                    if best_match:
                        result[field] = clean_extracted_text(best_match)
                        break
                else:
                    # Fallback: get a context window around the keyword
                    for keyword in categories[field]:
                        match = re.search(rf'(?i).{{0,150}}{keyword}.{{0,150}}', text)
                        if match:
                            context = match.group(0).strip()
                            if len(context.split()) > 3:
                                result[field] = clean_extracted_text(context)
                                break
                    else:
                        result[field] = "No data available"
    
    # Process each field to ensure clean, complete content
    for field in result:
        # Final cleanup
        if result[field] != "No data available":
            # Ensure complete sentences
            content = result[field]
            
            # Remove source attribution if present
            content = re.sub(r'\s*\([Ss]ources?:.*?\)', '', content)
            
            # Make sure the content starts with a capital letter
            if content and content[0].islower():
                # Try to find the start of the sentence
                sentence_start = re.search(r'(?<=[.!?]\s+)[A-Z]', ' ' + content)
                if sentence_start:
                    start_idx = sentence_start.start() - 1  # Adjust for the space we added
                    content = content[start_idx:]
                
            result[field] = content.strip()
    
    # Add the full summary
    result["full_summary"] = text
    
    return result

def lambda_handler(event, context):
    # Expected input from Step Functions: { "userId": "...", "folderId": "..." }
    user_id = event['userId']
    folder_id = event['folderId'] # This is the folder name/ID like "Testing"

    print(f"Starting summarization for User: {user_id}, Folder: {folder_id}")

    try:
        # Use RetrieveAndGenerate to get Bedrock to summarize content from the KB
        # scoped to this user and folder.
        # The prompt needs to guide the LLM to act as a summarizer for the retrieved context.

        # Construct a session ID for RetrieveAndGenerate if you want conversational context,
        # or generate a new one for each summary request.
        # session_id_for_kb = f"summary-{user_id}-{folder_id}-{context.aws_request_id}"

        retrieval_filter = {
            'andAll': [
                {'equals': {'key': 'user_id', 'value': user_id}},
                {'equals': {'key': 'folder_id', 'value': folder_id}}
            ]
        }

        # If you have many files/chunks, RetrieveAndGenerate might hit token limits
        # for the LLM context window. You might need to retrieve in batches
        # and then do a multi-stage summarization if RetrieveAndGenerate alone isn't enough.
        # For now, a direct summarization prompt:

        prompt_text = f"""
        Please provide a structured analysis of all clinical trial documents in the folder '{folder_id}' for user '{user_id}'.
        Return your response as JSON with the following fields. If information for a field is not available, use "No data available" as the value:
        
        - "efficacy": findings related to the drug's effectiveness
        - "safety": information about the drug's safety profile
        - "tolerability": how well patients tolerated the treatment
        - "dosage_administration": dosing information and administration details
        - "quality_of_life": impact on patient quality of life
        - "pharmacokinetics_pharmacodynamics": PK/PD information
        - "study_design": details about how the study was designed
        - "patient_population": information about the study participants
        - "endpoints": description of primary and secondary endpoints
        - "adverse_events": summary of adverse events
        - "conclusions": overall conclusions from the studies
        
        Format your response as a valid JSON object only, with no additional text.
        Do not include nested quotes within field values, and ensure all content is complete without truncation.
        """

        response = bedrock_agent_runtime_client.retrieve_and_generate(
            # sessionId=session_id_for_kb, # Optional
            input={'text': prompt_text},
            retrieveAndGenerateConfiguration={
                'type': 'KNOWLEDGE_BASE',
                'knowledgeBaseConfiguration': {
                    'knowledgeBaseId': KB_ID,
                    'modelArn': f"arn:aws:bedrock:{os.environ['AWS_REGION']}::foundation-model/{SUMMARY_MODEL_ID}", # Construct model ARN
                    'retrievalConfiguration': {
                        'vectorSearchConfiguration': {
                            'filter': retrieval_filter,
                            'numberOfResults': 10 # Adjust based on expected content size and LLM context
                        }
                    }
                }
            }
        )

        summary_text = response['output']['text']
        citation_chunks = response.get('citations', []) # To see what was retrieved

        print(f"Generated summary for folder '{folder_id}': {summary_text[:200]}...") # Log snippet
        if citation_chunks:
            print(f"Based on {len(citation_chunks)} retrieved chunks.")
            
        # Try to parse the summary as JSON, if it's not valid JSON, extract sections from text
        try:
            # First try with the raw text
            raw_json = json.loads(summary_text)
            
            # Clean up each field to remove any nested JSON formatting
            summary_json = {}
            for field, value in raw_json.items():
                summary_json[field] = clean_extracted_text(value)
                
            print("Successfully parsed summary as JSON")
        except json.JSONDecodeError:
            print("Response is not valid JSON, trying to fix JSON format")
            
            # Try to fix common JSON formatting issues
            # 1. Look for JSON-like content between curly braces
            json_match = re.search(r'({[\s\S]*})', summary_text, re.DOTALL)
            if json_match:
                try:
                    # Try to extract just the JSON part
                    extracted_json = json_match.group(1)
                    # Fix common JSON format issues
                    corrected_json = re.sub(r'(?<=\w)"(?=\s*:)', '"', extracted_json)  # Fix missing quotes before colon
                    corrected_json = re.sub(r',\s*}', '}', corrected_json)  # Remove trailing commas
                    
                    raw_json = json.loads(corrected_json)
                    
                    # Clean up each field
                    summary_json = {}
                    for field, value in raw_json.items():
                        summary_json[field] = clean_extracted_text(value)
                        
                    print("Successfully extracted and parsed JSON from text")
                except json.JSONDecodeError:
                    # 2. If still failing, try one more approach - remove any markdown formatting
                    cleaned_text = re.sub(r'```json|```', '', summary_text).strip()
                    try:
                        raw_json = json.loads(cleaned_text)
                        
                        # Clean up each field
                        summary_json = {}
                        for field, value in raw_json.items():
                            summary_json[field] = clean_extracted_text(value)
                            
                        print("Successfully parsed JSON after cleaning markdown")
                    except json.JSONDecodeError:
                        print("Unable to parse JSON, extracting sections from text")
                        summary_json = extract_sections_from_text(summary_text)
            else:
                print("No JSON-like content found, extracting sections from text")
                summary_json = extract_sections_from_text(summary_text)
        
        # Ensure all required fields are present
        required_fields = [
            "efficacy", "safety", "tolerability", "dosage_administration", 
            "quality_of_life", "pharmacokinetics_pharmacodynamics", "study_design", 
            "patient_population", "endpoints", "adverse_events", "conclusions"
        ]
        
        for field in required_fields:
            if field not in summary_json:
                summary_json[field] = "No data available"
        
        # Add the full summary if not present
        if "full_summary" not in summary_json:
            summary_json["full_summary"] = summary_text

        # Store the summary
        summary_s3_key = f"{S3_SUMMARY_PREFIX}/{user_id}/{folder_id}/summary_{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.json"
        s3_client.put_object(
            Bucket=S3_BUCKET_NAME,
            Key=summary_s3_key,
            Body=json.dumps(summary_json).encode('utf-8'),
            ContentType='application/json'
        )
        print(f"Summary stored at s3://{S3_BUCKET_NAME}/{summary_s3_key}")

        # Update DynamoDB for the folder (you might need a separate table or item for folder-level info)
        # For now, let's assume we're just logging success.
        # You might update a hypothetical folder status item in DynamoDB.
        # Example: (This assumes a 'FolderMetadata' table or similar)
        # folder_metadata_table.update_item(
        # Key={'userId': user_id, 'folderId': folder_id},
        # UpdateExpression="SET summaryS3Key = :val1, summarizationStatus = :val2, lastSummarized = :val3",
        # ExpressionAttributeValues={
        # ':val1': summary_s3_key,
        # ':val2': 'completed',
        # ':val3': datetime.now(timezone.utc).isoformat()
        # }
        # )

        return {
            "statusCode": 200,
            "summaryS3Key": summary_s3_key,
            "summary": summary_json,
            "message": f"Summarization complete for folder {folder_id}"
        }

    except Exception as e:
        print(f"Error during summarization for folder {folder_id}: {str(e)}")
        # Update folder status to summarization_failed if applicable
        raise 