import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import './FileTable.css';
import apiCache from '../../utils/apiCache';
import eventService, { FILE_EVENTS } from '../../utils/eventService';
import fileDataService from '../../utils/fileDataService';

// Remove client-side cache since we're using shared apiCache
// const clientCache = {
//     data: null,
//     timestamp: null,
//     ttl: 300000, // 5 minute client-side cache (increased from 1 minute)
// };

const FileTable = ({ visible = true }) => {
    const location = useLocation();
    const currentPath = location.pathname.split('/')[1] || 'upload';
    const isFilesSection = currentPath === 'files';
    
    const [files, setFiles] = useState([]);
    const [sessions, setSessions] = useState({});
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [expandedSession, setExpandedSession] = useState(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [isDeletingFile, setIsDeletingFile] = useState(null);
    const isFetchingRef = useRef(false);
    const lastFetchTimeRef = useRef(0);
    const hasFetchedRef = useRef(false);
    const refreshTimeoutRef = useRef(null);
    const [successMessage, setSuccessMessage] = useState('');

    // Process data from API or cache
    const processFileData = (data) => {
        console.log("Processing file data:", data);
        
        // Check if data contains Items array or is a direct array
        let fileList = [];
        
        if (Array.isArray(data)) {
            // Direct array response
            fileList = data;
            console.log("Data is a direct array");
        } else if (data && Array.isArray(data.Items)) {
            // Response with Items array
            fileList = data.Items;
            console.log("Data has Items array");
        } else if (data && data.success === true && Array.isArray(data.items)) {
            // API Gateway format with lowercase 'items'
            fileList = data.items;
            console.log("Data has items array (lowercase)");
        } else {
            console.warn("Data format not recognized:", data);
            // Try to extract any array we can find
            for (const key in data) {
                if (Array.isArray(data[key])) {
                    console.log(`Found array in property: ${key} with ${data[key].length} items`);
                    fileList = data[key];
                    break;
                }
            }
        }
        
        console.log(`Processing ${fileList.length} files:`, fileList);
        
        if (fileList.length > 0) {
            // Group files by session ID
            const sessionGroups = {};
            
            fileList.forEach(file => {
                console.log("Processing file:", file);
                // Field name fallbacks
                const fileName = file.fileName || file.FileName || file.filename || 'Unknown';
                const sessionId = file.sessionId || file.SessionId || file.sessionID || 'default';
                
                // Clean up file name (remove session ID prefix if present)
                let cleanFileName = fileName;
                if (fileName.includes('/')) {
                    cleanFileName = fileName.split('/').pop();
                }
                
                // Create cleaned up file object
                const cleanedFile = {
                    ...file,
                    fileName: cleanFileName,
                    sessionId: sessionId
                };
                
                // Add to session group
                if (!sessionGroups[sessionId]) {
                    sessionGroups[sessionId] = [];
                }
                sessionGroups[sessionId].push(cleanedFile);
            });
            
            // Sort sessions by most recent first
            Object.keys(sessionGroups).forEach(sessionId => {
                sessionGroups[sessionId].sort((a, b) => {
                    const dateA = new Date(a.uploadTimestamp || a.timestamp || 0);
                    const dateB = new Date(b.uploadTimestamp || b.timestamp || 0);
                    return dateB - dateA; // Most recent first
                });
            });
            
            console.log("Setting files state:", fileList.length, "files");
            setFiles(fileList);
            console.log("Setting sessions state:", Object.keys(sessionGroups).length, "sessions", sessionGroups);
            setSessions(sessionGroups);
            
            // Auto-expand the most recent session
            const sortedSessions = Object.keys(sessionGroups).sort((a, b) => {
                const latestA = sessionGroups[a][0]?.uploadTimestamp || 0;
                const latestB = sessionGroups[b][0]?.uploadTimestamp || 0;
                return new Date(latestB) - new Date(latestA);
            });
            
            if (sortedSessions.length > 0 && !expandedSession) {
                console.log("Auto-expanding most recent session:", sortedSessions[0]);
                setExpandedSession(sortedSessions[0]);
            }
            
            setError(null);
        } else {
            console.warn("No file data found or empty array received");
            setFiles([]);
            setSessions({});
            
            if (data.source) {
                console.log(`No files found from source: ${data.source}`);
            } else {
                console.warn('Unexpected response format:', data);
            }
        }
    };

    // Fetch files using the centralized fileDataService
    const fetchFiles = async () => {
        if (isRefreshing || !isFilesSection || isFetchingRef.current) return;
        
        try {
            setIsLoading(true); // Ensure we set loading state to true
            setIsRefreshing(true);
            isFetchingRef.current = true;
            console.log("Fetching files using fileDataService...");
            
            // Get files from the centralized service
            const response = await fileDataService.fetchFileData();
            console.log("Files response:", response);
            
            // Process the response data
            if (response) {
                processFileData(response);
                
                // Show data source to help with debugging
                if (response.source) {
                    console.log(`Files fetched from ${response.source}`);
                }
            } else {
                console.error("Invalid response format:", response);
                setError('Failed to refresh files: Invalid response format');
            }
            
            lastFetchTimeRef.current = Date.now();
            hasFetchedRef.current = true;
        } catch (err) {
            console.error('Error fetching files:', err);
            setError('Failed to fetch files: ' + (err.response?.data?.error || err.message));
        } finally {
            setIsLoading(false); // Make sure to set loading to false
            setIsRefreshing(false);
            isFetchingRef.current = false;
        }
    };

    // Handle explicit refresh button click
    const handleRefresh = () => {
        // Use the service's force refresh method
        setIsRefreshing(true);
        fileDataService.forceRefresh()
            .then(data => {
                processFileData(data);
                console.log("Files refreshed successfully");
            })
            .catch(err => {
                console.error('Error refreshing files:', err);
                setError('Failed to refresh files: ' + (err.response?.data?.error || err.message));
            })
            .finally(() => {
                setIsRefreshing(false);
            });
    };
    
    // Subscribe to file events
    useEffect(() => {
        // Subscribe to data updated events from the centralized service
        const dataUpdateSubscription = eventService.subscribe(FILE_EVENTS.FILES_DATA_UPDATED, (event) => {
            console.log('File data updated event received, processing new data');
            if (event && event.data) {
                processFileData(event.data);
                setIsLoading(false);
                setIsRefreshing(false);
                isFetchingRef.current = false;
            }
        });
        
        // Subscribe to manual refresh events
        const refreshSubscription = eventService.subscribe(FILE_EVENTS.REFRESH_FILES, () => {
            console.log('Manual refresh requested');
            setIsRefreshing(true);
        });
        
        // Cleanup subscriptions on unmount
        return () => {
            dataUpdateSubscription();
            refreshSubscription();
            
            // Clear any pending timeout
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current);
            }
        };
    }, [isFilesSection]);

    // Initial fetch on component mount or path change
    useEffect(() => {
        // Reset the fetch flag when the path changes
        if (currentPath !== 'files') {
            hasFetchedRef.current = false;
            console.log(`FileTable not on files section (${currentPath}), skipping fetch`);
            return;
        }
        
        // Only fetch when component is visible, on files section, and hasn't fetched already
        if (visible && isFilesSection && !hasFetchedRef.current) {
            console.log('FileTable is visible and on files section, fetching files');
            fetchFiles();
        }
        
        // Clean up function to avoid state updates after unmounting
        return () => {
            isFetchingRef.current = true; // Prevent any ongoing or new fetches during unmount
        };
    }, [visible, currentPath, isFilesSection]);

    const formatFileSize = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDate = (timestamp) => {
        return new Date(timestamp).toLocaleString();
    };
    
    const toggleSession = (sessionId) => {
        if (expandedSession === sessionId) {
            setExpandedSession(null);
        } else {
            setExpandedSession(sessionId);
        }
    };
    
    const formatSessionName = (sessionId) => {
        if (!sessionId) return 'Default';
        
        // Convert session-YYYYMMDD-HHMMSS to a more readable format
        if (sessionId.startsWith('session-')) {
            const parts = sessionId.split('-');
            if (parts.length === 3 && parts[1].length === 8 && parts[2].length === 6) {
                const year = parts[1].substring(0, 4);
                const month = parts[1].substring(4, 6);
                const day = parts[1].substring(6, 8);
                const hour = parts[2].substring(0, 2);
                const minute = parts[2].substring(2, 4);
                return `Session ${month}/${day}/${year} ${hour}:${minute}`;
            }
        }
        
        return sessionId;
    };

    const handleDeleteFile = async (file, event) => {
        // Ensure the event doesn't bubble up (important for nested click handlers)
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }

        if (!file || (!file.s3Key && !file.key)) {
            console.error('Cannot delete file: missing file object or key property', file);
            setError('Cannot delete file: No valid file identifier found');
            return;
        }

        console.log('Delete button clicked for file:', file);
        
        if (!window.confirm(`Are you sure you want to delete "${file.fileName}"?`)) {
            return;
        }

        try {
            // Extract the S3 key which is the most reliable identifier for S3 files
            const s3Key = file.s3Key || file.key;
            
            if (!s3Key) {
                setError('Cannot delete file: No valid S3 key found');
                console.error('Cannot delete file: No S3 key available', file);
                return;
            }
            
            setIsDeletingFile(s3Key);
            console.log(`Deleting file with S3 key: ${s3Key}`);
            
            // Try the API endpoint first
            try {
                console.log(`Sending delete request to API endpoint for key: ${s3Key}`);
                const response = await axios.delete(`http://localhost:3001/api/files/${s3Key}`, {
                    withCredentials: true,
                });
                
                console.log('Delete API response:', response.data);
                
                if (response.data && response.data.success) {
                    handleSuccessfulDelete(s3Key, file);
                } else {
                    // Fall back to the older endpoint if the API fails
                    console.log('API delete failed, trying fallback endpoint');
                    await fallbackDelete(s3Key, file);
                }
            } catch (apiError) {
                console.error('API delete endpoint error:', apiError);
                // Try fallback endpoint
                await fallbackDelete(s3Key, file);
            }
        } catch (error) {
            // Handle client-side or network error
            const errorMsg = error.response?.data?.message || error.message || 'Failed to delete file';
            setError(errorMsg);
            console.error('Error deleting file:', error);
        } finally {
            setIsDeletingFile(null);
        }
    };

    // Fallback to the older delete endpoint
    const fallbackDelete = async (s3Key, file) => {
        try {
            console.log(`Trying fallback delete endpoint for key: ${s3Key}`);
            const response = await fetch('http://localhost:3001/delete-file', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ key: s3Key }),
                credentials: 'include'
            });
            
            if (!response.ok) {
                throw new Error(`Server returned error ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('Fallback delete response:', data);
            
            if (data.success) {
                handleSuccessfulDelete(s3Key, file);
            } else {
                throw new Error(data.error || 'Failed to delete file');
            }
        } catch (fallbackError) {
            throw fallbackError;
        }
    };

    // Handle successful deletion by updating UI and state
    const handleSuccessfulDelete = (s3Key, file) => {
        console.log('File deleted successfully, updating UI');
        // Update local state by removing the deleted file
        const updatedFiles = files.filter(f => 
            (f.s3Key || f.key) !== s3Key
        );
        setFiles(updatedFiles);
        
        // Update sessions state
        const updatedSessions = {...sessions};
        Object.keys(updatedSessions).forEach(sessionId => {
            updatedSessions[sessionId] = updatedSessions[sessionId].filter(f => 
                (f.s3Key || f.key) !== s3Key
            );
            
            // Remove the session if it no longer has any files
            if (updatedSessions[sessionId].length === 0) {
                delete updatedSessions[sessionId];
            }
        });
        
        setSessions(updatedSessions);
        
        // Invalidate the API cache
        if (apiCache && apiCache.invalidate) {
            console.log('Invalidating API caches after deletion');
            apiCache.invalidate('http://localhost:3001/api/files');
            apiCache.invalidate('http://localhost:3001/api/dashboard/stats');
            apiCache.invalidate('http://localhost:3001/api/session/files');
        }
        
        // Publish file deleted event
        if (eventService && eventService.publish) {
            console.log('Publishing file deleted event');
            eventService.publish(FILE_EVENTS.FILES_DELETED, {
                fileName: file.fileName,
                key: s3Key
            });
        }
        
        // Set success message
        setSuccessMessage('File deleted successfully');
        setTimeout(() => setSuccessMessage(''), 3000);
    };

    // If not on files section, render nothing
    if (!isFilesSection) {
        console.log('FileTable not rendering - not on files section');
        return null;
    }
    
    // If not visible, render nothing
    if (!visible) {
        console.log('FileTable not rendering - not visible');
        return null;
    }

    console.log('FileTable render check - isLoading:', isLoading, 'isRefreshing:', isRefreshing, 'files:', files.length, 'sessions:', Object.keys(sessions).length);

    // Only show loading initially, not when refreshing
    if (isLoading && !hasFetchedRef.current) {
        console.log('FileTable showing initial loading state');
        return (
            <div className='file-table-empty'>
                <p>Loading files...</p>
            </div>
        );
    }

    console.log('FileTable rendering with sessions:', Object.keys(sessions).length, 'error:', error ? 'yes' : 'no', 'isLoading:', isLoading);

    return (
        <div className="file-table-wrapper">
            <div className="file-table-header">
                <h2>Data Processing</h2>
                <button 
                    className="refresh-button" 
                    onClick={handleRefresh}
                    disabled={isRefreshing}
                >
                    {isRefreshing ? 'Refreshing...' : 'Refresh Files'}
                </button>
            </div>
            
            {error && (
                <div className='file-table-error'>
                    <p className='error-message'>{error}</p>
                </div>
            )}
            
            {successMessage && (
                <div className="success-message">
                    <span className="success-icon">✓</span>
                    {successMessage}
                    <button className="close-success" onClick={() => setSuccessMessage('')}>×</button>
                </div>
            )}
            
            {!error && Object.keys(sessions).length === 0 ? (
                <div className='file-table-empty'>
                    <p>No files found. You haven't uploaded any files yet or there was an issue retrieving them.</p>
                    <p>Try uploading a file from the "Upload Files" section or click "Refresh Files" to try again.</p>
                </div>
            ) : (
                <div className='file-sessions-container'>
                    {Object.keys(sessions).sort((a, b) => {
                        // Sort sessions by most recent first
                        const latestA = sessions[a][0]?.uploadTimestamp || 0;
                        const latestB = sessions[b][0]?.uploadTimestamp || 0;
                        return new Date(latestB) - new Date(latestA);
                    }).map(sessionId => (
                        <div key={sessionId} className='session-group'>
                            <div 
                                className={`session-header ${expandedSession === sessionId ? 'expanded' : ''}`}
                                onClick={() => toggleSession(sessionId)}
                            >
                                <h3>{formatSessionName(sessionId)}</h3>
                                <div className='session-info'>
                                    <span>{sessions[sessionId].length} files</span>
                                    <span className='expand-icon'>{expandedSession === sessionId ? '▼' : '▶'}</span>
                                </div>
                            </div>
                            
                            {expandedSession === sessionId && (
                                <div className='file-table-container'>
                                    <table className='file-table'>
                                        <thead>
                                            <tr>
                                                <th>File Name</th>
                                                <th>File Size</th>
                                                <th>Status</th>
                                                <th>Upload Date</th>
                                                <th>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sessions[sessionId].map((file, index) => {
                                                // Field name fallbacks
                                                const fileName = file.fileName || 'Unknown';
                                                const fileSize = file.fileSize || file.FileSize || file.size || 0;
                                                const status = file.status || file.Status || 'unprocessed';
                                                const timestamp = file.uploadTimestamp || file.UploadTimestamp || file.timestamp || Date.now();
                                                const fileId = file.fileId || file.id || file.s3Key || file.key;
                                                
                                                return (
                                                    <tr key={`file-${index}`}>
                                                        <td>{fileName}</td>
                                                        <td>{formatFileSize(fileSize)}</td>
                                                        <td>
                                                            <span className={`status-badge ${status.toLowerCase()}`}>
                                                                {status}
                                                            </span>
                                                        </td>
                                                        <td>{formatDate(timestamp)}</td>
                                                        <td>
                                                            <button 
                                                                className={`delete-button ${isDeletingFile === fileId ? 'deleting' : ''}`}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleDeleteFile(file, e);
                                                                }}
                                                                disabled={isDeletingFile === fileId}
                                                            >
                                                                {isDeletingFile === fileId ? 'Deleting...' : 'Delete'}
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default FileTable;