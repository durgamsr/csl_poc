const axios = require('axios');
const config = require('../config');

// Get API Gateway endpoint from config
const API_GATEWAY_ENDPOINT = config.aws.apiGateway.endpoint;

console.log(`Using API Gateway endpoint: ${API_GATEWAY_ENDPOINT}`);

// Function to fetch files from API Gateway
async function fetchFiles(accessToken, userInfo = null, includeFolders = false) {
    try {
        // Set up headers
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        
        // Include token if available
        if (accessToken && typeof accessToken === 'string') {
            headers['Authorization'] = `Bearer ${accessToken}`;
            console.log('Including access token in API Gateway request');
            
            // Try to extract user info from token to add as fallback header
            try {
                const tokenParts = accessToken.split('.');
                if (tokenParts.length === 3) {
                    const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
                    
                    if (payload.sub) headers['x-user-sub'] = payload.sub;
                    if (payload['cognito:username']) headers['x-user-cognito-username'] = payload['cognito:username'];
                    if (payload.username) headers['x-user-username'] = payload.username;
                    if (payload.email) headers['x-user-email'] = payload.email;
                }
            } catch (tokenDecodeError) {
                console.error('Error decoding token for user headers:', tokenDecodeError);
            }
        } else {
            console.log('No valid access token available for API Gateway request');
            return { success: false, items: [], message: 'No access token available' };
        }
        
        // Add user info from session if available
        if (userInfo) {
            if (userInfo.username) headers['x-user-info-username'] = userInfo.username;
            if (userInfo.email) headers['x-user-info-email'] = userInfo.email;
            if (userInfo.sub) headers['x-user-info-sub'] = userInfo.sub;
        }
        
        console.log(`Making request to API Gateway endpoint: ${API_GATEWAY_ENDPOINT}`);
        
        // Make the API call
        const response = await axios.get(API_GATEWAY_ENDPOINT, { 
            headers,
            timeout: 10000 // 10 second timeout
        });
        
        console.log(`API Gateway response status: ${response.status}`);
        console.log('Full raw API Gateway response data:', JSON.stringify(response.data, null, 2));
        
        let items = [];
        
        // Extract items from the response
        if (response.data && Array.isArray(response.data.files)) {
            items = response.data.files;
            console.log(`Found ${items.length} items in API Gateway response`);
        }
        
        // Filter out folder placeholders if required
        const filteredItems = items.filter(item => {
            const isFolder = item.fileName === '' || item.fileName.trim() === '' || item.originalS3Key.endsWith('/');
            return includeFolders ? true : !isFolder;
        });
        
        console.log(`Filtered out ${items.length - filteredItems.length} items with empty file names`);
        console.log(`Returning ${filteredItems.length} valid items`);
        
        return { success: true, items: filteredItems };
    } catch (error) {
        console.error('Error fetching from API Gateway:', error.message);
        if (error.response) {
            console.error('API Gateway error response:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });
        } else if (error.request) {
            console.error('API Gateway no response received:', error.request);
        }
        
        return { success: false, items: [], error: error.message };
    }
}

// Function to filter files for a specific session
function filterSessionFiles(files, sessionId) {
    return files.filter(file => {
        return (file.sessionId === sessionId) || 
               (file.s3Key && file.s3Key.includes(`/${sessionId}/`)) ||
               (file.key && file.key.includes(`/${sessionId}/`));
    });
}

// Function to format files consistently
function formatFiles(files, sessionId = null) {
    return files.map(file => ({
        fileName: file.fileName || file.key?.split('/').pop() || 'Unnamed File',
        fileSize: file.fileSize || file.size || 0,
        uploadedAt: file.uploadTimestamp || file.lastModified || new Date().toISOString(),
        s3Key: file.originalS3Key || file.s3Key || file.key || '',
        s3Url: file.s3Url || (file.s3Bucket && file.originalS3Key ? 
            `https://${file.s3Bucket}.s3.amazonaws.com/${file.originalS3Key}` : ''),
        contentType: file.contentType || '',
        sessionId: file.sessionId || sessionId || 'unknown',
        isFolder: file.originalS3Key.endsWith('/'),
    }));
}

// Function to delete a file through the API Gateway
async function deleteFile(fileId, accessToken) {
    try {
        if (!accessToken || typeof accessToken !== 'string') {
            console.log('No valid access token available for API Gateway delete request');
            return { success: false, message: 'No access token available' };
        }

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        };
        
        console.log(`Making delete request to API Gateway for file: ${fileId}`);
        
        const response = await axios.delete(`${API_GATEWAY_ENDPOINT}/${fileId}`, { 
            headers,
            timeout: 10000 // 10 second timeout
        });
        
        console.log(`API Gateway delete response status: ${response.status}`);
        
        if (response.status >= 200 && response.status < 300) {
            return { success: true, message: 'File deleted successfully' };
        } else {
            return { success: false, message: 'Failed to delete file' };
        }
    } catch (error) {
        console.error('Error deleting file through API Gateway:', error.message);
        if (error.response) {
            console.error('API Gateway error response:', {
                status: error.response.status,
                statusText: error.response.statusText,
                data: error.response.data
            });
        } else if (error.request) {
            console.error('API Gateway no response received:', error.request);
        }
        
        return { success: false, error: error.message };
    }
}

module.exports = {
    fetchFiles,
    filterSessionFiles,
    formatFiles,
    deleteFile,
    API_GATEWAY_ENDPOINT
};
