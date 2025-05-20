import axios from 'axios';
import eventService, { FILE_EVENTS } from './eventService';
import apiCache from './apiCache';

// Add the FILES_DATA_UPDATED event to the event types
if (!FILE_EVENTS.FILES_DATA_UPDATED) {
  FILE_EVENTS.FILES_DATA_UPDATED = 'files_data_updated';
}

// FileDataService: Centralizes file data fetching and caching
class FileDataService {
  constructor() {
    this.isFetching = false;
    this.lastFetchTime = 0;
    this.fetchPromise = null;
    this.REFRESH_COOLDOWN = 5000; // 5 seconds minimum between refreshes
    
    // Subscribe to events requiring a refresh
    eventService.subscribe(FILE_EVENTS.FILES_UPLOADED, () => this.scheduleRefresh());
    eventService.subscribe(FILE_EVENTS.FILES_DELETED, () => this.scheduleRefresh());
    eventService.subscribe(FILE_EVENTS.REFRESH_FILES, () => this.forceRefresh());
  }

  // Schedule a refresh with debounce
  scheduleRefresh() {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }
    
    this.refreshTimeout = setTimeout(() => {
      this.fetchFileData();
    }, 2000); // 2 second debounce
  }

  // Force an immediate refresh
  forceRefresh() {
    // Clear cache
    apiCache.invalidate('http://localhost:3001/api/files');
    
    // Fetch fresh data
    return this.fetchFileData(true);
  }

  // Main method to fetch file data
  async fetchFileData(forceRefresh = false) {
    const now = Date.now();
    
    // If we're already fetching, return the existing promise
    if (this.isFetching && this.fetchPromise) {
      return this.fetchPromise;
    }
    
    // Check if we should use cached data (unless force refresh)
    if (!forceRefresh && now - this.lastFetchTime < this.REFRESH_COOLDOWN) {
      const cachedData = apiCache.getFromLocalCache('http://localhost:3001/api/files');
      if (cachedData) {
        return Promise.resolve(cachedData);
      }
    }
    
    // Start a new fetch
    this.isFetching = true;
    
    // Create and store the fetch promise
    this.fetchPromise = axios.get('http://localhost:3001/api/files', {
      withCredentials: true // Include credentials to send cookies
    })
    .then(response => {
      // Update last fetch time
      this.lastFetchTime = Date.now();
      
      // Broadcast that new file data is available
      eventService.publish(FILE_EVENTS.FILES_DATA_UPDATED, {
        data: response.data,
        timestamp: this.lastFetchTime
      });
      
      return response.data;
    })
    .catch(error => {
      console.error('Error fetching file data:', error);
      throw error;
    })
    .finally(() => {
      this.isFetching = false;
      this.fetchPromise = null;
    });
    
    return this.fetchPromise;
  }
  
  // Get session files
  async getSessionFiles(sessionId) {
    try {
      // Try to use the main file data if available
      const fileData = await this.fetchFileData();
      
      if (fileData && fileData.Items && fileData.Items.length) {
        // Filter for the requested session
        return fileData.Items.filter(file => 
          file.sessionId === sessionId
        );
      }
      
      // Fallback to specific session files API
      return axios.get('http://localhost:3001/api/session/files', {
        withCredentials: true
      })
      .then(response => {
        if (response.data && response.data.files) {
          return response.data.files;
        }
        return [];
      });
    } catch (error) {
      console.error('Error getting session files:', error);
      return [];
    }
  }
  
  // Get dashboard stats - uses the same underlying data when possible
  async getDashboardStats() {
    try {
      // Try to calculate stats from existing file data first
      const fileData = await this.fetchFileData();
      
      if (fileData && fileData.Items && fileData.Items.length) {
        // Calculate stats locally
        const files = fileData.Items;
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
        
        // Convert to array and sort
        const sessionsArray = Object.values(sessions).sort((a, b) => {
          return new Date(b.lastModified || 0) - new Date(a.lastModified || 0);
        });
        
        // Recent files (last 5)
        const recentFiles = [...files]
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
            lastModified: file.uploadTimestamp || file.lastModified,
            s3Key: file.s3Key || file.key || ''
          }));
          
        return {
          totalFiles: files.length,
          totalSessions: Object.keys(sessions).length,
          recentSessions: sessionsArray.slice(0, 5),
          recentFiles
        };
      }
      
      // Fallback to specific dashboard stats API
      return axios.get('http://localhost:3001/api/dashboard/stats', {
        withCredentials: true
      })
      .then(response => {
        if (response.data && response.data.stats) {
          return response.data.stats;
        }
        return {
          totalFiles: 0,
          totalSessions: 0,
          recentSessions: [],
          recentFiles: []
        };
      });
    } catch (error) {
      console.error('Error getting dashboard stats:', error);
      return {
        totalFiles: 0,
        totalSessions: 0,
        recentSessions: [],
        recentFiles: []
      };
    }
  }
}

// Create singleton instance
const fileDataService = new FileDataService();

export default fileDataService; 