import React, { useState, useMemo, useEffect } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { LeftPanel, MiddlePanel } from "./components/ActionCenter";
import HomePage from "./components/Home/HomePage";
import "./App.css";

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [messageType, setMessageType] = useState('default');
  const [messageText, setMessageText] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  // Handle message updates
  const handleMessageUpdate = (type, text) => {
    setMessageType(type);
    setMessageText(text);
  };

  // Check for authentication on component mount and when location changes
  useEffect(() => {
    const checkAuth = async () => {
      try {
        setIsLoading(true);
        
        // Check if we're returning from Cognito authentication
        if (location.hash.includes('id_token') || location.hash.includes('access_token')) {
          console.log('Detected authentication callback from AWS Cognito');
          
          // Store the tokens in localStorage or handle them as needed
          const hashParams = new URLSearchParams(location.hash.substring(1));
          const idToken = hashParams.get('id_token');
          const accessToken = hashParams.get('access_token');
          
          if (idToken) {
            localStorage.setItem('id_token', idToken);
          }
          
          if (accessToken) {
            localStorage.setItem('access_token', accessToken);
          }
          
          setIsAuthenticated(true);
          
          // Redirect to the home section after successful login
          navigate('/home');
          return;
        }
        
        // Regular auth check
        const response = await fetch('http://localhost:3001/check-auth', {
          credentials: 'include'
        });
        
        if (response.ok) {
          const data = await response.json();
          setIsAuthenticated(data.isAuthenticated);
          
          // If user is authenticated but on the landing page, redirect to home
          if (data.isAuthenticated && location.pathname === '/') {
            navigate('/home');
          }
        }
      } catch (error) {
        console.error('Error checking authentication:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    checkAuth();
  }, [location, navigate]);

  // Create a route-specific AppLayout component to avoid unnecessary component mounts
  const AppLayout = () => {
    const location = useLocation();
    const currentPath = location.pathname.split('/')[1] || 'upload';
    
    console.log(`Rendering AppLayout for path: ${currentPath}`);
    
    // Use memoization to prevent unnecessary re-renders of panels
    const memoizedPanels = useMemo(() => (
      <>
        <div className="panel panel-left">
          <LeftPanel onMessageUpdate={handleMessageUpdate} />
        </div>

        <div className="panel panel-middle">
          <div className="h-full">
            <MiddlePanel 
              currentPath={currentPath} // Pass the current path to control component mounting
              type={messageType}
              message={messageText}
            />
          </div>
        </div>
      </>
    ), [currentPath, messageType, messageText]);
    
    return (
      <div className="app-container two-panel-layout">
        {memoizedPanels}
      </div>
    );
  };

  // Show loading state while checking authentication
  if (isLoading) {
    return <div className="auth-loading">Loading...</div>;
  }

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/home" element={<AppLayout />} />
      <Route path="/upload" element={<AppLayout />} />
      <Route path="/files" element={<AppLayout />} />
      <Route path="/chat" element={<AppLayout />} />
      {/* Redirect /dashboard to /upload */}
      <Route path="/dashboard" element={<Navigate to="/upload" />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}

export default App;