/**
 * Simple event service to handle events across components
 */
class EventService {
  constructor() {
    this.subscribers = {};
    this.FILE_EVENTS = {};
  }

  /**
   * Subscribe to an event
   * @param {string} event - Event name
   * @param {function} callback - Callback to execute when event is triggered
   * @returns {function} - Unsubscribe function
   */
  subscribe(eventName, callback) {
    if (!this.subscribers[eventName]) {
      this.subscribers[eventName] = [];
    }
    
    this.subscribers[eventName].push(callback);
    
    // Return unsubscribe function
    return () => {
      this.subscribers[eventName] = this.subscribers[eventName].filter(cb => cb !== callback);
    };
  }
  
  /**
   * Publish an event
   * @param {string} event - Event name
   * @param {any} data - Data to pass to subscribers
   */
  publish(eventName, data) {
    if (!this.subscribers[eventName]) {
      return;
    }
    
    this.subscribers[eventName].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`Error in event subscriber to ${eventName}:`, error);
      }
    });
  }
  
  // Register a new event type
  registerEvent(eventName) {
    if (!this.FILE_EVENTS[eventName]) {
      this.FILE_EVENTS[eventName] = eventName;
    }
  }
}

// Create a singleton instance
const eventService = new EventService();

// Supported file events
export const FILE_EVENTS = {
  FILES_UPLOADED: 'files_uploaded',
  FILES_DELETED: 'files_deleted',
  REFRESH_FILES: 'refresh_files',
  FILES_DATA_UPDATED: 'files_data_updated'
};

// Add the event types to the service
eventService.FILE_EVENTS = FILE_EVENTS;

export default eventService; 