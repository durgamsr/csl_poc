const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');
const s3Service = require('../services/s3Service');
const apiGatewayService = require('../services/apiGatewayService');
const sessionService = require('../services/sessionService');
const { requireAuth, updateTokenInfo } = require('../middleware/auth');
const config = require('../config');
const axios = require('axios');

// Get S3 bucket name from config
const BUCKET_NAME = config.aws.s3.bucketName || s3Service.BUCKET_NAME;

// Configure AWS SDK
const s3 = new AWS.S3({
    region: config.aws.region
});

// Configure multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Get user's S3 folder information
router.get('/user-folder', requireAuth, async (req, res) => {
    try {
        const userUsername = req.session.userInfo.username;
        const folderName = userUsername;
        
        const params = {
            Bucket: BUCKET_NAME,
            Prefix: `${folderName}/`,
            MaxKeys: 100
        };
        
        const data = await s3.listObjectsV2(params).promise();
        
        // Return folder information
        res.json({
            bucket: BUCKET_NAME,
            folderPath: `${folderName}/`,
            files: data.Contents ? data.Contents.map(item => ({
                key: item.Key,
                size: item.Size,
                lastModified: item.LastModified
            })) : []
        });
    } catch (error) {
        console.error('Error retrieving user folder information:', error);
        res.status(500).json({ error: 'Failed to retrieve folder information' });
    }
});

// Cache for file data
const fileCache = {
  userCaches: {}, // Cache per user
  defaultTTL: 3600000, // 1 hour TTL for cache to reduce API calls
  isFetching: {},
  s3HeadRequestsCache: {} // Cache for S3 headObject requests
};

// Function to clear all caches
function clearAllCaches() {
    console.log('Clearing all file caches');
    fileCache.userCaches = {};
    fileCache.isFetching = {};
    fileCache.s3HeadRequestsCache = {};
}

// Function to get or create a user cache
function getUserCache(userId) {
    if (!userId) {
        userId = 'anonymous';
    }
    
    if (!fileCache.userCaches[userId]) {
        // Initialize cache for this user
        fileCache.userCaches[userId] = {
            data: null,
            timestamp: null
        };
    }
    
    return fileCache.userCaches[userId];
}

// Function to clear cache for a specific user
function clearUserCache(userId) {
    if (!userId) {
        userId = 'anonymous';
    }
    
    if (fileCache.userCaches[userId]) {
        console.log(`Clearing cache for user: ${userId}`);
        fileCache.userCaches[userId] = {
            data: null,
            timestamp: null
        };
    }
}

