import React, { useState, useEffect, useCallback, memo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import FileUpload from './FileUpload';
import axios from 'axios';
import './LeftPanel.css';

// Icons defined outside component to prevent re-creation on each render
const icons = {
  home: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
      <polyline points="9 22 9 12 15 12 15 22"></polyline>
    </svg>
  ),
  files: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
      <polyline points="10 9 9 9 8 9"></polyline>
    </svg>
  ),
  upload: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="17 8 12 3 7 8"></polyline>
      <line x1="12" y1="3" x2="12" y2="15"></line>
    </svg>
  ),
  processing: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
    </svg>
  ),
  chat: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
  ),
  logout: (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
      <polyline points="16 17 21 12 16 7"></polyline>
      <line x1="21" y1="12" x2="9" y2="12"></line>
    </svg>
  ),
  spinner: (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="icon">
      <line x1="12" y1="2" x2="12" y2="6"></line>
      <line x1="12" y1="18" x2="12" y2="22"></line>
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
      <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line>
      <line x1="2" y1="12" x2="6" y2="12"></line>
      <line x1="18" y1="12" x2="22" y2="12"></line>
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line>
      <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line>
    </svg>
  )
};

// Avatar component to avoid re-rendering
const UserAvatar = memo(({ username }) => (
  <div className='user-avatar'>
    {username ? username[0].toUpperCase() : '?'}
  </div>
));

// MenuItem component to prevent re-render of each menu item
const MenuItem = memo(({ icon, text, isActive, onClick, disabled, hint, className }) => (
  <div 
    className={`sidebar-menu-item ${isActive ? 'active' : ''} ${disabled ? 'disabled' : ''} ${className || ''}`}
    onClick={onClick}
  >
    <span className="icon">{icon}</span>
    <span className="menu-text">{text}</span>
    {hint && <span className='disabled-hint'>{hint}</span>}
  </div>
));

const LeftPanel = ({ onMessageUpdate }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isUploadVisible, setIsUploadVisible] = useState(false);
  const [hasUploadedFile, setHasUploadedFile] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [userEmail, setUserEmail] = useState('');

  useEffect(() => {
    const fetchUserInfo = async () => {
      try {
        setIsLoading(true);
        // Check authentication status from the backend
        const response = await axios.get('http://localhost:3001/check-auth', {
          withCredentials: true
        });
        
        if (response.data.isAuthenticated && response.data.user) {
          if (response.data.user.email) {
            setUserEmail(response.data.user.email);
          }
          
          if (response.data.user.username) {
            setUsername(response.data.user.username);
          } else if (response.data.user.preferred_username) {
            // Fallback to preferred_username if available
            setUsername(response.data.user.preferred_username);
          } else if (response.data.user.sub) {
            // Fallback to sub (Cognito user ID) if no username
            setUsername(response.data.user.sub);
          } else {
            // Last resort: use email as username (just for display, folder will use actual username)
            const fallbackUsername = localStorage.getItem('username') || 'user' + Math.floor(Math.random() * 1000);
            setUsername(fallbackUsername);
            localStorage.setItem('username', fallbackUsername);
          }
        } else {
          // Fallback to localStorage or a default value
          const savedEmail = localStorage.getItem('userEmail') || 'anonymous@user.com';
          setUserEmail(savedEmail);
          
          const savedUsername = localStorage.getItem('username') || 'anonymous';
          setUsername(savedUsername);
        }
      } catch (error) {
        console.error('Error fetching user information:', error);
        // Fallback to localStorage or a default value
        setUserEmail('guest@mail.com');
        setUsername('Guest');
      } finally {
        setIsLoading(false);
      }
    };
    fetchUserInfo();
  }, []);

  const handleUploadClick = useCallback(() => {
    setIsUploadVisible(true);
    navigate('/upload');
    onMessageUpdate('info', '');
  }, [navigate, onMessageUpdate]);

  const handleFileUploadSuccess = useCallback(() => {
    setHasUploadedFile(true);
  }, []);

  const handleChatbotClick = useCallback(() => {
    setIsUploadVisible(false);
    navigate('/chat');
    onMessageUpdate('info', '');
  }, [navigate, onMessageUpdate]);

  const handleProcessingClick = useCallback(() => {
    if (!hasUploadedFile){
      onMessageUpdate('error', '');
      return;
    }
    setIsUploadVisible(false);
    navigate('/processing');
    onMessageUpdate('info', '');
  }, [hasUploadedFile, navigate, onMessageUpdate]);
  
  const handleHomeClick = useCallback(() => {
    setIsUploadVisible(false);
    navigate('/home');
    onMessageUpdate('info', '');
  }, [navigate, onMessageUpdate]);
  
  const handleLogoutClick = useCallback(() => {
    // Use window.location to make a full page navigation to the logout endpoint
    window.location.href = 'http://localhost:3001/logout';
  }, []);

  const isActivePath = useCallback((path) => {
    return location.pathname === path;
  }, [location.pathname]);

  const handleFilesClick = useCallback(() => {
    setIsUploadVisible(false);
    navigate('/files');
    onMessageUpdate('info', '');
  }, [navigate, onMessageUpdate]);

  return (
    <div className="sidebar-container">
      <div className="sidebar-header">
        <div className='user-profile'>
        {isLoading ? (
          <div className='loading-spinner'>
            {icons.spinner}
          </div>
        ) : (
          <>
            <UserAvatar username={username} />
            <div className='user-info'>
              <h3 className='username'>{(username || 'Guest').toUpperCase()}</h3>
            </div>
          </>
        )}
        </div>
      </div>

      <div className="sidebar-menu">
        <MenuItem 
          icon={icons.home}
          text="Home"
          isActive={isActivePath('/home')}
          onClick={handleHomeClick}
        />

        <MenuItem 
          icon={icons.upload}
          text="Upload Files"
          isActive={isActivePath('/upload')}
          onClick={handleUploadClick}
        />

        <MenuItem 
          icon={icons.files}
          text="Data Processing"
          isActive={isActivePath('/files')}
          onClick={handleFilesClick}
        />

        <MenuItem 
          icon={icons.chat}
          text="Summaries"
          isActive={isActivePath('/chat')}
          onClick={handleChatbotClick}
        />
      </div>

      {isUploadVisible && (
        <FileUpload 
          onMessageUpdate={onMessageUpdate}
          onUploadSuccess={handleFileUploadSuccess}
        />
      )}

      <div className="sidebar-footer">
        <MenuItem 
          icon={icons.logout}
          text="Logout"
          onClick={handleLogoutClick}
          className="logout-button"
        />
        <p></p>
      </div>
    </div>
  );
};

export default memo(LeftPanel); 