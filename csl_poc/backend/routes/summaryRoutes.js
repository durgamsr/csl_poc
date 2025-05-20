const express = require('express');
const router = express.Router();
const AWS = require('aws-sdk');
const axios = require('axios');

// Configure AWS
const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

// Simple in-memory cache
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Helper function to get cached data
const getCachedData = (key) => {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  return null;
};

// Helper function to set cached data
const setCachedData = (key, data) => {
  cache.set(key, {
    data,
    timestamp: Date.now()
  });
};

// Helper function to fetch processed folders from API Gateway
const getProcessedFoldersFromAPI = async (req, username, sessionId) => {
  try {
    const cacheKey = `apiFolders:${username}:${sessionId}`;
    
    // Check request-level cache first to prevent duplicate API calls within the same request
    if (req.apiResponseCache && req.apiResponseCache[cacheKey]) {
      console.log('Using request-level cache for API folders');
      return req.apiResponseCache[cacheKey];
    }
    
    // Check global cache
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
      console.log('Using global cache for API folders');
      return cachedData;
    }
    
    console.log(`Fetching processed folders from API: username=${username}, sessionId=${sessionId}`);
    
    // Get access token from the request session if available
    const accessToken = req.session?.tokenSet?.access_token;
    
    // Configure headers
    const headers = {};
    if (accessToken) {
      headers['Authorization'] = `Bearer ${accessToken}`;
    }
    
    // Make request to API Gateway
    const apiUrl = 'https://isw1w2sh3i.execute-api.us-east-1.amazonaws.com/myfiles';
    const response = await axios.get(apiUrl, { headers });
    
    console.log('API Gateway response status:', response.status);
    
    if (!response.data || !response.data.folderMetadata) {
      console.log('No folder metadata found in API response');
      return [];
    }
    
    // Extract folder information from folderMetadata
    const folders = response.data.folderMetadata
      .filter(folder => folder.overallStatus === 'folder_summarized')
      .map(folder => {
        // Extract folder name
        const pathParts = folder.folderName.split('/');
        const folderName = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];
        
        return {
          name: folderName,
          path: folder.summaryS3Key,
          summaryKey: folder.summaryS3Key,
          processed: true,
          lastUpdated: folder.lastUpdatedAt
        };
      });
    
    console.log('Found processed folders from API:', folders);
    
    // Store in both caches
    setCachedData(cacheKey, folders);
    
    // Initialize request-level cache if it doesn't exist
    if (!req.apiResponseCache) {
      req.apiResponseCache = {};
    }
    req.apiResponseCache[cacheKey] = folders;
    
    return folders;
  } catch (error) {
    console.error('Error fetching folders from API:', error);
    throw error;
  }
};

// Middleware to add request-level cache
router.use((req, res, next) => {
  req.apiResponseCache = {};
  next();
});

// Helper function to fetch summary from S3
const fetchSummaryFromS3 = async (username, sessionId, folderName, summaryKey) => {
  try {
    // If we have a direct summary key path, use it
    if (summaryKey) {
      console.log(`Fetching summary directly from key: ${summaryKey}`);
      const params = {
        Bucket: 'ragbucket0',
        Key: summaryKey
      };
      
      const data = await s3.getObject(params).promise();
      const summaries = JSON.parse(data.Body.toString());
      console.log('Successfully retrieved summaries from direct key');
      return summaries;
    }
    
    // Otherwise, search for the summary file
    let prefix;
    
    if (folderName) {
      // If folder name is provided, look specifically in that folder
      prefix = `folder-summaries/${username}/${sessionId}/${folderName}/`;
    } else {
      // If no folder is specified, look in the session directory
      prefix = `folder-summaries/${username}/${sessionId}/`;
    }

    // List all objects in the specified directory
    const listParams = {
      Bucket: 'ragbucket0',
      Prefix: prefix
    };

    console.log('Searching for summary files with params:', listParams);
    const listData = await s3.listObjectsV2(listParams).promise();
    
    if (!listData.Contents || listData.Contents.length === 0) {
      console.log('No files found in directory:', listParams.Prefix);
      return null;
    }

    // Find all JSON files in the directory
    const jsonFiles = listData.Contents.filter(item => item.Key.endsWith('.json'));

    if (jsonFiles.length === 0) {
      console.log('No JSON files found in directory:', listParams.Prefix);
      return null;
    }

    // Sort by LastModified to get the most recent JSON file
    jsonFiles.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));
    const latestJsonFile = jsonFiles[0];

    console.log('Found summary file:', latestJsonFile.Key);

    // Get the content of the most recent summary file
    const params = {
      Bucket: 'ragbucket0',
      Key: latestJsonFile.Key
    };

    const data = await s3.getObject(params).promise();
    const summaries = JSON.parse(data.Body.toString());
    
    console.log('Successfully retrieved summaries from:', latestJsonFile.Key);
    return summaries;
  } catch (error) {
    console.error('Error in fetchSummaryFromS3:', error);
    throw error;
  }
};