// Upload file to user's S3 folder
router.post('/upload', upload.single('file'), async (req, res) => {
    try {
        // Check if the user is authenticated via session
        let userPath;
        let userUsername;
        
        if (req.session.isAuthenticated && req.session.userInfo && req.session.userInfo.username) {
            // Use authenticated user's username
            userUsername = req.session.userInfo.username;
            // Use the username directly without transformation
            userPath = userUsername;
        } else if (req.body.folderPath) {
            // For non-authenticated users or direct API calls, use the provided folder path
            userPath = req.body.folderPath;
            // Try to extract username from folderPath
            const usernameMatch = req.body.folderPath.match(/^([^\/]+)\//);
            userUsername = usernameMatch ? usernameMatch[1] : 'anonymous';
        } else {
            // Default fallback folder
            userPath = "anonymous/";
            userUsername = "anonymous";
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const fileContent = fs.readFileSync(req.file.path);
        
        // Get file metadata
        const fileSize = req.file.size;
        const originalName = req.file.originalname;
        const mimeType = req.file.mimetype || determineContentType(originalName);
        const fileExtension = originalName.includes('.') ? 
            originalName.split('.').pop().toLowerCase() : '';
        
        // Extract session ID from folderPath if available
        let sessionId = '';
        if (req.body.folderPath) {
            const sessionMatch = req.body.folderPath.match(/session-([^\/]+)/);
            sessionId = sessionMatch ? sessionMatch[0] : '';
        }
        
        // Construct the S3 key based on folder path and file name
        // This will organize files into user/session folders
        let s3Key;
        
        if (req.body.folderPath) {
            // Use the folder path from the request (e.g., "user@example.com/session-123/")
            s3Key = `${req.body.folderPath}${req.file.originalname}`;
        } else {
            // Use the authenticated user path
            s3Key = `${userPath}/${req.file.originalname}`;
        }
        
        // Ensure the key is properly formatted
        s3Key = s3Key.replace(/\/+/g, '/'); // Replace multiple slashes with a single one
        
        // Add metadata to S3 object
        const params = {
            Bucket: BUCKET_NAME,
            Key: s3Key,
            Body: fileContent,
            ContentType: mimeType,
            Metadata: {
                'original-name': originalName,
                'upload-timestamp': new Date().toISOString(),
                'file-size': fileSize.toString(),
                'file-extension': fileExtension,
                'uploaded-by': userUsername,
                'session-id': sessionId,
                'content-type': mimeType,
                'processed': 'true'
            }
        };
        
        // Create folder structure first (if it doesn't exist)
        if (req.body.folderPath) {
            const folderKey = req.body.folderPath;
            try {
                // Check if folder exists
                const folderParams = {
                    Bucket: BUCKET_NAME,
                    Key: folderKey,
                    Body: '' // Empty body for folder creation
                };
                await s3.putObject(folderParams).promise();
                console.log(`Created folder: ${folderKey}`);
            } catch (folderError) {
                console.error('Error creating folder structure:', folderError);
                // Continue with file upload even if folder creation fails
            }
        }
        
        const uploadResult = await s3.upload(params).promise();
        
        // Clean up the temporary file
        fs.unlinkSync(req.file.path);
        
        // Clear all caches when a new file is uploaded
        clearAllCaches();
        
        res.json({
            success: true,
            message: 'File uploaded successfully',
            fileUrl: uploadResult.Location,
            key: uploadResult.Key,
            metadata: params.Metadata,
            contentType: mimeType,
            size: fileSize,
            fileName: originalName,
            fileType: fileExtension || 'unknown'
        });
    } catch (error) {
        console.error('Error uploading file to S3:', error);
        // Clean up the temporary file if it exists
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (unlinkError) {
                console.error('Error deleting temporary file:', unlinkError);
            }
        }
        res.status(500).json({ error: 'Failed to upload file' });
    }
});

// Delete file from user's S3 folder
router.delete('/delete-file', requireAuth, async (req, res) => {
    try {
        console.log('Delete file request received:', req.body);
        const { key } = req.body;
        if (!key) {
            console.log('No file key provided in request body');
            return res.status(400).json({ success: false, error: 'No file key provided' });
        }
        
        const userUsername = req.session.userInfo.username;
        const folderName = userUsername;
        
        console.log(`Attempting to delete file with key: ${key} for user: ${userUsername}`);
        
        // Ensure user can only delete files from their own folder
        if (!key.startsWith(`${folderName}/`)) {
            console.log(`Access denied: File key ${key} does not start with ${folderName}/`);
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        
        const params = {
            Bucket: BUCKET_NAME,
            Key: key
        };
        
        console.log(`Deleting object from S3 bucket ${BUCKET_NAME}, key: ${key}`);
        await s3.deleteObject(params).promise();
        console.log(`Successfully deleted file with key: ${key}`);
        
        // Clear all caches when a file is deleted
        clearAllCaches();
        console.log('All caches cleared after file deletion');
        
        // Check if the file was in a session folder
        const sessionMatch = key.match(/^([^\/]+)\/([^\/]+)\/[^\/]+$/);
        if (sessionMatch && sessionMatch[2] && sessionMatch[2].startsWith('session-')) {
            const username = sessionMatch[1];
            const sessionId = sessionMatch[2];
            const sessionPrefix = `${username}/${sessionId}/`;
            
            console.log(`Checking if session folder ${sessionPrefix} is empty after file deletion`);
            
            // List objects in the session folder
            const listParams = {
                Bucket: BUCKET_NAME,
                Prefix: sessionPrefix,
                MaxKeys: 2 // Only need to check if there's at least one file left
            };
            
            const sessionObjects = await s3.listObjectsV2(listParams).promise();
            
            // If the folder is empty or only contains the folder object itself, delete the folder
            if (!sessionObjects.Contents || 
                sessionObjects.Contents.length === 0 || 
                (sessionObjects.Contents.length === 1 && sessionObjects.Contents[0].Key === sessionPrefix)) {
                
                console.log(`Session folder ${sessionPrefix} is empty, deleting it`);
                
                // Delete the folder object
                const folderParams = {
                    Bucket: BUCKET_NAME,
                    Key: sessionPrefix
                };
                
                await s3.deleteObject(folderParams).promise();
                console.log(`Successfully deleted empty session folder: ${sessionPrefix}`);
            }
        }
        
        console.log('Sending success response for file deletion');
        res.json({
            success: true,
            message: 'File deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting file from S3:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete file',
            message: error.message 
        });
    }
});

// Generate pre-signed URL for direct S3 uploads from the frontend
router.post('/generate-upload-url', requireAuth, async (req, res) => {
    try {
        const { fileName, fileType } = req.body;
        if (!fileName || !fileType) {
            return res.status(400).json({ error: 'File name and type are required' });
        }
        
        const userUsername = req.session.userInfo.username;
        const folderName = userUsername;
        const key = `${folderName}/${fileName}`;
        
        const params = {
            Bucket: BUCKET_NAME,
            Key: key,
            ContentType: fileType,
            Expires: 60 * 5 // URL expires in 5 minutes
        };
        
        const uploadURL = await s3.getSignedUrlPromise('putObject', params);
        
        res.json({
            uploadURL,
            key
        });
    } catch (error) {
        console.error('Error generating pre-signed URL:', error);
        res.status(500).json({ error: 'Failed to generate upload URL' });
    }
});

// Add batch function for S3 headObject requests to reduce API calls
async function batchGetMetadata(keys) {
    console.log(`Getting metadata for ${keys.length} files in batch mode`);
    const metadataPromises = {};
    const now = Date.now();
    
    // For each key, check if we have it cached first
    for (const key of keys) {
        const metadataCacheKey = `metadata_${key}`;
        
        if (fileCache.s3HeadRequestsCache[metadataCacheKey] && 
            (now - fileCache.s3HeadRequestsCache[metadataCacheKey].timestamp < fileCache.ttl)) {
            // Use cached metadata
            metadataPromises[key] = Promise.resolve(fileCache.s3HeadRequestsCache[metadataCacheKey].data || {});
        } else {
            // Create a promise to get the metadata
            metadataPromises[key] = (async () => {
                try {
                    const headParams = {
                        Bucket: BUCKET_NAME,
                        Key: key
                    };
                    
                    console.log(`Making S3 headObject call for ${key}`);
                    const headData = await s3.headObject(headParams).promise();
                    const metadata = headData.Metadata || {};
                    
                    // Cache this metadata
                    fileCache.s3HeadRequestsCache[metadataCacheKey] = {
                        timestamp: now,
                        data: metadata
                    };
                    
                    return metadata;
                } catch (metadataError) {
                    console.error(`Failed to get metadata for ${key}:`, metadataError);
                    return {};
                }
            })();
        }
    }
    
    // Wait for all promises to resolve
    const results = {};
    for (const key of keys) {
        results[key] = await metadataPromises[key];
    }
    
    return results;
}

// Update the listUserFiles function to use batch mode
async function listUserFiles(username) {
    try {
        if (!username) {
            return [];
        }
        
        const params = {
            Bucket: BUCKET_NAME,
            Prefix: `${username}/`
        };
        
        // Use cached listObjectsV2 result if available
        const cacheKey = `list_${username}`;
        const now = Date.now();
        
        // Check if we have this specific list operation cached
        if (fileCache.s3HeadRequestsCache[cacheKey] && 
            (now - fileCache.s3HeadRequestsCache[cacheKey].timestamp < fileCache.ttl)) {
            console.log(`Using cached S3 listObjectsV2 result for ${username}`);
            return fileCache.s3HeadRequestsCache[cacheKey].data;
        }
        
        console.log(`Making S3 listObjectsV2 call for ${username}`);
        const data = await s3.listObjectsV2(params).promise();
        
        if (!data.Contents || data.Contents.length === 0) {
            return [];
        }
        
        // Collect valid keys for batch processing
        const validKeys = [];
        const validItems = [];
        
        data.Contents.forEach(item => {
            // Skip folder objects (they end with / and have 0 size)
            if (!item.Key.endsWith('/') || item.Size > 0) {
                // Get the file name from the key
                const fileName = item.Key.split('/').pop();
                
                // If the filename is not empty, add to valid items
                if (fileName) {
                    validKeys.push(item.Key);
                    validItems.push(item);
                }
            }
        });
        
        // Batch get metadata for all valid keys
        const batchMetadata = await batchGetMetadata(validKeys);
        
        // Process each file using the batch metadata results
        const processedFiles = validItems.map(item => {
            const key = item.Key;
            const fileName = key.split('/').pop();
            
            // Extract session ID if available
            let sessionId = 'default';
            const sessionMatch = key.match(/session-([^\/]+)/);
            if (sessionMatch) {
                sessionId = sessionMatch[0];
            }
            
            // Get metadata from batch results
            const metadata = batchMetadata[key] || {};
            
            // Determine file type/extension
            const fileExtension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
            const contentType = metadata['content-type'] || determineContentType(fileName);
            
            return {
                key: key,
                fileName: fileName || 'Unknown File',
                fileSize: item.Size,
                lastModified: item.LastModified,
                uploadTimestamp: item.LastModified.toISOString(),
                sessionId: sessionId,
                fileType: fileExtension || 'unknown',
                contentType: contentType,
                originalName: metadata['original-name'] || fileName,
                processed: true  // Mark as properly processed
            };
        });
        
        // Cache the entire result
        fileCache.s3HeadRequestsCache[cacheKey] = {
            timestamp: now,
            data: processedFiles
        };
        
        return processedFiles;
    } catch (error) {
        console.error('Error listing user files from S3:', error);
        return [];
    }
}

// Helper function to determine content type based on file extension
function determineContentType(fileName) {
    const extension = fileName.split('.').pop().toLowerCase();
    const contentTypeMap = {
        'pdf': 'application/pdf',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls': 'application/vnd.ms-excel',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt': 'application/vnd.ms-powerpoint',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'txt': 'text/plain',
        'csv': 'text/csv',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'mp3': 'audio/mpeg',
        'mp4': 'video/mp4',
        'zip': 'application/zip',
        'json': 'application/json',
        'html': 'text/html',
        'css': 'text/css',
        'js': 'application/javascript'
    };
    
    return contentTypeMap[extension] || 'application/octet-stream';
}

// Helper function to list session files from S3
async function listSessionFiles(username, sessionId) {
    try {
        if (!username || !sessionId) {
            return [];
        }
        
        const prefix = `${username}/${sessionId}`;
        
        // Use cached result if available
        const cacheKey = `session_${username}_${sessionId}`;
        const now = Date.now();
        
        if (fileCache.s3HeadRequestsCache[cacheKey] && 
            (now - fileCache.s3HeadRequestsCache[cacheKey].timestamp < fileCache.ttl)) {
            console.log(`Using cached S3 session files for ${prefix}`);
            return fileCache.s3HeadRequestsCache[cacheKey].data;
        }
        
        const params = {
            Bucket: BUCKET_NAME,
            Prefix: prefix
        };
        
        console.log(`Making S3 listObjectsV2 call for session ${prefix}`);
        const data = await s3.listObjectsV2(params).promise();
        
        if (!data.Contents) {
            return [];
        }
        
        // Process each file to extract and format metadata
        const processedFiles = await Promise.all(data.Contents.map(async (item) => {
            // Skip folder objects (they end with / and have 0 size)
            if (item.Key.endsWith('/') && item.Size === 0) {
                return null;
            }
            
            // Get the file name from the key
            const key = item.Key;
            const fileName = key.split('/').pop();
            
            // If the filename is empty, skip this item
            if (!fileName) {
                return null;
            }
            
            // Get file metadata if available - use cached metadata when possible
            let metadata = {};
            const metadataCacheKey = `metadata_${key}`;
            
            if (fileCache.s3HeadRequestsCache[metadataCacheKey] && 
                (now - fileCache.s3HeadRequestsCache[metadataCacheKey].timestamp < fileCache.ttl)) {
                // Use cached metadata
                metadata = fileCache.s3HeadRequestsCache[metadataCacheKey].data || {};
            } else {
                try {
                    const headParams = {
                        Bucket: BUCKET_NAME,
                        Key: key
                    };
                    
                    console.log(`Making S3 headObject call for ${key}`);
                    const headData = await s3.headObject(headParams).promise();
                    metadata = headData.Metadata || {};
                    
                    // Cache this metadata
                    fileCache.s3HeadRequestsCache[metadataCacheKey] = {
                        timestamp: now,
                        data: metadata
                    };
                } catch (metadataError) {
                    console.error(`Failed to get metadata for ${key}:`, metadataError);
                }
            }
            
            // Determine file type/extension
            const fileExtension = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
            const contentType = metadata['content-type'] || determineContentType(fileName);
            
            return {
                key: key,
                fileName: fileName || 'Unknown File',
                fileSize: item.Size,
                lastModified: item.LastModified.toISOString(),
                uploadTimestamp: item.LastModified.toISOString(),
                sessionId: sessionId,
                fileType: fileExtension || 'unknown',
                contentType: contentType,
                originalName: metadata['original-name'] || fileName,
                processed: true  // Mark as properly processed
            };
        }));
        
        // Filter out null entries (folders or invalid items)
        const result = processedFiles.filter(file => file !== null);
        
        // Cache the result
        fileCache.s3HeadRequestsCache[cacheKey] = {
            timestamp: now,
            data: result
        };
        
        return result;
    } catch (error) {
        console.error('Error listing session files from S3:', error);
        return [];
    }
}

// Get files as JSON for frontend (legacy endpoint)
router.get('/', async (req, res) => {
    try {
        // Get user info from session
        const userInfo = sessionService.getUserFromSession(req);
        
        // Try to get files from API Gateway only, no S3 fallback
        const accessToken = sessionService.getAccessToken(req);
        try {
            console.log(`Attempting to fetch files from API Gateway with token: ${accessToken ? 'Available' : 'Not Available'}`);
            const apiResponse = await apiGatewayService.fetchFiles(accessToken);
            
            // Return the API Gateway response even if empty
            console.log(`API Gateway returned ${apiResponse.items ? apiResponse.items.length : 0} files`);
            return res.json({
                success: true,
                Items: apiResponse.items || [],
                source: 'apigateway'
            });
        } catch (apiError) {
            console.error('API Gateway fetch failed:', apiError);
            
            // Return empty results instead of falling back to S3
            return res.json({
                success: true,
                Items: [],
                source: 'apigateway',
                error: apiError.message
            });
        }
    } catch (error) {
        console.error('Error retrieving files:', error);
        res.status(500).json({ 
            error: 'Failed to retrieve files',
            message: error.message
        });
    }
});

// New endpoint to serve file data for the FileTable component
router.get('/api/files', updateTokenInfo, async (req, res) => {
    try {
        console.log('Handling /api/files request');
        
        // Get user ID for cache namespacing
        const userInfo = req.session.userInfo || {};
        const userId = userInfo.username || userInfo.sub || sessionService.getUsernameFromSession(req) || 'anonymous';
        console.log(`Request from user: ${userId}`);
        
        // Get or create user cache
        const userCache = getUserCache(userId);
        
        // Check if we have a valid cache for this user
        const now = Date.now();
        if (userCache.data && (now - userCache.timestamp < fileCache.defaultTTL)) {
            const cacheAge = Math.round((now - userCache.timestamp)/1000);
            console.log(`Returning cached file data for user ${userId}, age: ${cacheAge} seconds`);
            return res.json({
                ...userCache.data,
                source: 'cache',
                cache_age_seconds: cacheAge
            });
        }
        
        // Check if another request from this user is already in progress
        if (fileCache.isFetching[userId]) {
            console.log(`Another request is already fetching data for user ${userId}, waiting for that to complete`);
            // Wait for the in-progress request to complete, then return its results
            // Use a short poll to wait for the cache to be populated
            let attempts = 0;
            const maxAttempts = 10;
            const checkInterval = 200; // 200ms
            
            const waitForCache = async () => {
                if (userCache.data && userCache.timestamp > now) {
                    // Cache was populated during our wait
                    console.log(`Cache was populated during wait for user ${userId}`);
                    const cacheAge = Math.round((Date.now() - userCache.timestamp)/1000);
                    return res.json({
                        ...userCache.data,
                        source: 'cache_after_wait',
                        cache_age_seconds: cacheAge
                    });
                }
                
                attempts++;
                if (attempts >= maxAttempts) {
                    // If we've waited too long, proceed with our own request
                    console.log(`Waited too long for other request, proceeding with own request for ${userId}`);
                    fileCache.isFetching[userId] = false;
                } else {
                    // Wait and check again
                    await new Promise(resolve => setTimeout(resolve, checkInterval));
                    return waitForCache();
                }
            };
            
            if (fileCache.isFetching[userId]) {
                return waitForCache();
            }
        }
        
        // Set fetching flag to prevent duplicate requests
        fileCache.isFetching[userId] = true;
        console.log(`Setting fetching flag for user ${userId}`);
        
        // Get access token from session
        const accessToken = sessionService.getAccessToken(req);
        
        try {
            // Try the API Gateway 
            console.log('Attempting to fetch files from API Gateway');
            console.log(`Using access token: ${accessToken ? 'Available' : 'Not Available'}`);
            
            if (!accessToken) {
                console.log('No access token available, returning empty result');
                const emptyResponse = {
                    success: true,
                    Items: [],
                    source: 'no_token',
                    message: 'No access token available'
                };
                
                userCache.data = emptyResponse;
                userCache.timestamp = Date.now();
                fileCache.isFetching[userId] = false;
                
                return res.json(emptyResponse);
            }
            
            // Make a single API Gateway call
            console.log(`Making single API Gateway call for user ${userId}`);
            const apiResponse = await apiGatewayService.fetchFiles(accessToken, userInfo);
            
            // Format the response
            const responseData = { 
                success: true, 
                Items: apiResponse.items || [],
                source: 'apigateway',
                fetch_time: new Date().toISOString()
            };
            
            // Update cache for this user
            userCache.data = responseData;
            userCache.timestamp = Date.now();
            
            // Clear the fetching flag
            console.log(`Clearing fetching flag for user ${userId}`);
            fileCache.isFetching[userId] = false;
            
            return res.json(responseData);
        } catch (err) {
            console.error('Error fetching from API Gateway:', err.message);
            if (err.response) {
                console.error('API Gateway error response:', {
                    status: err.response.status,
                    statusText: err.response.statusText,
                    data: err.response.data
                });
            }
            
            // Return empty results since we don't want S3 fallback
            const emptyResponse = {
                success: true,
                Items: [],
                source: 'apigateway_error',
                error: err.message
            };
            
            // Update cache with empty response
            userCache.data = emptyResponse;
            userCache.timestamp = Date.now();
            fileCache.isFetching[userId] = false;
            
            return res.json(emptyResponse);
        }
    } catch (err) {
        // Make sure to clear fetching flag
        if (req.session && req.session.userInfo) {
            const userId = req.session.userInfo.username || 'anonymous';
            fileCache.isFetching[userId] = false;
        } else {
            // Clear all fetching flags as fallback
            fileCache.isFetching = {};
        }
        
        console.error('Error in /api/files endpoint:', err);
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch files',
            message: err.message 
        });
    }
});

