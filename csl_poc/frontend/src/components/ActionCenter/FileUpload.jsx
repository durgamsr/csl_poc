import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './FileUpload.css';

const FileUpload = ({ onMessageUpdate }) => {
  const [files, setFiles] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({});
  const [dragActive, setDragActive] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [folderName, setFolderName] = useState('');

  // Generate a unique session ID when component mounts
  useEffect(() => {
    // Format: session-YYYYMMDD-HHMMSS
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
    const newSessionId = `session-${dateStr}-${timeStr}`;
    setSessionId(newSessionId);
  }, []);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
  };

  const handleFiles = (selectedFiles) => {
    const newFiles = Array.from(selectedFiles).filter(
      file => !files.some(existingFile => existingFile.name === file.name)
    );
    
    setFiles(prevFiles => [...prevFiles, ...newFiles]);
  };

  const removeFile = (fileName) => {
    setFiles(prevFiles => prevFiles.filter(file => file.name !== fileName));
  };

  const uploadFiles = async () => {
    if (files.length === 0) {
      onMessageUpdate('warning', 'Please add files to upload');
      return;
    }

    if (!folderName.trim()) {
      onMessageUpdate('warning', 'Please enter a folder name');
      return;
    }

    setIsUploading(true);
    onMessageUpdate('info', 'Uploading files...');
    
    // Create folder path: userEmail/sessionId/folderName/
    const folderPath = `${userEmail.replace('@', '_at_')}/${sessionId}/${folderName.trim()}/`;
    
    const uploadPromises = files.map(async (file) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folderPath', folderPath);
      
      try {
        const response = await axios.post('http://localhost:5000/upload', formData, {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(prev => ({
              ...prev,
              [file.name]: percentCompleted
            }));
          }
        });
        
        return { file, success: true, response: response.data };
      } catch (error) {
        console.error(`Error uploading ${file.name}:`, error);
        return { file, success: false, error };
      }
    });

    try {
      const results = await Promise.all(uploadPromises);
      const successCount = results.filter(result => result.success).length;
      
      if (successCount === files.length) {
        onMessageUpdate('success', `Successfully uploaded ${successCount} files to session ${sessionId}`);
      } else {
        onMessageUpdate('warning', `Uploaded ${successCount} out of ${files.length} files to session ${sessionId}`);
      }
      
      // Clear uploaded files that were successful
      const failedFiles = results
        .filter(result => !result.success)
        .map(result => result.file);
      
      setFiles(failedFiles);
    } catch (error) {
      console.error('Error during upload:', error);
      onMessageUpdate('error', 'Error uploading files');
    } finally {
      setIsUploading(false);
      setUploadProgress({});
    }
  };

  return (
    <div className="file-upload-container">
      <div className="user-session-info">
        <div className="form-group">
          <input
            type="text"
            placeholder="Enter your email"
            value={userEmail}
            onChange={(e) => setUserEmail(e.target.value)}
            className="email-input"
          />
        </div>
        <div className="form-group">
          <label htmlFor="folder-name" className="folder-label">Name your upload folder:</label>
          <input
            id="folder-name"
            type="text"
            placeholder="Enter a name for your upload folder"
            value={folderName}
            onChange={(e) => setFolderName(e.target.value)}
            className="folder-name-input"
          />
        </div>
        <div className="session-info">
          <span className="session-label">Upload Session:</span>
          <span className="session-id">{sessionId}</span>
        </div>
      </div>

      <div 
        className={`drag-drop-area ${dragActive ? 'active' : ''}`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
      >
        <div className="drag-drop-content">
          <div className="upload-icon">📁</div>
          <p>Drag and drop files here or</p>
          <label className="file-input-label">
            Browse Files
            <input
              type="file"
              multiple
              onChange={handleFileChange}
              className="file-input"
            />
          </label>
          <p className="supported-files">Supported formats: PDF, DOC, DOCX, TXT</p>
        </div>
      </div>

      {files.length > 0 && (
        <div className="file-list">
          <h3>Selected Files</h3>
          <ul>
            {files.map((file, index) => (
              <li key={`${file.name}-${index}`} className="file-item">
                <div className="file-info">
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">({(file.size / 1024).toFixed(2)} KB)</span>
                </div>
                {isUploading && uploadProgress[file.name] !== undefined ? (
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{ width: `${uploadProgress[file.name]}%` }}
                    ></div>
                    <span className="progress-text">{uploadProgress[file.name]}%</span>
                  </div>
                ) : (
                  <button 
                    className="remove-file-btn" 
                    onClick={() => removeFile(file.name)}
                    disabled={isUploading}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button 
            className="upload-button" 
            onClick={uploadFiles}
            disabled={isUploading}
          >
            {isUploading ? 'Uploading...' : 'Upload Files'}
          </button>
        </div>
      )}
    </div>
  );
};

export default FileUpload; 