const { s3, BUCKET_NAME } = require('../config/aws');

// Function to create a folder for a new user in S3
async function createUserFolder(username) {
    try {
        // Use the actual username without transforming email
        const folderName = username;
        
        // In S3, folders are actually objects with a key ending in '/'
        const params = {
            Bucket: BUCKET_NAME,
            Key: `${folderName}/`,
            Body: '' // Empty body as it's just a folder
        };
        
        const result = await s3.putObject(params).promise();
        console.log(`Created folder for user ${folderName} in S3 bucket`);
        return result;
    } catch (error) {
        console.error(`Error creating folder for user ${username}:`, error);
        throw error;
    }
}

// Function to check if a user folder already exists
async function checkUserFolderExists(username) {
    try {
        // Use the actual username without transforming email
        const folderName = username;
        
        const params = {
            Bucket: BUCKET_NAME,
            Prefix: `${folderName}/`,
            MaxKeys: 1
        };
        
        const data = await s3.listObjectsV2(params).promise();
        return data.Contents && data.Contents.length > 0;
    } catch (error) {
        console.error(`Error checking if folder exists for user ${username}:`, error);
        throw error;
    }
}

// Function to list files in a user's folder
async function listUserFiles(username) {
    try {
        if (!username || username === 'anonymous') {
            console.log('Anonymous or invalid username provided for S3 file listing');
            return [];
        }
        
        console.log(`Listing S3 files for user: ${username}`);
        
        const params = {
            Bucket: BUCKET_NAME,
            Prefix: `${username}/`
        };
        
        console.log(`S3 listObjectsV2 params: Bucket=${BUCKET_NAME}, Prefix=${username}/`);
        
        const s3Result = await s3.listObjectsV2(params).promise();
        
        console.log(`S3 listObjectsV2 found ${s3Result.Contents ? s3Result.Contents.length : 0} objects`);
        
        // Transform S3 objects to match desired format
        const transformedItems = s3Result.Contents ? s3Result.Contents.map(item => {
            // Extract fileName from the key (remove the prefix)
            const fileName = item.Key.replace(`${username}/`, '');
            const sessionId = fileName.includes('/') ? fileName.split('/')[0] : 'default';
            
            return {
                userId: username,
                fileName: fileName,
                sessionId: sessionId,
                s3Bucket: BUCKET_NAME,
                s3Key: item.Key,
                uploadTimestamp: item.LastModified.toISOString(),
                fileSize: item.Size,
                status: 'unprocessed'
            };
        }).filter(item => item.fileSize > 0) : []; // Filter out folder objects
        
        console.log(`Returning ${transformedItems.length} transformed file items`);
        
        return transformedItems;
    } catch (error) {
        console.error(`Error listing files for user ${username}:`, error);
        // Return empty array instead of throwing to make the API more resilient
        return [];
    }
}

// Function to list files in a specific session
async function listSessionFiles(username, sessionId) {
    try {
        const params = {
            Bucket: BUCKET_NAME,
            Prefix: `${username}/${sessionId}/`
        };
        
        const s3Result = await s3.listObjectsV2(params).promise();
        
        // Transform S3 objects to the format expected by frontend
        const files = s3Result.Contents ? s3Result.Contents
            .filter(item => item.Size > 0) // Filter out folder objects
            .map(item => {
                const fileName = item.Key.split('/').pop();
                return {
                    fileName,
                    fileSize: item.Size,
                    uploadedAt: item.LastModified.toISOString(),
                    s3Key: item.Key,
                    s3Url: `https://${BUCKET_NAME}.s3.amazonaws.com/${item.Key}`,
                    contentType: '', // S3 doesn't return content type in listObjectsV2
                    sessionId
                };
            }) : [];
        
        return files;
    } catch (error) {
        console.error(`Error listing session files for user ${username}, session ${sessionId}:`, error);
        throw error;
    }
}

// Function to delete a file from S3
async function deleteFile(key) {
    try {
        const params = {
            Bucket: BUCKET_NAME,
            Key: key
        };
        
        await s3.deleteObject(params).promise();
        return true;
    } catch (error) {
        console.error(`Error deleting file ${key}:`, error);
        throw error;
    }
}

module.exports = {
    createUserFolder,
    checkUserFolderExists,
    listUserFiles,
    listSessionFiles,
    deleteFile,
    BUCKET_NAME
}; 