// Endpoint to get session information
router.get('/api/session', (req, res) => {
    try {
        console.log('Handling /api/session request');
        // Create a session for the user
        const sessionInfo = sessionService.createUploadSession(req);
        return res.json({ success: true, ...sessionInfo });
    } catch (error) {
        console.error('Error generating session ID:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to generate session ID',
            message: error.message 
        });
    }
});

// Endpoint to get files for current session - use shared cache if possible
router.get('/api/session/files', updateTokenInfo, async (req, res) => {
    try {
        console.log('Handling /api/session/files request');
        // Get current session info from user's session
        const sessionInfo = req.session.currentUploadSession;
        if (!sessionInfo) {
            return res.json({ success: true, files: [] });
        }
        
        const { username, sessionId } = sessionInfo;
        
        // Get user ID for cache lookup
        const userId = username || sessionService.getUsernameFromSession(req) || 'anonymous';
        
        // First check if we already have data in the files cache
        const userCache = getUserCache(userId);
        const now = Date.now();
        
        // If we have valid cached file data, use it to extract session files
        if (userCache.data && userCache.data.Items && (now - userCache.timestamp < fileCache.defaultTTL)) {
            console.log(`Using cached file data to get session files for session: ${sessionId}`);
            
            // Filter for just this session's files
            const sessionFiles = userCache.data.Items.filter(file => 
                file.sessionId === sessionId && file.fileName // Only include actual files
            );
            
            return res.json({
                success: true,
                files: sessionFiles,
                sessionInfo,
                source: 'file_cache',
                file_count: sessionFiles.length
            });
        }
        
        // If no valid cache, use API Gateway
        const accessToken = sessionService.getAccessToken(req);
        
        // Check if we are already fetching files data
        if (fileCache.isFetching[userId]) {
            console.log(`Already fetching files for ${userId}, waiting for cache to be populated`);
            
            // Wait a short time for the cache to be populated
            let attempts = 0;
            const maxAttempts = 5;
            
            const waitForCache = async () => {
                await new Promise(resolve => setTimeout(resolve, 300));
                
                if (userCache.data && userCache.data.Items && (Date.now() - userCache.timestamp < fileCache.defaultTTL)) {
                    // Cache was populated during our wait
                    const sessionFiles = userCache.data.Items.filter(file => 
                        file.sessionId === sessionId && file.fileName
                    );
                    
                    return res.json({
                        success: true,
                        files: sessionFiles,
                        sessionInfo,
                        source: 'file_cache_after_wait',
                        file_count: sessionFiles.length
                    });
                }
                
                attempts++;
                if (attempts < maxAttempts) {
                    return waitForCache();
                }
                
                // If we've waited too long, just make the API call
                console.log(`Waited too long for file cache, making direct API call for session ${sessionId}`);
                return null;
            };
            
            const cacheResult = await waitForCache();
            if (cacheResult) return; // If we got a result from the cache, we're done
        }
        
        // Make direct API call for session files
        try {
            console.log(`Making API Gateway call specifically for session ${sessionId}`);
            const apiResponse = await apiGatewayService.fetchFiles(accessToken);
            
            if (apiResponse.success && apiResponse.items && apiResponse.items.length > 0) {
                // Filter for current session
                const sessionFiles = apiGatewayService.filterSessionFiles(apiResponse.items, sessionId);
                
                // Format the files
                const formattedFiles = apiGatewayService.formatFiles(sessionFiles, sessionId);
                
                // No need to store in the session cache since we'll get a full file list soon
                
                return res.json({
                    success: true,
                    files: formattedFiles,
                    sessionInfo,
                    source: 'apigateway',
                    file_count: formattedFiles.length
                });
            }
            
            // If no files found, return empty array
            return res.json({
                success: true,
                files: [],
                sessionInfo,
                source: 'apigateway',
                file_count: 0
            });
        } catch (apiError) {
            console.error('Error fetching session files from API Gateway:', apiError);
            
            // Return empty results
            return res.json({
                success: true,
                files: [],
                sessionInfo,
                source: 'apigateway_error',
                error: apiError.message,
                file_count: 0
            });
        }
    } catch (error) {
        console.error('Error retrieving session files:', error);
        return res.status(500).json({ 
            success: false, 
            error: 'Failed to retrieve session files',
            message: error.message 
        });
    }
});

