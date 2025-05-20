import axios from 'axios';

class ApiCache {
  constructor() {
    this.cache = {};
    this.inProgressRequests = {};
    this.defaultTTL = 5 * 60 * 1000; // 5 minutes default TTL
    
    // Initialize from localStorage if available
    this.initFromLocalStorage();
    
    // Setup interval to clean expired cache entries
    setInterval(() => this.cleanExpiredEntries(), 60 * 1000); // Clean every minute
  }
  
  // Initialize cache from localStorage
  initFromLocalStorage() {
    try {
      const storedCache = localStorage.getItem('apiCache');
      if (storedCache) {
        const parsedCache = JSON.parse(storedCache);
        
        // Only keep unexpired entries
        const now = Date.now();
        Object.keys(parsedCache).forEach(key => {
          if (parsedCache[key] && parsedCache[key].expires > now) {
            this.cache[key] = parsedCache[key];
          }
        });
        
        console.log(`Restored ${Object.keys(this.cache).length} cache entries from localStorage`);
      }
    } catch (e) {
      console.error('Error initializing cache from localStorage:', e);
      // Reset the cache if there was an error
      this.cache = {};
      localStorage.removeItem('apiCache');
    }
  }
  
  // Save cache to localStorage
  saveToLocalStorage() {
    try {
      // Filter out data that's too large before saving to localStorage
      const cacheCopy = {};
      Object.keys(this.cache).forEach(key => {
        const entry = { ...this.cache[key] };
        // Estimate the size - skip if data is too large
        const dataSize = JSON.stringify(entry.data).length;
        if (dataSize < 100000) { // Only store cache entries smaller than ~100KB
          cacheCopy[key] = entry;
        }
      });
      
      localStorage.setItem('apiCache', JSON.stringify(cacheCopy));
    } catch (e) {
      console.error('Error saving cache to localStorage:', e);
    }
  }
  
  // Clean expired entries
  cleanExpiredEntries() {
    const now = Date.now();
    let cleanedCount = 0;
    
    Object.keys(this.cache).forEach(key => {
      if (this.cache[key].expires <= now) {
        delete this.cache[key];
        cleanedCount++;
      }
    });
    
    if (cleanedCount > 0) {
      console.log(`Cleaned ${cleanedCount} expired cache entries`);
      this.saveToLocalStorage();
    }
  }
  
  // Get data from local cache without making API call
  getFromLocalCache(url) {
    const cacheKey = this.getCacheKey(url);
    const now = Date.now();
    
    if (this.cache[cacheKey] && this.cache[cacheKey].expires > now) {
      console.log(`Cache hit for ${url} (${Math.round((now - this.cache[cacheKey].timestamp)/1000)}s old)`);
      return this.cache[cacheKey].data;
    }
    
    console.log(`Cache miss for ${url}`);
    return null;
  }

  // Get data from cache or fetch it
  async get(url, options = {}) {
    const {
      ttl = this.defaultTTL, 
      forceRefresh = false,
      onStart = () => {},
      onComplete = () => {}
    } = options;
    
    const cacheKey = this.getCacheKey(url);
    const now = Date.now();
    
    // Check cache first (unless force refresh)
    if (!forceRefresh && this.cache[cacheKey] && this.cache[cacheKey].expires > now) {
      console.log(`Cache hit for ${url} (${Math.round((now - this.cache[cacheKey].timestamp)/1000)}s old)`);
      return this.cache[cacheKey].data;
    }
    
    // Check if we are already fetching this URL
    if (this.inProgressRequests[cacheKey]) {
      console.log(`Request already in progress for ${url}, returning existing promise`);
      return this.inProgressRequests[cacheKey];
    }
    
    // Call onStart callback
    onStart();
    
    // Create a new request
    console.log(`Cache miss for ${url}, fetching fresh data`);
    
    // Create the promise for the fetch
    const fetchPromise = axios.get(url, { withCredentials: true })
      .then(response => {
        // Store in cache
        this.setCache(url, response.data, ttl);
        
        // Return the data
        return response.data;
      })
      .catch(error => {
        console.error(`Error fetching ${url}:`, error);
        throw error;
      })
      .finally(() => {
        // Remove from in-progress requests
        delete this.inProgressRequests[cacheKey];
        
        // Call onComplete callback
        onComplete();
      });
    
    // Store the in-progress request
    this.inProgressRequests[cacheKey] = fetchPromise;
    
    return fetchPromise;
  }
  
  // Set cache entry
  setCache(url, data, ttl = this.defaultTTL) {
    const cacheKey = this.getCacheKey(url);
    const now = Date.now();
    
    this.cache[cacheKey] = {
      data,
      timestamp: now,
      expires: now + ttl
    };
    
    // Save to localStorage for persistence
    this.saveToLocalStorage();
    
    return data;
  }
  
  // Invalidate a cached URL
  invalidate(url) {
    const cacheKey = this.getCacheKey(url);
    
    if (this.cache[cacheKey]) {
      console.log(`Invalidating cache for ${url}`);
      delete this.cache[cacheKey];
      this.saveToLocalStorage();
    }
  }
  
  // Clear entire cache
  clear() {
    console.log('Clearing entire API cache');
    this.cache = {};
    localStorage.removeItem('apiCache');
  }
  
  // Generate a cache key from URL
  getCacheKey(url) {
    return `api_${url.replace(/[^a-zA-Z0-9]/g, '_')}`;
  }
}

// Create and export singleton
const apiCache = new ApiCache();
export default apiCache; 