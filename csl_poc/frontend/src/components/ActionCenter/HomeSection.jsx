import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './HomeSection.css';

// SVG Icons for better visuals
const Icons = {
  document: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="home-icon">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
      <polyline points="14 2 14 8 20 8"></polyline>
      <line x1="16" y1="13" x2="8" y2="13"></line>
      <line x1="16" y1="17" x2="8" y2="17"></line>
      <polyline points="10 9 9 9 8 9"></polyline>
    </svg>
  ),
  session: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="home-icon">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="16" y1="2" x2="16" y2="6"></line>
      <line x1="8" y1="2" x2="8" y2="6"></line>
      <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>
  ),
  chat: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="home-icon">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
  ),
  upload: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="home-icon">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="17 8 12 3 7 8"></polyline>
      <line x1="12" y1="3" x2="12" y2="15"></line>
    </svg>
  ),
  process: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="home-icon">
      <circle cx="12" cy="12" r="3"></circle>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
    </svg>
  ),
  chatbot: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="home-icon">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="3" y1="9" x2="21" y2="9"></line>
      <line x1="9" y1="21" x2="9" y2="9"></line>
    </svg>
  ),
  activity: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="home-icon">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>
    </svg>
  ),
  noActivity: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="home-icon empty-activity-icon">
      <circle cx="12" cy="12" r="10"></circle>
      <line x1="12" y1="8" x2="12" y2="12"></line>
      <line x1="12" y1="16" x2="12.01" y2="16"></line>
    </svg>
  )
};

const HomeSection = () => {
  const [userInfo, setUserInfo] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [stats, setStats] = useState({
    totalFiles: 0,
    totalSessions: 0,
    recentActivity: []
  });
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const fetchUserInfo = async () => {
      try {
        setIsLoading(true);
        const response = await axios.get('http://localhost:3001/check-auth', {
          withCredentials: true
        });
        
        if (response.data.isAuthenticated && response.data.user) {
          setUserInfo(response.data.user);
        }
        
        // Get basic file stats
        try {
          const statsResponse = await axios.get('http://localhost:3001/api/dashboard/stats', {
            withCredentials: true
          });
          
          if (statsResponse.data && statsResponse.data.stats) {
            setStats(statsResponse.data.stats);
          }
        } catch (err) {
          console.error('Error fetching statistics', err);
        }
      } catch (error) {
        console.error('Error fetching user info:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchUserInfo();
    
    // Update the time every minute
    const timeInterval = setInterval(() => {
      setTime(new Date());
    }, 60000);
    
    return () => clearInterval(timeInterval);
  }, []);

  // Extract user's name or username
  const getUserDisplayName = () => {
    if (!userInfo) return 'User';
    
    if (userInfo.username) return userInfo.username;
    if (userInfo.name) return userInfo.name;
    if (userInfo.email) return userInfo.email.split('@')[0];
    
    return 'User';
  };
  
  // Format the current date and time
  const formatDateTime = () => {
    const options = { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    };
    return time.toLocaleDateString(undefined, options);
  };
  
  // Generate greeting based on time of day
  const getGreeting = () => {
    const hour = time.getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  if (isLoading) {
    return (
      <div className="home-section loading">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="home-section">
      <div className="home-header">
        <div className="welcome-banner">
          <div className="welcome-content">
            <div className="welcome-header">
              <h1>{getGreeting()}, {getUserDisplayName()}</h1>
              <div className="current-date">{formatDateTime()}</div>
            </div>
            <p>Your AI document management dashboard is ready for you. Easily upload, process, and chat with your documents.</p>
            
            <div className="welcome-circles">
              <div className="welcome-circle circle-1"></div>
              <div className="welcome-circle circle-2"></div>
              <div className="welcome-circle circle-3"></div>
            </div>
          </div>
        </div>
      </div>

      <div className="home-stats-grid">
        <div className="home-stat-card">
          <div className="home-stat-icon document-icon">
            {Icons.document}
          </div>
          <div className="home-stat-content">
            <div className="home-stat-value">{stats.totalFiles || 0}</div>
            <div className="home-stat-label">Documents</div>
          </div>
        </div>
        
        <div className="home-stat-card">
          <div className="home-stat-icon session-icon">
            {Icons.session}
          </div>
          <div className="home-stat-content">
            <div className="home-stat-value">{stats.totalSessions || 0}</div>
            <div className="home-stat-label">Sessions</div>
          </div>
        </div>
        
        <div className="home-stat-card">
          <div className="home-stat-icon chat-icon">
            {Icons.chat}
          </div>
          <div className="home-stat-content">
            <div className="home-stat-value">0</div>
            <div className="home-stat-label">Chat Conversations</div>
          </div>
        </div>
      </div>

      <div className="home-cards-row">
        <div className="home-quick-action-card">
          <div className="card-header">
            <h2>Quick Actions</h2>
            <div className="card-header-decoration"></div>
          </div>
          <div className="home-actions-grid">
            <a href="/upload" className="home-action-item">
              <div className="home-action-icon upload-action">
                {Icons.upload}
              </div>
              <div className="home-action-label">Upload Documents</div>
            </a>
            <a href="/files" className="home-action-item">
              <div className="home-action-icon process-action">
                {Icons.process}
              </div>
              <div className="home-action-label">Process Data</div>
            </a>
            <a href="/chat" className="home-action-item">
              <div className="home-action-icon chat-action">
                {Icons.chatbot}
              </div>
              <div className="home-action-label">Chat with Documents</div>
            </a>
          </div>
        </div>
        
        <div className="home-activity-card">
          <div className="card-header">
            <h2>Recent Activity</h2>
            <div className="card-header-decoration"></div>
          </div>
          {stats.recentActivity?.length > 0 ? (
            <ul className="home-activity-list">
              {stats.recentActivity.slice(0, 5).map((activity, index) => (
                <li key={index} className="home-activity-item">
                  <div className="activity-item-container">
                    <div className="activity-bullet"></div>
                    <div className="activity-content">
                      <span className="home-activity-time">
                        {new Date(activity.timestamp).toLocaleString()}
                      </span>
                      <span className="home-activity-text">{activity.message}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="home-empty-activity">
              {Icons.noActivity}
              <p>No recent activity</p>
              <p className="home-empty-suggestion">Let's get started by uploading some documents</p>
              <a href="/upload" className="empty-action-btn">Upload Files</a>
            </div>
          )}
        </div>
      </div>
      
      <div className="home-tips-section">
        <div className="tips-header">
          <h2>Tips & Guidance</h2>
          <div className="card-header-decoration"></div>
        </div>
        <div className="tips-container">
          <div className="tip-card">
            <div className="tip-icon">💡</div>
            <div className="tip-content">
              <h3>Upload Tips</h3>
              <p>For best results, upload PDF documents with clear text. The system supports a variety of formats including DOC, DOCX, and TXT.</p>
            </div>
          </div>
          <div className="tip-card">
            <div className="tip-icon">✨</div>
            <div className="tip-content">
              <h3>Processing Documents</h3>
              <p>After uploading, visit the Data Processing section to analyze your documents and prepare them for conversation.</p>
            </div>
          </div>
          <div className="tip-card">
            <div className="tip-icon">💬</div>
            <div className="tip-content">
              <h3>Better Questions</h3>
              <p>When chatting with your documents, ask specific questions for more accurate answers. You can reference specific sections.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HomeSection; 