// Dashboard statistics endpoint
router.get('/api/dashboard/stats', updateTokenInfo, async (req, res) => {
    try {
        // Get user info from session
        const userInfo = sessionService.getUserFromSession(req);
        const username = userInfo.username;
        
        // Try to get files from API Gateway only, no S3 fallback
        const accessToken = sessionService.getAccessToken(req);
        try {
            const apiResponse = await apiGatewayService.fetchFiles(accessToken);
            
            // Process API response even if empty
            const files = apiResponse.success ? apiResponse.items || [] : [];
            
            // Calculate statistics
            const totalFiles = files.length;
            
            // Group files by session
            const sessions = {};
            files.forEach(file => {
                const sessionId = file.sessionId || 'unknown';
                if (!sessions[sessionId]) {
                    sessions[sessionId] = {
                        sessionId,
                        fileCount: 0,
                        totalSize: 0,
                        lastModified: null
                    };
                }
                
                sessions[sessionId].fileCount++;
                sessions[sessionId].totalSize += (file.fileSize || file.size || 0);
                
                // Update last modified date if newer
                const fileDate = new Date(file.uploadTimestamp || file.lastModified || Date.now());
                if (!sessions[sessionId].lastModified || 
                    fileDate > new Date(sessions[sessionId].lastModified)) {
                    sessions[sessionId].lastModified = fileDate.toISOString();
                }
            });
            
            // Convert sessions object to array and sort by last modified date
            const sessionsArray = Object.values(sessions).sort((a, b) => {
                return new Date(b.lastModified || 0) - new Date(a.lastModified || 0);
            });
            
            // Get recent activity (last 5 uploads)
            const recentFiles = files
                .sort((a, b) => {
                    const dateA = new Date(a.uploadTimestamp || a.lastModified || 0);
                    const dateB = new Date(b.uploadTimestamp || b.lastModified || 0);
                    return dateB - dateA;
                })
                .slice(0, 5)
                .map(file => ({
                    fileName: file.fileName || file.key?.split('/').pop() || 'Unnamed File',
                    sessionId: file.sessionId || 'unknown',
                    fileSize: file.fileSize || file.size || 0,
                    lastModified: file.uploadTimestamp || file.lastModified || new Date().toISOString(),
                    s3Key: file.s3Key || file.key || ''
                }));
            
            res.json({
                success: true,
                stats: {
                    totalFiles,
                    totalSessions: Object.keys(sessions).length,
                    recentSessions: sessionsArray.slice(0, 5),
                    recentFiles
                },
                source: 'apigateway'
            });
        } catch (apiError) {
            console.error('Error fetching from API Gateway for dashboard:', apiError);
            
            // Return empty stats instead of falling back to S3
            res.json({
                success: true,
                stats: {
                    totalFiles: 0,
                    totalSessions: 0,
                    recentSessions: [],
                    recentFiles: []
                },
                source: 'apigateway',
                error: apiError.message
            });
        }
    } catch (error) {
        console.error('Error retrieving dashboard statistics:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to retrieve dashboard statistics',
            message: error.message 
        });
    }
});