// Get all folders for a session from API
router.get('/:sessionId/folders', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const username = req.session?.username || 'sri_ganesh';
    const cacheKey = `folders:${username}:${sessionId}`;

    // Check cache first
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
      console.log('Returning cached folders for session:', sessionId);
      return res.json({
        success: true,
        folders: cachedData
      });
    }

    // Get processed folders from API Gateway
    const folders = await getProcessedFoldersFromAPI(req, username, sessionId);
    
    // Cache the result
    setCachedData(cacheKey, folders);

    res.json({
      success: true,
      folders
    });
  } catch (error) {
    console.error('Error listing folders from API:', error);
    
    // If the API fails, try to use S3 as fallback
    try {
      const { sessionId } = req.params;
      const username = req.session?.username || 'sri_ganesh';
      
      // Use S3 to find folders
      const listParams = {
        Bucket: 'ragbucket0',
        Prefix: `folder-summaries/${username}/${sessionId}/`,
        Delimiter: '/'
      };
      
      console.log('Falling back to S3 for listing folders');
      const data = await s3.listObjectsV2(listParams).promise();
      
      // Extract folder names from CommonPrefixes
      const folders = data.CommonPrefixes
        ? data.CommonPrefixes.map(prefix => {
            const path = prefix.Prefix;
            const pathParts = path.split('/');
            const folderName = pathParts[pathParts.length - 2]; 
            return { 
              name: folderName, 
              path,
              processed: true
            };
          })
        : [];
      
      return res.json({
        success: true,
        folders
      });
    } catch (s3Error) {
      console.error('Error in S3 fallback:', s3Error);
      res.status(500).json({
        success: false,
        message: 'Error listing folders'
      });
    }
  }
});

// Get summaries for a specific folder in a session
router.get('/:sessionId/folder/:folderName', async (req, res) => {
  try {
    const { sessionId, folderName } = req.params;
    const username = req.session?.username || 'sri_ganesh';
    const cacheKey = `summary:${username}:${sessionId}:${folderName}`;

    console.log(`Fetching summaries for session: ${sessionId}, folder: ${folderName}`);

    // Check cache first
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
      console.log('Returning cached data for session/folder:', sessionId, folderName);
      return res.json({
        success: true,
        summaries: cachedData
      });
    }

    // Check if we already have folders data in request cache
    let folder = null;
    if (req.apiResponseCache) {
      const foldersCacheKey = `apiFolders:${username}:${sessionId}`;
      const folders = req.apiResponseCache[foldersCacheKey];
      if (folders) {
        console.log('Using request-cached folders data');
        folder = folders.find(f => f.name === folderName);
      }
    }
    
    // If not found in request cache, fetch from API
    if (!folder) {
      const folders = await getProcessedFoldersFromAPI(req, username, sessionId);
      folder = folders.find(f => f.name === folderName);
    }
    
    // Fetch summary from S3 using the summary key if available
    const summaries = await fetchSummaryFromS3(
      username, 
      sessionId, 
      folderName, 
      folder ? folder.summaryKey : null
    );
    
    if (!summaries) {
      return res.status(404).json({
        success: false,
        message: `No summary file found for folder "${folderName}" in session "${sessionId}"`
      });
    }

    // Cache the result
    setCachedData(cacheKey, summaries);

    res.json({
      success: true,
      summaries
    });
  } catch (error) {
    console.error('Error fetching summaries for folder:', error);
    
    if (error.code === 'NoSuchKey') {
      return res.status(404).json({
        success: false,
        message: `No summary file found for the specified folder`
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error fetching summaries from S3'
    });
  }
});

// Get summaries for a session (any folder)
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const username = req.session?.username || 'sri_ganesh';
    const cacheKey = `summary:${username}:${sessionId}`;

    console.log('Fetching summaries for session:', sessionId);

    // Check cache first
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
      console.log('Returning cached data for session:', sessionId);
      return res.json({
        success: true,
        summaries: cachedData
      });
    }

    // Get processed folders from API
    const folders = await getProcessedFoldersFromAPI(req, username, sessionId);
    
    // If we have folders with summaries, use the first one
    if (folders.length > 0) {
      const folder = folders[0];
      console.log(`Using first folder found: ${folder.name}`);
      
      // Fetch summaries from this folder using the summaryKey
      const summaries = await fetchSummaryFromS3(username, sessionId, folder.name, folder.summaryKey);
      
      if (summaries) {
        // Cache the result
        setCachedData(cacheKey, summaries);
        
        return res.json({
          success: true,
          summaries
        });
      }
    }
    
    // If no folders with summaries were found, try S3 directory
    const summaries = await fetchSummaryFromS3(username, sessionId);
    
    if (!summaries) {
      return res.status(404).json({
        success: false,
        message: 'No summary file found for this session'
      });
    }

    // Cache the result
    setCachedData(cacheKey, summaries);

    res.json({
      success: true,
      summaries
    });
  } catch (error) {
    console.error('Error fetching summaries:', error);
    
    if (error.code === 'NoSuchKey') {
      return res.status(404).json({
        success: false,
        message: 'No summary file found for this session'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error fetching summaries from S3'
    });
  }
});