// API test endpoint for debugging route issues
router.get('/api/test', (req, res) => {
    console.log('API test endpoint reached');
    res.json({ 
        success: true, 
        message: 'API test endpoint is working',
        path: req.originalUrl,
        session: req.session ? 'Available' : 'Not available',
        authenticated: req.session && req.session.isAuthenticated ? 'Yes' : 'No'
    });
});

// Delete file by ID endpoint
router.delete('/api/files/:fileKey(*)', updateTokenInfo, async (req, res) => {
    try {
        // Get the full file key from the URL parameter (potentially containing slashes)
        const fileKey = req.params.fileKey;
        
        if (!fileKey) {
            return res.status(400).json({ success: false, error: 'No file key provided' });
        }
        
        console.log(`Attempting to delete file with key: ${fileKey}`);
        
        // Get user info from session
        const username = sessionService.getUsernameFromSession(req);
        
        // Security check: Ensure the file belongs to the authenticated user
        if (!fileKey.startsWith(`${username}/`)) {
            console.error(`Access denied: User ${username} attempted to delete file ${fileKey}`);
            return res.status(403).json({ 
                success: false, 
                error: 'Access denied',
                message: 'You do not have permission to delete this file'
            });
        }
        
        // Delete the file directly from S3
        try {
            const params = {
                Bucket: BUCKET_NAME,
                Key: fileKey
            };
            await s3.deleteObject(params).promise();
            console.log(`Successfully deleted file with S3 key: ${fileKey}`);
            
            // Clear all caches when a file is deleted
            clearAllCaches();
            
            // Check if the file was in a session folder
            const sessionMatch = fileKey.match(/^([^\/]+)\/([^\/]+)\/[^\/]+$/);
            if (sessionMatch && sessionMatch[2] && sessionMatch[2].startsWith('session-')) {
                const username = sessionMatch[1];
                const sessionId = sessionMatch[2];
                const sessionPrefix = `${username}/${sessionId}/`;
                
                console.log(`Checking if session folder ${sessionPrefix} is empty after file deletion`);
                
                // List objects in the session folder
                const listParams = {
                    Bucket: BUCKET_NAME,
                    Prefix: sessionPrefix,
                    MaxKeys: 2 // Only need to check if there's at least one file left
                };
                
                const sessionObjects = await s3.listObjectsV2(listParams).promise();
                
                // If the folder is empty or only contains the folder object itself, delete the folder
                if (!sessionObjects.Contents || 
                    sessionObjects.Contents.length === 0 || 
                    (sessionObjects.Contents.length === 1 && sessionObjects.Contents[0].Key === sessionPrefix)) {
                    
                    console.log(`Session folder ${sessionPrefix} is empty, deleting it`);
                    
                    // Delete the folder object
                    const folderParams = {
                        Bucket: BUCKET_NAME,
                        Key: sessionPrefix
                    };
                    
                    await s3.deleteObject(folderParams).promise();
                    console.log(`Successfully deleted empty session folder: ${sessionPrefix}`);
                } else {
                    console.log(`Session folder ${sessionPrefix} still contains files, not deleting`);
                }
            }
            
            return res.json({
                success: true,
                message: 'File deleted successfully',
                source: 's3'
            });
        } catch (error) {
            console.error(`Error deleting file ${fileKey} from S3:`, error);
            return res.status(500).json({ 
                success: false, 
                error: 'Failed to delete file from S3',
                message: error.message 
            });
        }
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete file',
            message: error.message 
        });
    }
});

// Process folder endpoint
router.post('/processfolder', updateTokenInfo, async (req, res) => {
    try {
        console.log('Processing folder request received:', req.body);
        const { folderName, sessionId } = req.body;
        
        if (!folderName) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameter: folderName'
            });
        }
        
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required parameter: sessionId'
            });
        }
        
        // Get user info from session
        const userInfo = sessionService.getUserFromSession(req);
        const username = userInfo.username || sessionService.getUsernameFromSession(req) || 'anonymous';
        
        // Get access token
        const accessToken = sessionService.getAccessToken(req);
        if (!accessToken) {
            return res.status(401).json({
                success: false,
                error: 'No access token available'
            });
        }
        
        // Create folderId in the expected format "sessionId/folderName"
        const folderId = `${sessionId}/${folderName}`;
        
        // Call API Gateway to process the folder
        try {
            console.log(`Calling API Gateway to process folder: ${folderName} for user: ${username}, session: ${sessionId}, folderId: ${folderId}`);
            
            // Make API request to API Gateway with the correct parameter format
            const processResponse = await axios.post(
                'https://isw1w2sh3i.execute-api.us-east-1.amazonaws.com/processfolder',
                {
                    folderId
                },
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            console.log('API Gateway process response:', processResponse.data);
            
            // Clear all caches to ensure fresh data after processing
            clearAllCaches();
            
            return res.json({
                success: true,
                message: 'Folder processing initiated successfully',
                data: processResponse.data
            });
        } catch (apiError) {
            console.error('Error calling API Gateway to process folder:', apiError);
            
            // Format error response
            const errorResponse = {
                success: false,
                error: 'Failed to process folder via API Gateway',
                message: apiError.message
            };
            
            // Include response data if available
            if (apiError.response) {
                errorResponse.statusCode = apiError.response.status;
                errorResponse.apiResponse = apiError.response.data;
            }
            
            return res.status(apiError.response?.status || 500).json(errorResponse);
        }
    } catch (error) {
        console.error('Error in process folder endpoint:', error);
        return res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
});

// Alias for the root route to maintain backwards compatibility with /files path
router.get('/files', async (req, res) => {
    // Just forward to the root handler
    req.url = '/';
    router.handle(req, res);
});

module.exports = router; 