// Refresh summaries for a session
router.post('/:sessionId/refresh', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { folderName } = req.body; // Optional folder name parameter
    const username = req.session?.username || 'sri_ganesh';
    
    // Clear all caches related to this session
    const sessionCacheKey = `summary:${username}:${sessionId}`;
    const foldersCacheKey = `folders:${username}:${sessionId}`;
    
    cache.delete(sessionCacheKey);
    cache.delete(foldersCacheKey);
    
    if (folderName) {
      const folderCacheKey = `summary:${username}:${sessionId}:${folderName}`;
      cache.delete(folderCacheKey);
    }

    // Get updated folder data from API
    const folders = await getProcessedFoldersFromAPI(req, username, sessionId);
    let summaryKey = null;
    
    // Find the folder if specified
    if (folderName) {
      const folder = folders.find(f => f.name === folderName);
      if (folder) {
        summaryKey = folder.summaryKey;
      }
    } else if (folders.length > 0) {
      // Use first folder if none specified
      summaryKey = folders[0].summaryKey;
    }

    // Fetch fresh summaries
    const summaries = await fetchSummaryFromS3(
      username, 
      sessionId, 
      folderName, 
      summaryKey
    );
    
    if (!summaries) {
      return res.status(404).json({
        success: false,
        message: 'No summary file found for the specified session/folder'
      });
    }

    res.json({
      success: true,
      summaries
    });
  } catch (error) {
    console.error('Error refreshing summaries:', error);
    
    if (error.code === 'NoSuchKey') {
      return res.status(404).json({
        success: false,
        message: 'No summary file found for the specified session/folder'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error refreshing summaries from S3'
    });
  }
});

// List all user sessions
router.get('/sessions', async (req, res) => {
  try {
    const username = req.session?.username || 'sri_ganesh';
    const cacheKey = `sessions:${username}`;

    // Check cache first
    const cachedData = getCachedData(cacheKey);
    if (cachedData) {
      console.log('Returning cached sessions for user:', username);
      return res.json({
        success: true,
        sessions: cachedData
      });
    }

    // First try to get sessions from API Gateway
    try {
      // Get access token from the request session if available
      const accessToken = req.session?.tokenSet?.access_token;
      
      // Configure headers
      const headers = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
      
      // Make request to API Gateway
      const apiUrl = 'https://isw1w2sh3i.execute-api.us-east-1.amazonaws.com/myfiles';
      const response = await axios.get(apiUrl, { headers });
      
      if (response.data && response.data.folderMetadata) {
        // Extract unique session IDs
        const sessionsMap = new Map();
        response.data.folderMetadata.forEach(folder => {
          if (folder.folderName) {
            const sessionId = folder.folderName.split('/')[0];
            if (sessionId && !sessionsMap.has(sessionId)) {
              sessionsMap.set(sessionId, {
                id: sessionId,
                lastUpdated: folder.lastUpdatedAt || ''
              });
            }
          }
        });
        
        const sessions = Array.from(sessionsMap.values());
        
        // Sort by lastUpdated (most recent first)
        sessions.sort((a, b) => {
          if (!a.lastUpdated) return 1;
          if (!b.lastUpdated) return -1;
          return new Date(b.lastUpdated) - new Date(a.lastUpdated);
        });
        
        // Cache the result
        setCachedData(cacheKey, sessions);
        
        return res.json({
          success: true,
          sessions
        });
      }
    } catch (apiError) {
      console.error('Error fetching sessions from API:', apiError);
      // Continue to S3 fallback
    }
    
    // Fallback to S3
    const listParams = {
      Bucket: 'ragbucket0',
      Prefix: `folder-summaries/${username}/`,
      Delimiter: '/'
    };
    
    const data = await s3.listObjectsV2(listParams).promise();
    
    // Extract session IDs from CommonPrefixes
    const sessions = data.CommonPrefixes
      ? data.CommonPrefixes.map(prefix => {
          const path = prefix.Prefix;
          const pathParts = path.split('/');
          const sessionId = pathParts[pathParts.length - 2];
          return { 
            id: sessionId,
            path
          };
        })
      : [];
    
    // Cache the result
    setCachedData(cacheKey, sessions);
    
    res.json({
      success: true,
      sessions
    });
  } catch (error) {
    console.error('Error listing sessions:', error);
    res.status(500).json({
      success: false,
      message: 'Error listing sessions'
    });
  }
});

module.exports = router; 